import { prisma } from "@/lib/db";
import { ok, bad, serverError } from "@/lib/api";
import { dayKey } from "@/lib/cadence";
import { getTimeZone } from "@/lib/settings";

const DAY = 86_400_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// All posts for a client's creators, newest or top-performing first.
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get("clientId");
    if (!clientId) return bad("clientId is required");
    const sort = searchParams.get("sort") || "recent"; // recent | views
    const platform = searchParams.get("platform"); // tiktok | instagram | youtube | threads | facebook | null
    const limit = Math.min(500, Number(searchParams.get("limit")) || 200);

    // Optional posted-on date window (YYYY-MM-DD, inclusive). Absent = all time.
    const from = searchParams.get("from") ?? "";
    const to = searchParams.get("to") ?? "";
    const ranged = DATE_RE.test(from) && DATE_RE.test(to) && from <= to;
    const tz = ranged ? await getTimeZone() : "";

    const fetched = await prisma.post.findMany({
      where: {
        creator: { clientId },
        ...(platform ? { platform } : {}),
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
      ...(ranged ? {} : { take: limit }),
      include: { creator: { select: { id: true, displayName: true } } },
    });

    const posts = ranged
      ? fetched
          .filter((p) => {
            const k = dayKey(p.postedAt, tz);
            return k >= from && k <= to;
          })
          .slice(0, limit)
      : fetched;

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
