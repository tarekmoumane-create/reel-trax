import { prisma } from "@/lib/db";
import { ok, bad, serverError } from "@/lib/api";
import { getScrapeCreatorsKey } from "@/lib/settings";
import { syncCreators } from "@/lib/sync";
import { dedupePosts } from "@/lib/dedupe";

export const maxDuration = 300; // allow long-running sync on Vercel

// Runs on a schedule (see vercel.json). Also callable manually with the secret.
// Auth: Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. We also accept
// `?key=` for manual/local triggering.
function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // no secret configured → allow (e.g. local dev)
  const auth = request.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  const url = new URL(request.url);
  return url.searchParams.get("key") === secret;
}

async function run(request: Request) {
  if (!authorized(request)) return bad("Unauthorized", 401);

  const apiKey = await getScrapeCreatorsKey();
  if (!apiKey) return bad("No ScrapeCreators API key configured", 400);

  const url = new URL(request.url);
  const clientId = url.searchParams.get("clientId") || undefined;

  // Collapse any posts stored twice under drifting ids before refreshing.
  const deduped = await dedupePosts();

  const creators = await prisma.creator.findMany({
    where: {
      status: "active",
      ...(clientId ? { clientId } : {}),
      OR: [
        { tiktokHandle: { not: null } },
        { instagramHandle: { not: null } },
        { tiktokUserId: { not: null } },
        { youtubeHandle: { not: null } },
        { youtubeChannelId: { not: null } },
        { youtubeUrl: { not: null } },
        { threadsHandle: { not: null } },
        { facebookUrl: { not: null } },
      ],
    },
  });

  const started = Date.now();
  const results = await syncCreators(creators, apiKey, 3);
  const ms = Date.now() - started;

  const upserted = results
    .flatMap((r) => r.results)
    .reduce((n, r) => n + r.upserted, 0);
  const failed = results.filter((r) => !r.ok).length;

  return ok({
    ranAt: new Date().toISOString(),
    creators: creators.length,
    postsUpserted: upserted,
    failedCreators: failed,
    durationMs: ms,
    deduped,
  });
}

export async function GET(request: Request) {
  try {
    return await run(request);
  } catch (e) {
    return serverError(e);
  }
}

export async function POST(request: Request) {
  try {
    return await run(request);
  } catch (e) {
    return serverError(e);
  }
}
