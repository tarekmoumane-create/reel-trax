import { prisma } from "@/lib/db";
import { ok, bad, serverError } from "@/lib/api";

// All posts for a client's creators, newest or top-performing first.
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get("clientId");
    if (!clientId) return bad("clientId is required");
    const sort = searchParams.get("sort") || "recent"; // recent | views
    const platform = searchParams.get("platform"); // tiktok | instagram | youtube | null
    const limit = Math.min(500, Number(searchParams.get("limit")) || 200);

    const posts = await prisma.post.findMany({
      where: {
        creator: { clientId },
        ...(platform ? { platform } : {}),
      },
      orderBy: sort === "views" ? { views: "desc" } : { postedAt: "desc" },
      take: limit,
      include: { creator: { select: { id: true, displayName: true } } },
    });

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
        creatorId: p.creator.id,
        creatorName: p.creator.displayName,
      }))
    );
  } catch (e) {
    return serverError(e);
  }
}
