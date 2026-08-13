// Pure payout math: billing periods + earnings from campaign rules.
// No DB — takes campaign rules + posts, returns amounts. `now` injectable.

// A per-video view milestone: hit `views` on a video → earn `bonus`.
// A video pays only the highest tier it reached.
export interface ViewTier {
  views: number;
  bonus: number;
}

/** Parse a viewTiers JSON column ("[{views,bonus}]") into a sorted, sane list. */
export function parseViewTiers(s: string | null | undefined): ViewTier[] {
  if (!s) return [];
  try {
    const raw = JSON.parse(s);
    if (!Array.isArray(raw)) return [];
    return raw
      .map((t) => ({ views: Number(t?.views), bonus: Number(t?.bonus) }))
      .filter((t) => Number.isFinite(t.views) && t.views > 0 && Number.isFinite(t.bonus) && t.bonus > 0)
      .sort((a, b) => a.views - b.views);
  } catch {
    return [];
  }
}

export interface CampaignRules {
  period: string; // weekly | monthly
  targetVideos: number | null;
  baseFee: number;
  perPost: number;
  cpmRate: number;
  cpmBasis?: string; // aggregate (default) | perVideo
  cpmCapPerVideo?: number | null; // max CPM earnings per video (perVideo basis)
  viewTiers?: ViewTier[]; // per-video milestone bonuses (alternative to CPM)
  bonus: number;
  minViews: number;
  payoutCap: number | null;
  flatDeal?: number | null; // fixed total for the period, ignores all other rules
}

// Per-creator overrides (null = inherit the campaign value).
export interface RuleOverride {
  baseFee?: number | null;
  perPost?: number | null;
  cpmRate?: number | null;
  cpmBasis?: string | null;
  cpmCapPerVideo?: number | null;
  viewTiers?: ViewTier[] | null;
  bonus?: number | null;
  minViews?: number | null;
  payoutCap?: number | null;
  flatDeal?: number | null;
}

/** Merge a campaign's rules with one creator's overrides. */
export function effectiveRules(base: CampaignRules, o?: RuleOverride | null): CampaignRules {
  if (!o) return base;
  const pick = <T>(ov: T | null | undefined, b: T): T => (ov == null ? b : ov);
  return {
    period: base.period,
    targetVideos: base.targetVideos,
    baseFee: pick(o.baseFee, base.baseFee),
    perPost: pick(o.perPost, base.perPost),
    cpmRate: pick(o.cpmRate, base.cpmRate),
    cpmBasis: pick(o.cpmBasis, base.cpmBasis ?? "aggregate"),
    cpmCapPerVideo: o.cpmCapPerVideo == null ? base.cpmCapPerVideo ?? null : o.cpmCapPerVideo,
    viewTiers: o.viewTiers && o.viewTiers.length ? o.viewTiers : base.viewTiers ?? [],
    bonus: pick(o.bonus, base.bonus),
    minViews: pick(o.minViews, base.minViews),
    // null/undefined = inherit — matches the "leave blank to inherit" UI.
    payoutCap: o.payoutCap == null ? base.payoutCap : o.payoutCap,
    flatDeal: o.flatDeal == null ? base.flatDeal : o.flatDeal,
  };
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

/**
 * Every billing period from `from` through the one containing `now`, ascending.
 * Lets payouts be tracked for the whole campaign lifetime — mid-period accrual
 * and past unpaid periods — instead of only the current cycle. Capped so a
 * years-old campaign can't explode the list; the current period is always last.
 */
export function periodsSince(period: string, from: Date | string, now: Date = new Date(), cap = 24): PeriodBounds[] {
  const fromDate = from instanceof Date ? from : new Date(from);
  const out: PeriodBounds[] = [];
  let b = periodBounds(period, isNaN(fromDate.getTime()) ? now : fromDate);
  for (let i = 0; i < cap && b.start.getTime() <= now.getTime(); i++) {
    out.push(b);
    if (now.getTime() <= b.end.getTime()) break;
    b = periodBounds(period, new Date(b.end.getTime() + 1));
  }
  const last = out[out.length - 1];
  if (!last || now.getTime() > last.end.getTime()) out.push(periodBounds(period, now));
  return out;
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

  // Flat deal short-circuits all other rules.
  if (rules.flatDeal != null) {
    return {
      amount: Math.round(rules.flatDeal * 100) / 100,
      qualifyingPosts: qCount,
      qualifyingViews: qViews,
      targetMet,
      breakdown: [{ label: "Flat deal", amount: rules.flatDeal }],
      capped: false,
    };
  }

  const breakdown: { label: string; amount: number }[] = [];
  if (rules.baseFee) breakdown.push({ label: "Base fee", amount: rules.baseFee });
  if (rules.perPost) breakdown.push({ label: `Per post × ${qCount}`, amount: rules.perPost * qCount });
  if (rules.cpmRate) {
    if (rules.cpmBasis === "perVideo") {
      // Each video earns on its own views; the per-video cap is what makes
      // this differ from aggregate CPM.
      const cap = rules.cpmCapPerVideo;
      const amt = qualifying.reduce((s, p) => {
        const v = (rules.cpmRate * p.views) / 1000;
        return s + (cap != null && cap > 0 ? Math.min(v, cap) : v);
      }, 0);
      breakdown.push({ label: `CPM per video × ${qCount}`, amount: amt });
    } else {
      breakdown.push({ label: `CPM (${(qViews / 1000).toFixed(1)}k)`, amount: (rules.cpmRate * qViews) / 1000 });
    }
  }
  const tiers = rules.viewTiers ?? [];
  if (tiers.length) {
    // Each video pays the highest tier it reached (tiers are sorted ascending).
    let tierAmt = 0;
    let tierHits = 0;
    for (const p of qualifying) {
      const hit = [...tiers].reverse().find((t) => p.views >= t.views);
      if (hit) {
        tierAmt += hit.bonus;
        tierHits++;
      }
    }
    if (tierHits) breakdown.push({ label: `View bonuses × ${tierHits}`, amount: tierAmt });
  }
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

// A portable pay structure, stored as JSON on Client.defaultPayRules (the
// client's default deal) and Creator.payRules (a creator's personal deal).
// Same knobs as a campaign's payout rules so it maps 1:1 onto either a new
// campaign or a per-creator campaign override.
export interface PayRulesJson {
  period?: string; // monthly | weekly
  baseFee?: number;
  perPost?: number;
  cpmRate?: number;
  cpmBasis?: string; // aggregate | perVideo
  cpmCapPerVideo?: number | null;
  viewTiers?: ViewTier[];
  bonus?: number;
  minViews?: number;
  payoutCap?: number | null;
  flatDeal?: number | null;
  targetVideos?: number | null;
  currency?: string;
  note?: string;
}

/** Whitelist + coerce an untrusted pay-rules payload (API input) into PayRulesJson, or null if empty. */
export function sanitizePayRules(raw: unknown): PayRulesJson | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown) => (v === "" || v == null || !Number.isFinite(Number(v)) ? undefined : Number(v));
  const out: PayRulesJson = {};
  if (r.period === "weekly" || r.period === "monthly") out.period = r.period;
  const baseFee = num(r.baseFee); if (baseFee) out.baseFee = baseFee;
  const perPost = num(r.perPost); if (perPost) out.perPost = perPost;
  const cpmRate = num(r.cpmRate); if (cpmRate) out.cpmRate = cpmRate;
  if (r.cpmBasis === "perVideo") out.cpmBasis = "perVideo";
  const cpmCap = num(r.cpmCapPerVideo); if (cpmCap) out.cpmCapPerVideo = cpmCap;
  const tiers = Array.isArray(r.viewTiers) ? parseViewTiers(JSON.stringify(r.viewTiers)) : [];
  if (tiers.length) out.viewTiers = tiers;
  const bonus = num(r.bonus); if (bonus) out.bonus = bonus;
  const minViews = num(r.minViews); if (minViews) out.minViews = minViews;
  const payoutCap = num(r.payoutCap); if (payoutCap) out.payoutCap = payoutCap;
  const flatDeal = num(r.flatDeal); if (flatDeal) out.flatDeal = flatDeal;
  const targetVideos = num(r.targetVideos); if (targetVideos) out.targetVideos = targetVideos;
  if (typeof r.currency === "string" && r.currency.trim()) out.currency = r.currency.trim();
  if (typeof r.note === "string" && r.note.trim()) out.note = r.note.trim();
  return Object.keys(out).length ? out : null;
}

export function parsePayRules(s: string | null | undefined): PayRulesJson | null {
  if (!s) return null;
  try {
    const raw = JSON.parse(s);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    return raw as PayRulesJson;
  } catch {
    return null;
  }
}

export function money(amount: number, currency = "USD"): string {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}
