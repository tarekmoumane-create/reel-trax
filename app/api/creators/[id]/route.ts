import { prisma } from "@/lib/db";
import { ok, bad, serverError } from "@/lib/api";
import { computeCadence } from "@/lib/cadence";
import { getTimeZone } from "@/lib/settings";
import { parseTikTokHandle, parseInstagramHandle } from "@/lib/scrapecreators";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const creator = await prisma.creator.findUnique({
      where: { id },
      include: {
        client: true,
        posts: { orderBy: { postedAt: "desc" } },
      },
    });
    if (!creator) return bad("Creator not found", 404);
    const tz = await getTimeZone();
    const cadence = computeCadence(creator.posts, {
      expectedPerWeek: creator.expectedPerWeek,
      timeZone: tz,
    });
    return ok({ creator, cadence });
  } catch (e) {
    return serverError(e);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const data: Record<string, unknown> = {};

    const strFields = [
      "displayName",
      "source",
      "sourceDetail",
      "phone",
      "email",
      "contactHandle",
      "discord",
      "whatsapp",
      "preferredChannel",
      "status",
      "notes",
    ];
    for (const f of strFields) {
      if (f in body) data[f] = body[f] === "" ? null : body[f];
    }

    if ("tiktokUrl" in body) {
      const u = (body.tiktokUrl ?? "").trim() || null;
      data.tiktokUrl = u;
      data.tiktokHandle = u ? parseTikTokHandle(u) : null;
      data.tiktokUserId = null; // re-resolve on next sync
    }
    if ("instagramUrl" in body) {
      const u = (body.instagramUrl ?? "").trim() || null;
      data.instagramUrl = u;
      data.instagramHandle = u ? parseInstagramHandle(u) : null;
    }
    if ("expectedPerWeek" in body) {
      data.expectedPerWeek = Math.max(
        1,
        Math.min(21, Math.round(Number(body.expectedPerWeek) || 7))
      );
    }

    // Comms shortcuts
    if (body.markContactedNow === true) data.lastContactedAt = new Date();
    if ("lastContactedAt" in body)
      data.lastContactedAt = body.lastContactedAt ? new Date(body.lastContactedAt) : null;
    if ("followUpAt" in body)
      data.followUpAt = body.followUpAt ? new Date(body.followUpAt) : null;

    const creator = await prisma.creator.update({ where: { id }, data });
    return ok(creator);
  } catch (e) {
    return serverError(e);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await prisma.creator.delete({ where: { id } });
    return ok({ deleted: true });
  } catch (e) {
    return serverError(e);
  }
}
