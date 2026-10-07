import { prisma } from "@/lib/db";
import { ok, bad, serverError } from "@/lib/api";
import { computeCadence } from "@/lib/cadence";
import { getTimeZone } from "@/lib/settings";
import { avgEngagement } from "@/lib/engagement";
import { detectShadowBans } from "@/lib/shadowban";
import { parseTikTokHandle, parseInstagramHandle, parseYouTube, parseThreadsHandle, parseFacebook } from "@/lib/scrapecreators";

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
    // same 30-day window the Creators list uses, so the two numbers agree
    const cutoff30 = Date.now() - 30 * 86_400_000;
    const engagement30d = avgEngagement(creator.posts.filter((p) => p.postedAt.getTime() >= cutoff30));
    const shadowBans = detectShadowBans(creator.posts, { timeZone: tz });
    return ok({ creator, cadence, engagement30d, shadowBans });
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
      "sideshiftUrl",
      "paymentMethod",
      "paymentHandle",
      "phone",
      "email",
      "contactHandle",
      "discord",
      "discordChannel",
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
    if ("youtubeUrl" in body) {
      const u = (body.youtubeUrl ?? "").trim() || null;
      const yt = parseYouTube(u ?? "");
      data.youtubeUrl = u;
      data.youtubeHandle = yt.handle;
      data.youtubeChannelId = yt.channelId; // re-resolved on next sync when null
    }
    if ("threadsUrl" in body) {
      const u = (body.threadsUrl ?? "").trim() || null;
      data.threadsUrl = u;
      data.threadsHandle = u ? parseThreadsHandle(u) : null;
    }
    if ("facebookUrl" in body) {
      const fb = parseFacebook((body.facebookUrl ?? "").trim());
      data.facebookUrl = fb.url;
      data.facebookHandle = fb.handle;
      data.facebookPageId = null; // re-resolved on next sync
    }
    if ("expectedPerWeek" in body) {
      data.expectedPerWeek = Math.max(
        1,
        Math.min(21, Math.round(Number(body.expectedPerWeek) || 7))
      );
    }

    if ("onboardedAt" in body)
      data.onboardedAt = body.onboardedAt ? new Date(body.onboardedAt) : null;

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
