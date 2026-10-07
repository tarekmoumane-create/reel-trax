import { ok, serverError } from "@/lib/api";
import { syncAppDownloads } from "@/lib/appstore";

export const maxDuration = 300;

// Pull App Store downloads now — also the "does this key work?" check from
// Settings. Body: { clientId?, days? } (days = how far back, max 366).
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const clientId = typeof body?.clientId === "string" ? body.clientId : undefined;
    const days = Number(body?.days) > 0 ? Number(body.days) : undefined;
    const result = await syncAppDownloads({ clientId, days });
    return ok(result, { status: result.ok ? 200 : 400 });
  } catch (e) {
    return serverError(e);
  }
}
