import { prisma } from "@/lib/db";
import { ok, bad, serverError } from "@/lib/api";
import { periodBounds, periodsSince, computeEarnings, effectiveRules, parseViewTiers, type CampaignRules } from "@/lib/payouts";
import { syncAutoCampaign } from "@/lib/autocampaign";

function rulesOf(c: {
  period: string; targetVideos: number | null; baseFee: number; perPost: number;
  cpmRate: number; cpmBasis: string; cpmCapPerVideo: number | null; viewTiers: string | null;
  bonus: number; minViews: number; viewWindowDays: number | null; payoutCap: number | null;
  starterDays: number | null; starterPerPost: number | null;
}): CampaignRules {
  return {
    period: c.period, targetVideos: c.targetVideos, baseFee: c.baseFee, perPost: c.perPost,
    cpmRate: c.cpmRate, cpmBasis: c.cpmBasis, cpmCapPerVideo: c.cpmCapPerVideo, viewTiers: parseViewTiers(c.viewTiers),
    bonus: c.bonus, minViews: c.minViews, viewWindowDays: c.viewWindowDays, payoutCap: c.payoutCap,
    starterDays: c.starterDays, starterPerPost: c.starterPerPost,
  };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get("clientId");
    if (!clientId) return bad("clientId is required");

    // Self-heals: materializes the client's auto campaign + assignments so
    // payouts work for clients configured before the auto-campaign feature.
    await syncAutoCampaign(clientId);

    const campaigns = await prisma.campaign.findMany({
      where: { clientId },
      include: {
        assignments: { include: { creator: { include: { posts: { select: { postedAt: true, views: true, payExclusions: true, isWarmUp: true, payOverride: true, snapshots: { select: { day: true, views: true } } } } } } } },
        payouts: { include: { creator: { select: { displayName: true } } } },
      },
    });

    const now = new Date();
    type Row = {
      key: string; campaignId: string; campaignName: string; creatorId: string; creatorName: string;
      periodStart: string; periodEnd: string; periodLabel: string; amount: number; currency: string;
      status: string; postsCount: number; viewsCount: number;
    };
    const map = new Map<string, Row>();

    // stored records first (paid / cancelled) — these are authoritative
    for (const c of campaigns) {
      for (const p of c.payouts) {
        const key = `${c.id}|${p.creatorId}|${p.periodStart.toISOString()}`;
        map.set(key, {
          key, campaignId: c.id, campaignName: c.name, creatorId: p.creatorId, creatorName: p.creator.displayName,
          periodStart: p.periodStart.toISOString(), periodEnd: p.periodEnd.toISOString(),
          periodLabel: periodBounds(c.period, p.periodStart).label,
          amount: p.amount, currency: p.currency, status: p.status, postsCount: p.postsCount, viewsCount: p.viewsCount,
        });
      }
    }

    // Computed periods for active campaigns — every period since the campaign
    // started, not just the current one, so the live period accrues in view
    // and finished-but-unpaid periods stay visible as due.
    for (const c of campaigns) {
      if (c.status !== "active") continue;
      const baseRules = rulesOf(c);
      const periods = periodsSince(c.period, c.startDate ?? c.createdAt, now);
      for (const bounds of periods) {
        if (c.endDate && bounds.start.getTime() > c.endDate.getTime()) continue;
        const isCurrent = now.getTime() >= bounds.start.getTime() && now.getTime() <= bounds.end.getTime();
        for (const a of c.assignments) {
          const key = `${c.id}|${a.creatorId}|${bounds.start.toISOString()}`;
          if (map.has(key)) continue; // stored wins
          const e = computeEarnings(effectiveRules(baseRules, { ...a, viewTiers: parseViewTiers(a.viewTiers) }), a.creator.posts, bounds, now, { onboardedAt: a.creator.onboardedAt });
          // Skip empty past periods (nothing earned, nothing posted) — noise.
          if (!isCurrent && e.amount === 0 && e.qualifyingPosts === 0) continue;
          map.set(key, {
            key, campaignId: c.id, campaignName: c.name, creatorId: a.creatorId, creatorName: a.creator.displayName,
            periodStart: bounds.start.toISOString(), periodEnd: bounds.end.toISOString(), periodLabel: bounds.label,
            amount: e.amount, currency: c.currency,
            status: isCurrent ? "accruing" : "due",
            postsCount: e.qualifyingPosts, viewsCount: e.qualifyingViews,
          });
        }
      }
    }

    const payById = new Map(
      (await prisma.creator.findMany({ where: { clientId }, select: { id: true, sideshiftUrl: true, paymentMethod: true, paymentHandle: true } }))
        .map((c) => [c.id, c])
    );
    const rows = [...map.values()]
      .sort((a, b) => (a.periodStart < b.periodStart ? 1 : -1))
      .map((r) => {
        const p = payById.get(r.creatorId);
        return { ...r, sideshiftUrl: p?.sideshiftUrl ?? null, paymentMethod: p?.paymentMethod ?? "sideshift", paymentHandle: p?.paymentHandle ?? null };
      });
    const sum = (st: string) => rows.filter((r) => r.status === st).reduce((s, r) => s + r.amount, 0);
    const summary = {
      due: Math.round(sum("due") * 100) / 100,
      accruing: Math.round(sum("accruing") * 100) / 100,
      paid: Math.round(sum("paid") * 100) / 100,
      counts: {
        due: rows.filter((r) => r.status === "due").length,
        accruing: rows.filter((r) => r.status === "accruing").length,
        paid: rows.filter((r) => r.status === "paid").length,
        cancelled: rows.filter((r) => r.status === "cancelled").length,
      },
    };

    return ok({ rows, summary });
  } catch (e) {
    return serverError(e);
  }
}
