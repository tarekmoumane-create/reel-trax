import { prisma } from "@/lib/db";
import { ok, bad, serverError } from "@/lib/api";
import { parsePayExclusions } from "@/lib/payouts";

// Per-video payout flags: which pay components this video is excluded from.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    if (!("payExclusions" in body)) return bad("payExclusions is required");

    let list = parsePayExclusions(JSON.stringify(body.payExclusions ?? []));
    // "all" makes the finer-grained flags moot — store it alone.
    if (list.includes("all")) list = ["all"];

    const post = await prisma.post.update({
      where: { id },
      data: { payExclusions: list.length ? JSON.stringify(list) : null },
    });
    return ok({ id: post.id, payExclusions: list });
  } catch (e) {
    return serverError(e);
  }
}
