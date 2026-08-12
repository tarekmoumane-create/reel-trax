// Pure payout math: billing periods + earnings from campaign rules.
// No DB — takes campaign rules + posts, returns amounts. `now` injectable.

export interface CampaignRules {
  period: string; // weekly | monthly
  targetVideos: number | null;
  baseFee: number;
  perPost: number;
  cpmRate: number;
  bonus: number;
  minViews: number;
  payoutCap: number | null;
}

export interface EarningPost {
  postedAt: Date | string;
  views: number;
}

export interface PeriodBounds {
  start: Date;
  end: Date;
  label: string;
}

const DAY = 86_400_000;

export function periodBounds(period: string, now: Date = new Date()): PeriodBounds {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();

  if (period === "weekly") {
    // Monday-based week in UTC
    const dow = (now.getUTCDay() + 6) % 7; // 0 = Monday
    const startMs = Date.UTC(y, m, d) - dow * DAY;
    const start = new Date(startMs);
    const end = new Date(startMs + 7 * DAY - 1);
    const fmt = (dt: Date) =>
      dt.toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" });
    return { start, end, label: `${fmt(start)} – ${fmt(end)}` };
  }

  // monthly (default)
  const start = new Date(Date.UTC(y, m, 1));
  const end = new Date(Date.UTC(y, m + 1, 1) - 1);
  return {
    start,
    end,
    label: start.toLocaleDateString("en", { month: "long", year: "numeric", timeZone: "UTC" }),
  };
}

export interface Earnings {
  amount: number;
  qualifyingPosts: number;
  qualifyingViews: number;
  targetMet: boolean;
  breakdown: { label: string; amount: number }[];
  capped: boolean;
}

export function computeEarnings(
  rules: CampaignRules,
  posts: EarningPost[],
  bounds: PeriodBounds
): Earnings {
  const inPeriod = posts.filter((p) => {
    const t = (p.postedAt instanceof Date ? p.postedAt : new Date(p.postedAt)).getTime();
    return t >= bounds.start.getTime() && t <= bounds.end.getTime();
  });
  const qualifying = inPeriod.filter((p) => p.views >= (rules.minViews || 0));
  const qCount = qualifying.length;
  const qViews = qualifying.reduce((s, p) => s + p.views, 0);
  const targetMet = rules.targetVideos != null && qCount >= rules.targetVideos;

  const breakdown: { label: string; amount: number }[] = [];
  if (rules.baseFee) breakdown.push({ label: "Base fee", amount: rules.baseFee });
  if (rules.perPost) breakdown.push({ label: `Per post × ${qCount}`, amount: rules.perPost * qCount });
  if (rules.cpmRate) breakdown.push({ label: `CPM (${(qViews / 1000).toFixed(1)}k)`, amount: (rules.cpmRate * qViews) / 1000 });
  if (rules.bonus && targetMet) breakdown.push({ label: "Target bonus", amount: rules.bonus });

  let amount = breakdown.reduce((s, b) => s + b.amount, 0);
  let capped = false;
  if (rules.payoutCap != null && amount > rules.payoutCap) {
    amount = rules.payoutCap;
    capped = true;
  }
  amount = Math.round(amount * 100) / 100;

  return { amount, qualifyingPosts: qCount, qualifyingViews: qViews, targetMet, breakdown, capped };
}

export function money(amount: number, currency = "USD"): string {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}
