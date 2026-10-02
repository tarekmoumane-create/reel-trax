import { prisma } from "@/lib/db";
import { ok, bad, serverError } from "@/lib/api";
import { dayKey } from "@/lib/cadence";
import { getTimeZone } from "@/lib/settings";
import { engagementRate } from "@/lib/engagement";

const DAY = 86_400_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// All posts for a client's creators, newest or top-performing first.
// Filters: platform, posted-on date window, minimum views, one creator, or the
// creators assigned to one campaign. `limit` goes up to 5000 so an export can
// take every matching video, not just the page on screen.
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get("clientId");
    if (!clientId) return bad("clientId is required");
    const sort = searchParams.get("sort") || "recent"; // recent | views | engagement
    const platform = searchParams.get("platform"); // tiktok | instagram | youtube | threads | facebook | null
    const limit = Math.min(5000, Number(searchParams.get("limit")) || 200);
    const minViews = Math.max(0, Math.floor(Number(searchParams.get("minViews")) || 0));
    const creatorId = searchParams.get("creatorId");
    const campaignId = searchParams.get("campaignId");

    // Optional posted-on date window (YYYY-MM-DD, inclusive). Absent = all time.
    const from = searchParams.get("from") ?? "";
    const to = searchParams.get("to") ?? "";
    const ranged = DATE_RE.test(from) && DATE_RE.test(to) && from <= to;
    const tz = ranged ? await getTimeZone() : "";

    const byEngagement = sort === "engagement";
    const fetched = await prisma.post.findMany({
      where: {
        creator: {
          clientId,
          ...(campaignId ? { campaignLinks: { some: { campaignId } } } : {}),
        },
        ...(creatorId ? { creatorId } : {}),
        ...(platform ? { platform } : {}),
        ...(minViews ? { views: { gte: minViews } } : {}),
        // ±1 day of slack: postedAt is UTC but the window is in app-local days,
        // so boundary posts straddle the query edges. dayKey trims below.
        ...(ranged
          ? {
              postedAt: {
                gte: new Date(new Date(`${from}T00:00:00Z`).getTime() - DAY),
                lte: new Date(new Date(`${to}T00:00:00Z`).getTime() + 2 * DAY),
              },
            }
          : {}),
      },
      orderBy: sort === "views" ? { views: "desc" } : { postedAt: "desc" },
      // A rate can't be ordered by in the query, so engagement sorts in memory
      // over every match — like a date window, it takes the limit afterwards.
      ...(ranged || byEngagement ? {} : { take: limit }),
      include: { creator: { select: { id: true, displayName: true } } },
    });

    const inWindow = ranged
      ? fetched.filter((p) => {
          const k = dayKey(p.postedAt, tz);
          return k >= from && k <= to;
        })
      : fetched;
    // videos with no view count have no rate — they sort last
    if (byEngagement) inWindow.sort((a, b) => (engagementRate(b) ?? -1) - (engagementRate(a) ?? -1));
    const posts = inWindow.slice(0, limit);

    // A cross-post group can straddle the platform filter and the page limit,
    // so group size comes from a count, not from what happens to be on screen.
    const keys = [...new Set(posts.map((p) => p.groupKey).filter((k): k is string => k != null))];
    const sizes = new Map<string, number>();
    if (keys.length) {
      for (const g of await prisma.post.groupBy({ by: ["groupKey"], where: { groupKey: { in: keys } }, _count: { _all: true } })) {
        if (g.groupKey) sizes.set(g.groupKey, g._count._all);
      }
    }

    return ok(
      posts.map((p) => ({
        id: p.id,
        platform: p.platform,
        url: p.url,
        caption: p.caption,
        thumbnailUrl: p.thumbnailUrl,
        postedAt: p.postedAt,
        views: p.views,
        likes: p.likes,
        comments: p.comments,
        shares: p.shares,
        source: p.source,
        payExclusions: p.payExclusions,
        isWarmUp: p.isWarmUp,
        payOverride: p.payOverride,
        groupKey: p.groupKey,
        groupPinned: p.groupPinned,
        groupSize: p.groupKey ? sizes.get(p.groupKey) ?? 1 : 1,
        creatorId: p.creator.id,
        creatorName: p.creator.displayName,
      }))
    );
  } catch (e) {
    return serverError(e);
  }
}
