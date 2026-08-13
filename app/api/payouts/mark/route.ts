import { prisma } from "@/lib/db";
import { ok, bad, serverError } from "@/lib/api";
import { periodBounds, computeEarnings, effectiveRules, parseViewTiers, type CampaignRules } from "@/lib/payouts";

// Mark a computed payout period as paid/cancelled (stores a record), or revert
// to "due" (removes the record so it re-computes live).
export async function POST(request: Request) {
  try {
    const b = await request.json();
    const campaignId = b?.campaignId;
    const creatorId = b?.creatorId;
    const periodStart = b?.periodStart ? new Date(b.periodStart) : null;
    const status = b?.status; // paid | cancelled | due
    if (!campaignId || !creatorId || !periodStart || isNaN(periodStart.getTime()))
      return bad("campaignId, creatorId and periodStart are required");

    if (status === "due") {
      await prisma.payout
        .delete({ where: { campaignId_creatorId_periodStart: { campaignId, creatorId, periodStart } } })
        .catch(() => null);
      return ok({ status: "due" });
    }
    if (status !== "paid" && status !== "cancelled") return bad("Invalid status");

    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) return bad("Campaign not found", 404);
    const link = await prisma.campaignCreator.findUnique({
      where: { campaignId_creatorId: { campaignId, creatorId } },
    });
    const posts = await prisma.post.findMany({
      where: { creatorId, creator: { campaignLinks: { some: { campaignId } } } },
      select: { postedAt: true, views: true },
    });

    const bounds = periodBounds(campaign.period, periodStart);
    const baseRules: CampaignRules = {
      period: campaign.period, targetVideos: campaign.targetVideos, baseFee: campaign.baseFee,
      perPost: campaign.perPost, cpmRate: campaign.cpmRate, cpmBasis: campaign.cpmBasis,
      cpmCapPerVideo: campaign.cpmCapPerVideo, viewTiers: parseViewTiers(campaign.viewTiers),
      bonus: campaign.bonus, minViews: campaign.minViews, payoutCap: campaign.payoutCap,
    };
    const e = computeEarnings(
      effectiveRules(baseRules, link ? { ...link, viewTiers: parseViewTiers(link.viewTiers) } : null),
      posts,
      bounds
    );

    const record = await prisma.payout.upsert({
      where: { campaignId_creatorId_periodStart: { campaignId, creatorId, periodStart: bounds.start } },
      create: {
        campaignId, creatorId, periodStart: bounds.start, periodEnd: bounds.end,
        amount: status === "cancelled" ? 0 : e.amount, currency: campaign.currency, status,
        postsCount: e.qualifyingPosts, viewsCount: e.qualifyingViews,
        paidAt: status === "paid" ? new Date() : null,
      },
      update: {
        amount: status === "cancelled" ? 0 : e.amount, status,
        paidAt: status === "paid" ? new Date() : null,
      },
    });
    return ok(record);
  } catch (e) {
    return serverError(e);
  }
}
