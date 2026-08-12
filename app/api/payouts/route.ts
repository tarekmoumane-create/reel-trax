import { prisma } from "@/lib/db";
import { ok, bad, serverError } from "@/lib/api";
import { periodBounds, computeEarnings, effectiveRules, type CampaignRules } from "@/lib/payouts";

function rulesOf(c: {
  period: string; targetVideos: number | null; baseFee: number; perPost: number;
  cpmRate: number; bonus: number; minViews: number; payoutCap: number | null;
}): CampaignRules {
  return { period: c.period, targetVideos: c.targetVideos, baseFee: c.baseFee, perPost: c.perPost, cpmRate: c.cpmRate, bonus: c.bonus, minViews: c.minViews, payoutCap: c.payoutCap };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get("clientId");
    if (!clientId) return bad("clientId is required");

    const campaigns = await prisma.campaign.findMany({
      where: { clientId },
      include: {
        assignments: { include: { creator: { include: { posts: { select: { postedAt: true, views: true } } } } } },
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

    // computed current period for active campaigns
    for (const c of campaigns) {
      if (c.status !== "active") continue;
      const bounds = periodBounds(c.period, now);
      const baseRules = rulesOf(c);
      for (const a of c.assignments) {
        const key = `${c.id}|${a.creatorId}|${bounds.start.toISOString()}`;
        if (map.has(key)) continue; // stored wins
        const e = computeEarnings(effectiveRules(baseRules, a), a.creator.posts, bounds);
        map.set(key, {
          key, campaignId: c.id, campaignName: c.name, creatorId: a.creatorId, creatorName: a.creator.displayName,
          periodStart: bounds.start.toISOString(), periodEnd: bounds.end.toISOString(), periodLabel: bounds.label,
          amount: e.amount, currency: c.currency,
          status: bounds.end.getTime() < now.getTime() ? "due" : "upcoming",
          postsCount: e.qualifyingPosts, viewsCount: e.qualifyingViews,
        });
      }
    }

    const rows = [...map.values()].sort((a, b) => (a.periodStart < b.periodStart ? 1 : -1));
    const sum = (st: string) => rows.filter((r) => r.status === st).reduce((s, r) => s + r.amount, 0);
    const summary = {
      due: Math.round(sum("due") * 100) / 100,
      upcoming: Math.round(sum("upcoming") * 100) / 100,
      paid: Math.round(sum("paid") * 100) / 100,
      counts: {
        due: rows.filter((r) => r.status === "due").length,
        upcoming: rows.filter((r) => r.status === "upcoming").length,
        paid: rows.filter((r) => r.status === "paid").length,
        cancelled: rows.filter((r) => r.status === "cancelled").length,
      },
    };

    return ok({ rows, summary });
  } catch (e) {
    return serverError(e);
  }
}
