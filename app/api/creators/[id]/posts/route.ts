import { prisma } from "@/lib/db";
import { ok, bad, serverError } from "@/lib/api";

// Manual post logging — a fallback for creators/platforms that auto-sync can't
// reach, or to backfill history. Auto-sync never overwrites manual entries.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const creator = await prisma.creator.findUnique({ where: { id } });
    if (!creator) return bad("Creator not found", 404);

    const body = await request.json();
    const url = (body?.url ?? "").trim();
    let platform: string | null = body?.platform ?? null;
    if (!platform && url) {
      if (/tiktok\.com/i.test(url)) platform = "tiktok";
      else if (/instagram\.com/i.test(url)) platform = "instagram";
      else if (/youtube\.com|youtu\.be/i.test(url)) platform = "youtube";
      else if (/threads\.(?:net|com)/i.test(url)) platform = "threads";
    }
    if (!platform || !["tiktok", "instagram", "youtube", "threads"].includes(platform))
      return bad("platform must be tiktok, instagram, youtube or threads");

    const postedAt = body?.postedAt ? new Date(body.postedAt) : new Date();
    if (isNaN(postedAt.getTime())) return bad("Invalid postedAt date");

    // Derive an id from the URL when possible, else a manual key.
    let platformPostId: string | null = null;
    const m =
      url.match(/tiktok\.com\/@[^/]+\/video\/(\d+)/i) ||
      url.match(/instagram\.com\/(?:p|reel|reels)\/([^/?#]+)/i) ||
      url.match(/youtube\.com\/(?:shorts|watch\?v=)([A-Za-z0-9_-]{6,})/i) ||
      url.match(/youtu\.be\/([A-Za-z0-9_-]{6,})/i) ||
      url.match(/threads\.(?:net|com)\/@[^/]+\/post\/([A-Za-z0-9_-]+)/i);
    if (m) platformPostId = m[1];
    if (!platformPostId)
      platformPostId = `manual-${id}-${postedAt.getTime()}`;

    const post = await prisma.post.upsert({
      where: { platform_platformPostId: { platform, platformPostId } },
      create: {
        creatorId: id,
        platform,
        platformPostId,
        url: url || null,
        caption: body?.caption || null,
        postedAt,
        views: Number(body?.views) || 0,
        likes: Number(body?.likes) || 0,
        source: "manual",
      },
      update: {
        postedAt,
        views: Number(body?.views) || undefined,
        caption: body?.caption || undefined,
      },
    });
    return ok(post, { status: 201 });
  } catch (e) {
    return serverError(e);
  }
}
