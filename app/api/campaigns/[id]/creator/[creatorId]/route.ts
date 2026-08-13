import { prisma } from "@/lib/db";
import { ok, bad, serverError } from "@/lib/api";
import { parseViewTiers } from "@/lib/payouts";

const numOrNull = (v: unknown) => (v === "" || v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);

// Set (or clear) per-creator payout overrides within a campaign.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; creatorId: string }> }
) {
  try {
    const { id, creatorId } = await params;
    const b = await request.json();
    const link = await prisma.campaignCreator.findUnique({
      where: { campaignId_creatorId: { campaignId: id, creatorId } },
    });
    if (!link) return bad("Creator is not assigned to this campaign", 404);

    const updated = await prisma.campaignCreator.update({
      where: { campaignId_creatorId: { campaignId: id, creatorId } },
      data: {
        baseFee: numOrNull(b.baseFee),
        perPost: numOrNull(b.perPost),
        cpmRate: numOrNull(b.cpmRate),
        cpmBasis: b.cpmBasis === "perVideo" || b.cpmBasis === "aggregate" ? b.cpmBasis : null,
        cpmCapPerVideo: numOrNull(b.cpmCapPerVideo),
        viewTiers: (() => {
          const tiers = parseViewTiers(JSON.stringify(b.viewTiers ?? null));
          return tiers.length ? JSON.stringify(tiers) : null;
        })(),
        bonus: numOrNull(b.bonus),
        minViews: numOrNull(b.minViews),
        payoutCap: numOrNull(b.payoutCap),
        flatDeal: numOrNull(b.flatDeal),
        note: b.note ? String(b.note) : null,
      },
    });
    return ok(updated);
  } catch (e) {
    return serverError(e);
  }
}
