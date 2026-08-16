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
  viewWindowDays?: number | null; // views count only up to N days after posting (null = all-time)
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
  viewWindowDays?: number | null;
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
    viewWindowDays: o.viewWindowDays == null ? base.viewWindowDays ?? null : o.viewWindowDays,
    // null/undefined = inherit — matches the "leave blank to inherit" UI.
    payoutCap: o.payoutCap == null ? base.payoutCap : o.payoutCap,
    flatDeal: o.flatDeal == null ? base.flatDeal : o.flatDeal,
  };
}

// Pay components a single video can be excluded from. "all" = the video earns
// nothing at all (and doesn't count toward the video target either).
export const PAY_COMPONENTS = ["perPost", "cpm", "tiers"] as const;
export type PayComponent = (typeof PAY_COMPONENTS)[number];
export type PayExclusion = PayComponent | "all";

/** Parse a Post.payExclusions JSON column into a sane exclusion list. */
export function parsePayExclusions(s: string | null | undefined): PayExclusion[] {
  if (!s) return [];
  try {
    const raw = JSON.parse(s);
    if (!Array.isArray(raw)) return [];
    const valid = new Set<string>(["all", ...PAY_COMPONENTS]);
    return [...new Set(raw.filter((x): x is PayExclusion => typeof x === "string" && valid.has(x)))];
  } catch {
    return [];
  }
}

export interface EarningPost {
  postedAt: Date | string;
  views: number;
  // Daily view history (from PostStatSnapshot) — needed to judge viewWindowDays.
  snapshots?: { day: string; views: number }[];
  // Pay components this video is excluded from — either parsed, or the raw
  // Post.payExclusions JSON column straight from the DB.
  exclusions?: PayExclusion[];
  payExclusions?: string | null;
}

function exclusionsOf(p: EarningPost): PayExclusion[] {
  return p.exclusions ?? parsePayExclusions(p.payExclusions);
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

/**
 * A post's countable views under a view window: its views as of `windowDays`
 * after posting, taken from the daily snapshot on/just before that deadline.
 * While the window is still open the current total counts (still racing).
 * Posts with no history (predating snapshots) fall back to current views.
 */
function windowedViews(p: EarningPost, windowDays: number | null | undefined, now: Date): number {
  if (!windowDays || windowDays <= 0) return p.views;
  const posted = (p.postedAt instanceof Date ? p.postedAt : new Date(p.postedAt)).getTime();
  const deadline = posted + windowDays * DAY;
  if (now.getTime() < deadline) return p.views;
  const snaps = p.snapshots ?? [];
  if (!snaps.length) return p.views;
  const deadlineDay = new Date(deadline).toISOString().slice(0, 10);
  const onOrBefore = snaps.filter((s) => s.day <= deadlineDay).sort((a, b) => (a.day < b.day ? 1 : -1))[0];
  if (onOrBefore) return onOrBefore.views;
  // Only post-deadline history exists — the earliest row is closest to the cutoff.
  return [...snaps].sort((a, b) => (a.day > b.day ? 1 : -1))[0].views;
}

export function computeEarnings(
  rules: CampaignRules,
  posts: EarningPost[],
  bounds: PeriodBounds,
  now: Date = new Date()
): Earnings {
  const inPeriod = posts
    .filter((p) => {
      const t = (p.postedAt instanceof Date ? p.postedAt : new Date(p.postedAt)).getTime();
      return t >= bounds.start.getTime() && t <= bounds.end.getTime();
    })
    // Videos excluded from all pay simply don't exist for the payout math.
    .filter((p) => !exclusionsOf(p).includes("all"))
    // From here on, "views" means countable views under the view window.
    .map((p) => ({ ...p, views: windowedViews(p, rules.viewWindowDays, now) }));
  const qualifying = inPeriod.filter((p) => p.views >= (rules.minViews || 0));
  // Per-component opt-outs: a video can count for some pay rules but not others.
  const counted = (list: typeof qualifying, c: PayComponent) =>
    list.filter((p) => !exclusionsOf(p).includes(c));
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
  if (rules.perPost) {
    const pp = counted(qualifying, "perPost");
    if (pp.length) breakdown.push({ label: `Per post × ${pp.length}`, amount: rules.perPost * pp.length });
  }
  if (rules.cpmRate) {
    const cpmPosts = counted(qualifying, "cpm");
    if (rules.cpmBasis === "perVideo") {
      // Each video earns on its own views; the per-video cap is what makes
      // this differ from aggregate CPM.
      const cap = rules.cpmCapPerVideo;
      const amt = cpmPosts.reduce((s, p) => {
        const v = (rules.cpmRate * p.views) / 1000;
        return s + (cap != null && cap > 0 ? Math.min(v, cap) : v);
      }, 0);
      if (cpmPosts.length) breakdown.push({ label: `CPM per video × ${cpmPosts.length}`, amount: amt });
    } else {
      const cpmViews = cpmPosts.reduce((s, p) => s + p.views, 0);
      if (cpmPosts.length) breakdown.push({ label: `CPM (${(cpmViews / 1000).toFixed(1)}k)`, amount: (rules.cpmRate * cpmViews) / 1000 });
    }
  }
  const tiers = rules.viewTiers ?? [];
  if (tiers.length) {
    // Each video pays the highest tier it reached (tiers are sorted ascending).
    let tierAmt = 0;
    let tierHits = 0;
    for (const p of counted(qualifying, "tiers")) {
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
  viewWindowDays?: number | null;
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
  const viewWindowDays = num(r.viewWindowDays); if (viewWindowDays) out.viewWindowDays = Math.round(viewWindowDays);
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
