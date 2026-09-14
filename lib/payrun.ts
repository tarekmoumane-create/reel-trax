import { prisma } from "./db";
import {
  periodsSince, computeEarnings, effectiveRules, parseViewTiers, starterAnchor,
  type CampaignRules, type EarningPost,
} from "./payouts";

// Pay runs: what a creator earned for videos posted in any date range, how
// much of that is already recorded as paid, and what is still owed. The
// Payouts page, "Mark paid" and the invoice all go through here, so the number
// you see is the number that gets recorded.

export const DAY = 86_400_000;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const dayStr = (d: Date) => d.toISOString().slice(0, 10);
export const dayStart = (s: string) => new Date(`${s}T00:00:00.000Z`);
export const dayEnd = (s: string) => new Date(`${s}T23:59:59.999Z`);
export const cents = (n: number) => Math.round(n * 100) / 100;

export interface CampaignRow {
  id: string; name: string; status: string; currency: string;
  period: string; targetVideos: number | null; baseFee: number; perPost: number;
  cpmRate: number; cpmBasis: string; cpmCapPerVideo: number | null; viewTiers: string | null;
  bonus: number; minViews: number; viewWindowDays: number | null; payoutCap: number | null;
  starterDays: number | null; starterPerPost: number | null; payPerOriginal: boolean;
  startDate: Date | null; endDate: Date | null; createdAt: Date;
}

export interface AssignmentRow {
  baseFee: number | null; perPost: number | null; cpmRate: number | null; cpmBasis: string | null;
  cpmCapPerVideo: number | null; viewTiers: string | null; bonus: number | null; minViews: number | null;
  viewWindowDays: number | null; payoutCap: number | null; flatDeal: number | null;
  creator: { onboardedAt: Date | null; posts: (EarningPost & { postedAt: Date })[] };
}

export interface PayoutRecordRow {
  id: string; creatorId: string; periodStart: Date; periodEnd: Date;
  amount: number; status: string; paidAt: Date | null;
}

export function rulesOf(c: CampaignRow): CampaignRules {
  return {
    period: c.period, targetVideos: c.targetVideos, baseFee: c.baseFee, perPost: c.perPost,
    cpmRate: c.cpmRate, cpmBasis: c.cpmBasis, cpmCapPerVideo: c.cpmCapPerVideo, viewTiers: parseViewTiers(c.viewTiers),
    bonus: c.bonus, minViews: c.minViews, viewWindowDays: c.viewWindowDays, payoutCap: c.payoutCap,
    starterDays: c.starterDays, starterPerPost: c.starterPerPost, payPerOriginal: c.payPerOriginal,
  };
}

export interface RangeEarnings {
  amount: number;
  posts: number;
  views: number;
  breakdown: { label: string; amount: number }[];
}

// Owed once per billing period, however the period is sliced into pay runs.
const FIXED_LABELS = new Set(["Base fee", "Target bonus", "Flat deal"]);

/**
 * What one creator earned on one campaign for videos posted in [start, end].
 *
 * Rules are defined per billing period, so the range is walked period by
 * period, each clipped to the range. Per-video pay counts videos posted inside
 * the range. A period's fixed amounts (retainer, flat deal, target bonus) are
 * owed once, so they belong to exactly one range — the one holding the day the
 * period began for this campaign. Split a month across two pay runs and the
 * retainer lands in the first, never both.
 */
export function earningsForRange(c: CampaignRow, a: AssignmentRow, start: Date, end: Date, now: Date): RangeEarnings {
  const rules = effectiveRules(rulesOf(c), { ...a, viewTiers: parseViewTiers(a.viewTiers) });
  const campaignStart = c.startDate ?? c.createdAt;
  const ctx = { onboardedAt: a.creator.onboardedAt, firstPostAt: starterAnchor(a.creator.posts) };
  const out: RangeEarnings = { amount: 0, posts: 0, views: 0, breakdown: [] };
  const add = (label: string, amount: number) => {
    if (!amount) return;
    const hit = out.breakdown.find((b) => b.label === label);
    if (hit) hit.amount += amount;
    else out.breakdown.push({ label, amount });
  };

  const periods = periodsSince(c.period, campaignStart, end, 600).filter(
    (p) =>
      p.end.getTime() >= start.getTime() &&
      p.start.getTime() <= end.getTime() &&
      !(c.endDate && p.start.getTime() > c.endDate.getTime())
  );

  for (const p of periods) {
    const clip = {
      start: new Date(Math.max(p.start.getTime(), start.getTime())),
      end: new Date(Math.min(p.end.getTime(), end.getTime())),
      label: p.label,
    };
    const e = computeEarnings(rules, a.creator.posts, clip, now, ctx);
    const feeDay = Math.max(p.start.getTime(), campaignStart.getTime());
    const ownsFixed = feeDay >= start.getTime() && feeDay <= end.getTime();

    let amount = 0;
    for (const b of e.breakdown) {
      const label = b.label.replace(/ × \d+$/, "").replace(/ \(.*\)$/, "");
      // Not this range's to charge — or, for the target bonus, re-judged on
      // the whole period below rather than on this slice of it.
      if (FIXED_LABELS.has(label) && (!ownsFixed || label === "Target bonus")) continue;
      add(label, b.amount);
      amount += b.amount;
    }
    if (ownsFixed && rules.bonus && rules.flatDeal == null) {
      const whole = computeEarnings(rules, a.creator.posts, p, now, ctx);
      if (whole.targetMet) {
        add("Target bonus", rules.bonus);
        amount += rules.bonus;
      }
    }
    if (rules.payoutCap != null && amount > rules.payoutCap) {
      add("Cap applied", rules.payoutCap - amount);
      amount = rules.payoutCap;
    }
    out.amount += amount;
    out.posts += e.qualifyingPosts;
    out.views += e.qualifyingViews;
  }

  out.amount = cents(out.amount);
  out.breakdown = out.breakdown.map((b) => ({ ...b, amount: cents(b.amount) })).filter((b) => b.amount !== 0);
  return out;
}

export interface Span {
  start: Date;
  end: Date;
}

/** The parts of [start, end] that no record covers. */
export function uncovered(start: Date, end: Date, records: { periodStart: Date; periodEnd: Date }[]): Span[] {
  const out: Span[] = [];
  const stop = end.getTime();
  let cursor = start.getTime();
  const sorted = [...records].sort((x, y) => x.periodStart.getTime() - y.periodStart.getTime());
  for (const r of sorted) {
    const rs = r.periodStart.getTime();
    const re = r.periodEnd.getTime();
    if (re < cursor) continue;
    if (rs > stop) break;
    if (rs > cursor) out.push({ start: new Date(cursor), end: new Date(Math.min(rs - 1, stop)) });
    cursor = Math.max(cursor, re + 1);
    if (cursor > stop) break;
  }
  if (cursor <= stop) out.push({ start: new Date(cursor), end: new Date(stop) });
  return out;
}

export interface Settlement {
  /** Everything earned for videos posted in the range, paid or not. */
  earned: RangeEarnings;
  /** Earned in the parts of the range no payment record covers yet. */
  unpaid: number;
  /**
   * Earned since a payment was recorded — a video crossing the minimum views
   * after its period was paid. Belongs to the range the record ends in.
   */
  late: number;
  /** unpaid + late: what to pay now. */
  owed: number;
  /** Recorded as paid, on records overlapping the range. */
  paid: number;
  /** Records overlapping the range, with what each is worth today. */
  records: (PayoutRecordRow & { live: number })[];
  gaps: Span[];
}

export function settle(c: CampaignRow, a: AssignmentRow, records: PayoutRecordRow[], start: Date, end: Date, now: Date): Settlement {
  const earned = earningsForRange(c, a, start, end, now);
  const overlapping = records.filter((r) => r.periodEnd.getTime() >= start.getTime() && r.periodStart.getTime() <= end.getTime());
  const gaps = uncovered(start, end, overlapping);
  const wholeRange = gaps.length === 1 && gaps[0].start.getTime() === start.getTime() && gaps[0].end.getTime() === end.getTime();
  const unpaid = wholeRange ? earned.amount : gaps.reduce((s, g) => s + earningsForRange(c, a, g.start, g.end, now).amount, 0);

  const withLive = overlapping.map((r) => ({
    ...r,
    live: r.status === "paid" ? earningsForRange(c, a, r.periodStart, r.periodEnd, now).amount : 0,
  }));
  const late = withLive.reduce((s, r) => {
    if (r.status !== "paid" || r.periodEnd.getTime() > end.getTime()) return s;
    return s + Math.max(0, cents(r.live - r.amount));
  }, 0);
  const paid = withLive.filter((r) => r.status === "paid").reduce((s, r) => s + r.amount, 0);

  return { earned, unpaid: cents(unpaid), late: cents(late), owed: cents(unpaid + late), paid: cents(paid), records: withLive, gaps };
}

/** Every campaign of a client with what the pay math needs — optionally for one creator. */
export function loadCampaigns(clientId: string, creatorId?: string) {
  return prisma.campaign.findMany({
    where: { clientId },
    include: {
      assignments: {
        where: creatorId ? { creatorId } : undefined,
        include: {
          creator: {
            select: {
              id: true, displayName: true, onboardedAt: true,
              tiktokHandle: true, instagramHandle: true, youtubeHandle: true, threadsHandle: true, facebookHandle: true,
              sideshiftUrl: true, paymentMethod: true, paymentHandle: true,
              posts: {
                select: {
                  platform: true, url: true, caption: true, postedAt: true, views: true,
                  payExclusions: true, isWarmUp: true, payOverride: true, groupKey: true,
                  snapshots: { select: { day: true, views: true } },
                },
              },
            },
          },
        },
      },
      payouts: {
        where: creatorId ? { creatorId } : undefined,
        select: { id: true, creatorId: true, periodStart: true, periodEnd: true, amount: true, status: true, paidAt: true },
      },
    },
  });
}

/**
 * The start of this client's history: whichever came first, their earliest
 * tracked post or their earliest campaign. Falls back to the start of the
 * current month when there is nothing to bill yet.
 */
export async function historyStart(clientId: string): Promise<string> {
  const [post, campaign] = await Promise.all([
    prisma.post.findFirst({ where: { creator: { clientId } }, orderBy: { postedAt: "asc" }, select: { postedAt: true } }),
    prisma.campaign.findFirst({ where: { clientId }, orderBy: { createdAt: "asc" }, select: { startDate: true, createdAt: true } }),
  ]);
  const candidates = [post?.postedAt, campaign?.startDate ?? campaign?.createdAt].filter(Boolean) as Date[];
  if (!candidates.length) {
    const n = new Date();
    return dayStr(new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1)));
  }
  return dayStr(new Date(Math.min(...candidates.map((d) => d.getTime()))));
}

/** The end of the latest recorded payment (paid or skipped) for a client. */
export async function lastSettledThrough(clientId: string): Promise<Date | null> {
  const r = await prisma.payout.findFirst({
    where: { campaign: { clientId } },
    orderBy: { periodEnd: "desc" },
    select: { periodEnd: true },
  });
  return r?.periodEnd ?? null;
}
