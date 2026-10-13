import { prisma } from "@/lib/db";
import { ok, bad, serverError } from "@/lib/api";
import { sanitizePayRules } from "@/lib/payouts";
import { syncAutoCampaign } from "@/lib/autocampaign";
import { parseTikTokHandle, parseInstagramHandle, parseYouTube, parseThreadsHandle, parseFacebook, resolveSnapchat } from "@/lib/scrapecreators";
import { getScrapeCreatorsKey } from "@/lib/settings";
import { syncCreator } from "@/lib/sync";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get("clientId");
    if (!clientId) return bad("clientId is required");
    const creators = await prisma.creator.findMany({
      where: { clientId },
      orderBy: { createdAt: "asc" },
    });
    return ok(creators);
  } catch (e) {
    return serverError(e);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const clientId = (body?.clientId ?? "").trim();
    const displayName = (body?.displayName ?? "").trim();
    if (!clientId) return bad("clientId is required");
    if (!displayName) return bad("Creator name is required");

    const tiktokUrl = (body?.tiktokUrl ?? "").trim() || null;
    const instagramUrl = (body?.instagramUrl ?? "").trim() || null;
    const tiktokHandle = tiktokUrl
      ? parseTikTokHandle(tiktokUrl)
      : parseTikTokHandle((body?.tiktokHandle ?? "").trim());
    const instagramHandle = instagramUrl
      ? parseInstagramHandle(instagramUrl)
      : parseInstagramHandle((body?.instagramHandle ?? "").trim());
    const youtubeUrl = (body?.youtubeUrl ?? "").trim() || null;
    const yt = parseYouTube(youtubeUrl ?? (body?.youtubeHandle ?? "").trim());
    const threadsUrl = (body?.threadsUrl ?? "").trim() || null;
    const threadsHandle = parseThreadsHandle(threadsUrl ?? (body?.threadsHandle ?? "").trim());
    const fb = parseFacebook((body?.facebookUrl ?? "").trim() || (body?.facebookHandle ?? "").trim());
    const snap = await resolveSnapchat((body?.snapchatUrl ?? "").trim() || (body?.snapchatHandle ?? "").trim());
    const snapchatUrl = snap.url;
    const snapchatHandle = snap.handle;

    const creator = await prisma.creator.create({
      data: {
        clientId,
        displayName,
        tiktokUrl,
        tiktokHandle,
        instagramUrl,
        instagramHandle,
        youtubeUrl,
        youtubeHandle: yt.handle,
        youtubeChannelId: yt.channelId,
        threadsUrl,
        threadsHandle,
        facebookUrl: fb.url,
        facebookHandle: fb.handle,
        snapchatUrl,
        snapchatHandle,
        source: body?.source || "sideshift",
        sourceDetail: body?.sourceDetail || null,
        sideshiftUrl: body?.sideshiftUrl || null,
        paymentMethod: body?.paymentMethod || "sideshift",
        paymentHandle: body?.paymentHandle || null,
        payRules: (() => {
          const rules = sanitizePayRules(body?.payRules);
          return rules ? JSON.stringify(rules) : null;
        })(),
        phone: body?.phone || null,
        email: body?.email || null,
        contactHandle: body?.contactHandle || null,
        discord: body?.discord || null,
        discordChannel: body?.discordChannel || null,
        whatsapp: body?.whatsapp || null,
        preferredChannel: body?.preferredChannel || null,
        expectedPerWeek: Number.isFinite(body?.expectedPerWeek)
          ? Math.max(1, Math.min(21, Math.round(body.expectedPerWeek)))
          : 7,
        // Defaults to "now" — most creators get added the day they onboard.
        onboardedAt: (() => {
          const d = body?.onboardedAt ? new Date(body.onboardedAt) : new Date();
          return isNaN(d.getTime()) ? new Date() : d;
        })(),
        status: body?.status || "active",
        notes: body?.notes || null,
      },
    });

    // New creators join the client's auto campaign so payouts track right away.
    await syncAutoCampaign(clientId);

    // Best-effort immediate first sync so the creator isn't blank on arrival.
    let firstSync: unknown = null;
    const apiKey = await getScrapeCreatorsKey();
    if (apiKey && (tiktokHandle || instagramHandle || youtubeUrl || threadsHandle || fb.url || snapchatHandle)) {
      try {
        firstSync = await syncCreator(creator, apiKey);
      } catch {
        // ignore — background cron will retry
      }
    }

    return ok({ creator, firstSync }, { status: 201 });
  } catch (e) {
    return serverError(e);
  }
}
