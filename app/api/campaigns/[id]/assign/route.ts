import { prisma } from "@/lib/db";
import { ok, bad, serverError } from "@/lib/api";
import { parsePayRules } from "@/lib/payouts";
import { syncAutoCampaign } from "@/lib/autocampaign";

// Sync the campaign's creator assignments to the provided set. Existing links
// are kept as-is (so hand-tuned rate overrides survive a reassign); new links
// are seeded from the creator's personal deal (payRules) when they have one —
// that's how individualized client pay flows into payout math.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const b = await request.json();
    const creatorIds: string[] = Array.isArray(b?.creatorIds) ? b.creatorIds : [];

    const campaign = await prisma.campaign.findUnique({ where: { id } });
    if (!campaign) return bad("Campaign not found", 404);

    // keep only creators that belong to this campaign's client
    const valid = await prisma.creator.findMany({
      where: { id: { in: creatorIds }, clientId: campaign.clientId },
      select: { id: true, payRules: true },
    });
    const validIds = new Set(valid.map((v) => v.id));

    const existing = await prisma.campaignCreator.findMany({
      where: { campaignId: id },
      select: { creatorId: true },
    });
    const existingIds = new Set(existing.map((e) => e.creatorId));

    const toRemove = [...existingIds].filter((cid) => !validIds.has(cid));
    const toAdd = valid.filter((v) => !existingIds.has(v.id));

    await prisma.$transaction([
      ...(toRemove.length
        ? [prisma.campaignCreator.deleteMany({ where: { campaignId: id, creatorId: { in: toRemove } } })]
        : []),
      ...(toAdd.length
        ? [prisma.campaignCreator.createMany({
            data: toAdd.map((v) => {
              const deal = parsePayRules(v.payRules);
              return {
                campaignId: id,
                creatorId: v.id,
                baseFee: deal?.baseFee ?? null,
                perPost: deal?.perPost ?? null,
                cpmRate: deal?.cpmRate ?? null,
                cpmBasis: deal?.cpmBasis ?? null,
                cpmCapPerVideo: deal?.cpmCapPerVideo ?? null,
                viewTiers: deal?.viewTiers?.length ? JSON.stringify(deal.viewTiers) : null,
                bonus: deal?.bonus ?? null,
                minViews: deal?.minViews ?? null,
                viewWindowDays: deal?.viewWindowDays ?? null,
                payoutCap: deal?.payoutCap ?? null,
                flatDeal: deal?.flatDeal ?? null,
                note: deal?.note ?? (deal ? "personal deal" : null),
              };
            }),
          })]
        : []),
    ]);

    // Manual assignments changed — creators now covered by (or freed from) a
    // manual campaign move out of / back into the client's auto campaign.
    await syncAutoCampaign(campaign.clientId);

    return ok({ assigned: validIds.size });
  } catch (e) {
    return serverError(e);
  }
}
