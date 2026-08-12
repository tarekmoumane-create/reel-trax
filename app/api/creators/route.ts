import { prisma } from "@/lib/db";
import { ok, bad, serverError } from "@/lib/api";
import { parseTikTokHandle, parseInstagramHandle } from "@/lib/scrapecreators";
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

    const creator = await prisma.creator.create({
      data: {
        clientId,
        displayName,
        tiktokUrl,
        tiktokHandle,
        instagramUrl,
        instagramHandle,
        source: body?.source || "sideshift",
        sourceDetail: body?.sourceDetail || null,
        sideshiftUrl: body?.sideshiftUrl || null,
        paymentMethod: body?.paymentMethod || "sideshift",
        paymentHandle: body?.paymentHandle || null,
        phone: body?.phone || null,
        email: body?.email || null,
        contactHandle: body?.contactHandle || null,
        discord: body?.discord || null,
        whatsapp: body?.whatsapp || null,
        preferredChannel: body?.preferredChannel || null,
        expectedPerWeek: Number.isFinite(body?.expectedPerWeek)
          ? Math.max(1, Math.min(21, Math.round(body.expectedPerWeek)))
          : 7,
        status: body?.status || "active",
        notes: body?.notes || null,
      },
    });

    // Best-effort immediate first sync so the creator isn't blank on arrival.
    let firstSync: unknown = null;
    const apiKey = await getScrapeCreatorsKey();
    if (apiKey && (tiktokHandle || instagramHandle)) {
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
