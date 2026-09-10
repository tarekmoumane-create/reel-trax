import { prisma } from "@/lib/db";
import { ok, bad, serverError } from "@/lib/api";
import { dayKey } from "@/lib/cadence";
import { getTimeZone } from "@/lib/settings";

const DAY = 86_400_000;
const MAX_SPAN_DAYS = 366;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Calendar days from..to inclusive (plain date strings; tz only matters when
// assigning posts to days, which dayKey handles).
function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  while (d <= end && out.length <= MAX_SPAN_DAYS) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get("clientId");
    if (!clientId) return bad("clientId is required");

    const tz = await getTimeZone();
    const today = dayKey(new Date(), tz);

    // Range: explicit from/to (viral-style custom window), else trailing `days`.
    let from = searchParams.get("from") ?? "";
    let to = searchParams.get("to") ?? "";
    if (!DATE_RE.test(from) || !DATE_RE.test(to) || from > to) {
      const days = Math.min(MAX_SPAN_DAYS, Math.max(1, Number(searchParams.get("days")) || 30));
      to = today;
      from = dayKey(new Date(Date.now() - (days - 1) * DAY), tz);
    }
    if (to > today) to = today;
    const dayList = eachDay(from, to);
    if (dayList.length === 0) return bad("empty range");

    const creators = await prisma.creator.findMany({
      where: { clientId },
      select: { id: true, displayName: true },
    });
    const creatorIds = creators.map((c) => c.id);
    const nameById = new Map(creators.map((c) => [c.id, c.displayName]));

    // ±1 day of slack around the range: postedAt is UTC but days are bucketed
    // in the app timezone, so the boundary posts straddle the query edges.
    const fetched = await prisma.post.findMany({
      where: {
        creatorId: { in: creatorIds },
        postedAt: {
          gte: new Date(new Date(`${from}T00:00:00Z`).getTime() - DAY),
          lte: new Date(new Date(`${to}T00:00:00Z`).getTime() + 2 * DAY),
        },
      },
      select: { creatorId: true, platform: true, url: true, caption: true, thumbnailUrl: true, postedAt: true, views: true, likes: true, comments: true, shares: true },
    });

    // one row per day carrying every metric — the client picks which to chart
    const byDay = new Map<string, { posts: number; views: number; likes: number; comments: number; shares: number }>();
    for (const d of dayList) byDay.set(d, { posts: 0, views: 0, likes: 0, comments: 0, shares: 0 });
    const posts = fetched.filter((p) => byDay.has(dayKey(p.postedAt, tz)));
    for (const p of posts) {
      const b = byDay.get(dayKey(p.postedAt, tz))!;
      b.posts += 1;
      b.views += p.views;
      b.likes += p.likes;
      b.comments += p.comments;
      b.shares += p.shares;
    }
    const series = dayList.map((d) => ({ date: d, ...byDay.get(d)! }));

    // views gained per day — the difference between consecutive daily stat
    // snapshots, summed across creators. A gap in syncs attributes the whole
    // delta to the day the next snapshot landed; days with no snapshot stay
    // null so the chart shows "not tracked yet" rather than a fake zero.
    const statSnaps = await prisma.creatorStatSnapshot.findMany({
      where: { creatorId: { in: creatorIds } },
      orderBy: { day: "asc" },
      select: { creatorId: true, day: true, views: true },
    });
    const gainedByDay = new Map<string, number>();
    const prevByCreator = new Map<string, number>();
    for (const s of statSnaps) {
      const views = Number(s.views); // BigInt column
      const prev = prevByCreator.get(s.creatorId);
      if (prev != null && byDay.has(s.day)) {
        gainedByDay.set(s.day, (gainedByDay.get(s.day) ?? 0) + Math.max(0, views - prev));
      }
      prevByCreator.set(s.creatorId, views);
    }
    const viewsGained = dayList.map((d) => ({ date: d, viewsGained: gainedByDay.has(d) ? gainedByDay.get(d)! : null }));
    const hasGained = viewsGained.some((g) => g.viewsGained != null);

    // follower growth (carry-forward per creator+platform)
    const snaps = await prisma.followerSnapshot.findMany({
      where: { creatorId: { in: creatorIds } },
      orderBy: { day: "asc" },
      select: { creatorId: true, platform: true, day: true, followers: true },
    });
    const byKey = new Map<string, { day: string; followers: number }[]>();
    for (const s of snaps) {
      const key = `${s.creatorId}|${s.platform}`;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key)!.push({ day: s.day, followers: s.followers });
    }
    const followers = dayList.map((d) => {
      let total = 0;
      let any = false;
      for (const arr of byKey.values()) {
        let latest: number | null = null;
        for (const s of arr) { if (s.day <= d) latest = s.followers; else break; }
        if (latest != null) { total += latest; any = true; }
      }
      return { date: d, followers: any ? total : null };
    });
    const hasFollowers = followers.some((f) => f.followers != null);

    // leaderboards — the client's sort/count selectors slice; videos capped
    // to keep the payload sane, creators returned in full so "top N" can be
    // any number up to the roster size
    // One entry per video: a post stored twice under drifting platform ids
    // (repaired by lib/dedupe on the next sync) must not rank twice here.
    const seenUrls = new Set<string>();
    const topVideos = [...posts]
      .sort((a, b) => b.views - a.views || b.likes - a.likes)
      .filter((p) => {
        if (!p.url) return true;
        if (seenUrls.has(p.url)) return false;
        seenUrls.add(p.url);
        return true;
      })
      .slice(0, 300)
      .map((p) => ({
        platform: p.platform, url: p.url, caption: p.caption, thumbnailUrl: p.thumbnailUrl,
        views: p.views, likes: p.likes, comments: p.comments, creatorId: p.creatorId, creatorName: nameById.get(p.creatorId) ?? "—",
        postedAt: p.postedAt,
      }));

    const perCreator = new Map<string, { views: number; posts: number }>();
    for (const p of posts) {
      const c = perCreator.get(p.creatorId) ?? { views: 0, posts: 0 };
      c.views += p.views; c.posts += 1;
      perCreator.set(p.creatorId, c);
    }
    const topCreators = [...perCreator.entries()]
      .map(([id, v]) => ({ creatorId: id, name: nameById.get(id) ?? "—", views: v.views, posts: v.posts }))
      .sort((a, b) => b.views - a.views);

    const totals = {
      posts: posts.length,
      views: posts.reduce((s, p) => s + p.views, 0),
      likes: posts.reduce((s, p) => s + p.likes, 0),
      comments: posts.reduce((s, p) => s + p.comments, 0),
      shares: posts.reduce((s, p) => s + p.shares, 0),
      viewsGained: hasGained ? viewsGained.reduce((s, g) => s + (g.viewsGained ?? 0), 0) : null,
      followers: hasFollowers ? followers[followers.length - 1].followers : null,
      creators: creators.length,
    };

    return ok({
      from, to, timeZone: tz, series,
      viewsGained: hasGained ? viewsGained : [],
      followers: hasFollowers ? followers : [],
      topVideos, topCreators, totals,
    });
  } catch (e) {
    return serverError(e);
  }
}
