import { prisma } from "@/lib/db";
import { ok, bad, serverError } from "@/lib/api";
import { periodBounds, computeEarnings, effectiveRules, parseViewTiers, type CampaignRules } from "@/lib/payouts";
import { syncAutoCampaign } from "@/lib/autocampaign";

function rulesOf(c: {
  period: string;
  targetVideos: number | null;
  baseFee: number;
  perPost: number;
  cpmRate: number;
  cpmBasis: string;
  cpmCapPerVideo: number | null;
  viewTiers: string | null;
  bonus: number;
  minViews: number;
  viewWindowDays: number | null;
  payoutCap: number | null;
}): CampaignRules {
  return {
    period: c.period,
    targetVideos: c.targetVideos,
    baseFee: c.baseFee,
    perPost: c.perPost,
    cpmRate: c.cpmRate,
    cpmBasis: c.cpmBasis,
    cpmCapPerVideo: c.cpmCapPerVideo,
    viewTiers: parseViewTiers(c.viewTiers),
    bonus: c.bonus,
    minViews: c.minViews,
    viewWindowDays: c.viewWindowDays,
    payoutCap: c.payoutCap,
  };
}

export async function GET(_r: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const campaign = await prisma.campaign.findUnique({
      where: { id },
      include: {
        assignments: { include: { creator: { include: { posts: { select: { postedAt: true, views: true, payExclusions: true, snapshots: { select: { day: true, views: true } } } } } } } },
      },
    });
    if (!campaign) return bad("Campaign not found", 404);

    const bounds = periodBounds(campaign.period);
    const baseRules = rulesOf(campaign);
    const creators = campaign.assignments.map((a) => {
      const overrideTiers = parseViewTiers(a.viewTiers);
      const rules = effectiveRules(baseRules, { ...a, viewTiers: overrideTiers });
      const earnings = computeEarnings(rules, a.creator.posts, bounds);
      const overridden =
        a.baseFee != null || a.perPost != null || a.cpmRate != null ||
        a.cpmBasis != null || a.cpmCapPerVideo != null || overrideTiers.length > 0 ||
        a.bonus != null || a.minViews != null || a.viewWindowDays != null ||
        a.payoutCap != null || a.flatDeal != null;
      return {
        creatorId: a.creator.id,
        displayName: a.creator.displayName,
        earnings,
        overridden,
        override: {
          baseFee: a.baseFee, perPost: a.perPost, cpmRate: a.cpmRate,
          cpmBasis: a.cpmBasis, cpmCapPerVideo: a.cpmCapPerVideo, viewTiers: overrideTiers,
          bonus: a.bonus, minViews: a.minViews, viewWindowDays: a.viewWindowDays,
          payoutCap: a.payoutCap, flatDeal: a.flatDeal, note: a.note,
        },
      };
    });
    const periodTotal = creators.reduce((s, c) => s + c.earnings.amount, 0);

    return ok({ campaign, period: { ...bounds, total: Math.round(periodTotal * 100) / 100 }, creators });
  } catch (e) {
    return serverError(e);
  }
}

const NUM = (v: unknown, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const b = await request.json();
    const data: Record<string, unknown> = {};
    if ("name" in b) data.name = String(b.name).trim();
    if ("status" in b) data.status = b.status;
    if ("period" in b) data.period = b.period === "weekly" ? "weekly" : "monthly";
    if ("targetVideos" in b) data.targetVideos = b.targetVideos === "" || b.targetVideos == null ? null : NUM(b.targetVideos);
    if ("startDate" in b) data.startDate = b.startDate ? new Date(b.startDate) : null;
    if ("endDate" in b) data.endDate = b.endDate ? new Date(b.endDate) : null;
    for (const f of ["baseFee", "perPost", "cpmRate", "bonus", "minViews"]) if (f in b) data[f] = NUM(b[f]);
    if ("viewWindowDays" in b) data.viewWindowDays = b.viewWindowDays === "" || b.viewWindowDays == null ? null : Math.round(NUM(b.viewWindowDays));
    if ("cpmBasis" in b) data.cpmBasis = b.cpmBasis === "perVideo" ? "perVideo" : "aggregate";
    if ("cpmCapPerVideo" in b) data.cpmCapPerVideo = b.cpmCapPerVideo === "" || b.cpmCapPerVideo == null ? null : NUM(b.cpmCapPerVideo);
    if ("viewTiers" in b) {
      const tiers = parseViewTiers(JSON.stringify(b.viewTiers ?? null));
      data.viewTiers = tiers.length ? JSON.stringify(tiers) : null;
    }
    if ("payoutCap" in b) data.payoutCap = b.payoutCap === "" || b.payoutCap == null ? null : NUM(b.payoutCap);
    if ("currency" in b) data.currency = b.currency;

    const campaign = await prisma.campaign.update({ where: { id }, data });
    return ok(campaign);
  } catch (e) {
    return serverError(e);
  }
}

export async function DELETE(_r: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const campaign = await prisma.campaign.delete({ where: { id } });
    // Deleting a manual campaign frees its creators back into the auto campaign.
    if (!campaign.isAuto) await syncAutoCampaign(campaign.clientId);
    return ok({ deleted: true });
  } catch (e) {
    return serverError(e);
  }
}
