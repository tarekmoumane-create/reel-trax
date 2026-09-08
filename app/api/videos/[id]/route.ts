import { prisma } from "@/lib/db";
import { ok, bad, serverError } from "@/lib/api";
import { parsePayExclusions } from "@/lib/payouts";

// Per-video pay settings: which components it counts toward, whether it's a
// warm-up post, and an optional hand-set price. Any subset may be sent.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const data: { payExclusions?: string | null; isWarmUp?: boolean; payOverride?: number | null } = {};

    if ("payExclusions" in body) {
      let list = parsePayExclusions(JSON.stringify(body.payExclusions ?? []));
      // "all" makes the finer-grained flags moot — store it alone.
      if (list.includes("all")) list = ["all"];
      data.payExclusions = list.length ? JSON.stringify(list) : null;
    }
    if ("isWarmUp" in body) data.isWarmUp = body.isWarmUp === true;
    if ("payOverride" in body) {
      if (body.payOverride === null || body.payOverride === "") data.payOverride = null;
      else {
        const n = Number(body.payOverride);
        if (!Number.isFinite(n) || n < 0) return bad("payOverride must be a non-negative number");
        data.payOverride = Math.round(n * 100) / 100;
      }
    }
    if (Object.keys(data).length === 0) return bad("Nothing to update");

    const post = await prisma.post.update({ where: { id }, data });
    return ok({
      id: post.id,
      payExclusions: parsePayExclusions(post.payExclusions),
      isWarmUp: post.isWarmUp,
      payOverride: post.payOverride,
    });
  } catch (e) {
    return serverError(e);
  }
}
