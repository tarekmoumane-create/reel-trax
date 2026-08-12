import { prisma } from "@/lib/db";
import { ok, bad, serverError } from "@/lib/api";
import { dayKey } from "@/lib/cadence";
import { getTimeZone } from "@/lib/settings";

const DAY = 86_400_000;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get("clientId");
    if (!clientId) return bad("clientId is required");
    const days = Math.min(120, Math.max(7, Number(searchParams.get("days")) || 30));
    const tz = await getTimeZone();
    const now = new Date();
    const since = new Date(now.getTime() - days * DAY);

    // day-key list, oldest → newest
    const dayList: string[] = [];
    for (let i = days - 1; i >= 0; i--) dayList.push(dayKey(new Date(now.getTime() - i * DAY), tz));

    const creators = await prisma.creator.findMany({
      where: { clientId },
      select: { id: true, displayName: true },
    });
    const creatorIds = creators.map((c) => c.id);
    const nameById = new Map(creators.map((c) => [c.id, c.displayName]));

    const posts = await prisma.post.findMany({
      where: { creatorId: { in: creatorIds }, postedAt: { gte: since } },
      select: { creatorId: true, platform: true, url: true, caption: true, thumbnailUrl: true, postedAt: true, views: true, likes: true, comments: true },
    });

    // daily posts + views
    const byDay = new Map<string, { posts: number; views: number }>();
    for (const d of dayList) byDay.set(d, { posts: 0, views: 0 });
    for (const p of posts) {
      const k = dayKey(p.postedAt, tz);
      const b = byDay.get(k);
      if (b) { b.posts += 1; b.views += p.views; }
    }
    const series = dayList.map((d) => ({ date: d, posts: byDay.get(d)!.posts, views: byDay.get(d)!.views }));

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

    // leaderboards
    const topVideos = [...posts]
      .sort((a, b) => b.views - a.views)
      .slice(0, 6)
      .map((p) => ({
        platform: p.platform, url: p.url, caption: p.caption, thumbnailUrl: p.thumbnailUrl,
        views: p.views, likes: p.likes, creatorId: p.creatorId, creatorName: nameById.get(p.creatorId) ?? "—",
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
      .sort((a, b) => b.views - a.views)
      .slice(0, 6);

    const totals = {
      posts: posts.length,
      views: posts.reduce((s, p) => s + p.views, 0),
      followers: hasFollowers ? followers[followers.length - 1].followers : null,
      creators: creators.length,
    };

    return ok({ days, series, followers: hasFollowers ? followers : [], topVideos, topCreators, totals });
  } catch (e) {
    return serverError(e);
  }
}
