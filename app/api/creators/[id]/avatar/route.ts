import { prisma } from "@/lib/db";
import { downloadImage } from "@/lib/avatar";

// Serves the creator's stored profile picture.
//
// The image is normally captured during the creator's first sync. If we only
// have the platform URL (a creator synced before pictures were stored), the
// first request downloads and keeps it, so the roster heals itself as it's
// browsed instead of waiting for a sync.
//
// No picture at all → 404, and the Avatar component draws initials.

function imageResponse(data: Uint8Array, mime: string | null, stamp: Date | null) {
  return new Response(data as unknown as BodyInit, {
    headers: {
      "content-type": mime || "image/jpeg",
      "cache-control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800",
      "x-content-type-options": "nosniff",
      ...(stamp ? { etag: `"${stamp.getTime()}"` } : {}),
    },
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const creator = await prisma.creator.findUnique({
    where: { id },
    select: { avatarData: true, avatarMime: true, avatarUrl: true, avatarAt: true },
  });
  if (!creator) return new Response(null, { status: 404 });

  if (creator.avatarData) {
    const tag = creator.avatarAt ? `"${creator.avatarAt.getTime()}"` : null;
    if (tag && request.headers.get("if-none-match") === tag) {
      return new Response(null, { status: 304 });
    }
    return imageResponse(creator.avatarData, creator.avatarMime, creator.avatarAt);
  }

  if (!creator.avatarUrl) return new Response(null, { status: 404 });

  const image = await downloadImage(creator.avatarUrl);
  if (!image) return new Response(null, { status: 404 });

  const avatarAt = new Date();
  await prisma.creator.update({
    where: { id },
    data: { avatarData: image.data, avatarMime: image.mime, avatarAt },
  });
  return imageResponse(image.data, image.mime, avatarAt);
}
