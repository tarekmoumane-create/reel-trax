import { prisma } from "@/lib/db";
import { ok, bad, serverError } from "@/lib/api";
import { getScrapeCreatorsKey } from "@/lib/settings";
import { syncCreators } from "@/lib/sync";

export const maxDuration = 300;

// In-app "Sync now" for the current client. Same trust level as the rest of
// the app (no separate secret) — the cron route stays secret-gated for Vercel.
export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get("clientId");
    if (!clientId) return bad("clientId is required");

    const apiKey = await getScrapeCreatorsKey();
    if (!apiKey)
      return bad("No ScrapeCreators API key set. Add it in Settings.", 400);

    const creators = await prisma.creator.findMany({
      where: {
        clientId,
        status: "active",
        OR: [
          { tiktokHandle: { not: null } },
          { instagramHandle: { not: null } },
          { tiktokUserId: { not: null } },
        ],
      },
    });

    const results = await syncCreators(creators, apiKey, 3);
    const upserted = results
      .flatMap((r) => r.results)
      .reduce((n, r) => n + r.upserted, 0);
    const failed = results.filter((r) => !r.ok).length;

    return ok({ creators: creators.length, postsUpserted: upserted, failed });
  } catch (e) {
    return serverError(e);
  }
}
