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
  // A new creator's ramp-up: for `starterDays` after their onboarding date,
  // every video earns a flat `starterPerPost` and nothing else — it qualifies
  // regardless of views, and earns no per-post, CPM or tier pay on top.
  // Null/0 days = no starter window.
  starterDays?: number | null;
  starterPerPost?: number | null;
  // Treat a video cross-posted to several platforms as one original: it
  // qualifies on its best platform's views and is paid once. Off (the default)
  // = every platform copy qualifies and pays on its own.
  payPerOriginal?: boolean;
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
    starterDays: base.starterDays ?? null,
    starterPerPost: base.starterPerPost ?? null,
    payPerOriginal: base.payPerOriginal ?? false,
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
  // Warm-up posts earn no view-based pay (CPM / view bonuses).
  isWarmUp?: boolean | null;
  // A fixed price for this one video, replacing every rule-computed component.
  payOverride?: number | null;
  // Cross-post group: every platform copy of the same original shares one key.
  // Null = this row is its own original. Only read when payPerOriginal is on.
  groupKey?: string | null;
}

/** Pay components a video is excluded from, with warm-up folded in. */
export function exclusionsOf(p: EarningPost): PayExclusion[] {
  const base = p.exclusions ?? parsePayExclusions(p.payExclusions);
  if (!p.isWarmUp) return base;
  return [...new Set<PayExclusion>([...base, "cpm", "tiers"])];
}

/** Is this video priced by hand rather than by the rules? */
export function hasOverride(p: EarningPost): boolean {
  return p.payOverride != null && Number.isFinite(p.payOverride) && p.payOverride >= 0;
}

export interface PeriodBounds {
  start: Date;
  end: Date;
  label: string;
}

const DAY = 86_400_000;
// How far outside a billing period to reach for copies of a video posted
// inside it. Covers the 7-day window the "same video as…" picker offers.
const GROUP_SLACK = 8 * DAY;

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

/** Extra context the rules need about the creator being paid. */
export interface EarningContext {
  /** When this creator started, for the starter-window rule. */
  onboardedAt?: Date | string | null;
  /**
   * The creator's first post for this client — what the starter window counts
   * from. Use `starterAnchor` to derive it; it needs the creator's whole post
   * history, which computeEarnings (one period at a time) never sees.
   */
  firstPostAt?: Date | string | null;
}

/**
 * Where a creator's starter window starts: the first post they ever made that
 * we track. Deliberately not tied to onboardedAt or when they were added to
 * the app — those are often blank or set after the creator started posting,
 * and the deal is "your first two weeks of posting", which only the posts
 * themselves can tell. No posts yet = no window.
 */
export function starterAnchor(posts: { postedAt: Date | string }[]): Date | null {
  let first = Infinity;
  for (const p of posts) {
    const t = new Date(p.postedAt).getTime();
    if (!isNaN(t) && t < first) first = t;
  }
  return first === Infinity ? null : new Date(first);
}

/**
 * One row per original video. A post that exists on three platforms is three
 * rows in the DB but one thing the creator made, so it should qualify once and
 * be paid once.
 *
 * `views` becomes the best single platform's count — that is what "500 views
 * on at least one platform" means, and it is what the minimum and the bonus
 * tiers are judged on. `cpmViews` stays the sum across every copy, because CPM
 * is buying reach and all of it was delivered.
 *
 * Per-video pay settings are merged the forgiving way: an original is only
 * excluded from a component when every copy is, and a hand-set price on any
 * copy prices the whole original. Off, this is a no-op — each row is its own
 * original, exactly as before.
 */
function collapseCrossPosts(posts: EarningPost[], on: boolean): Original[] {
  const solo = (p: EarningPost): Original => ({ ...p, cpmViews: p.views, copies: 1 });
  if (!on) return posts.map(solo);

  const groups = new Map<string, EarningPost[]>();
  posts.forEach((p, i) => {
    const key = p.groupKey ?? `__solo:${i}`;
    const g = groups.get(key);
    if (g) g.push(p);
    else groups.set(key, [p]);
  });

  return [...groups.values()].map((members) => {
    if (members.length === 1) return solo(members[0]);
    const at = (p: EarningPost) => (p.postedAt instanceof Date ? p.postedAt : new Date(p.postedAt)).getTime();
    const byTime = [...members].sort((a, b) => at(a) - at(b));
    const perCopy = members.map(exclusionsOf);
    return {
      // The original is the first one that went up; the rest are copies.
      postedAt: byTime[0].postedAt,
      views: members.reduce((m, p) => Math.max(m, p.views), 0),
      cpmViews: members.reduce((s, p) => s + p.views, 0),
      copies: members.length,
      exclusions: PAY_COMPONENTS.filter((c) => perCopy.every((e) => e.includes(c))),
      isWarmUp: members.every((p) => !!p.isWarmUp),
      payOverride: byTime.find(hasOverride)?.payOverride ?? null,
      groupKey: members[0].groupKey ?? null,
    };
  });
}

type Original = EarningPost & { cpmViews: number; copies: number };

export function computeEarnings(
  rules: CampaignRules,
  posts: EarningPost[],
  bounds: PeriodBounds,
  now: Date = new Date(),
  ctx: EarningContext = {}
): Earnings {
  const at = (p: EarningPost) => (p.postedAt instanceof Date ? p.postedAt : new Date(p.postedAt)).getTime();
  const eligible = posts
    // A cross-post can lag its original by days, so a video posted on the 31st
    // and mirrored on the 2nd has to be assembled before the period is applied
    // — otherwise it lands in two months and is paid twice. The slack matches
    // the widest span the grouping UI will let a group cover.
    .filter((p) => {
      const t = at(p);
      return t >= bounds.start.getTime() - GROUP_SLACK && t <= bounds.end.getTime() + GROUP_SLACK;
    })
    // Videos excluded from all pay simply don't exist for the payout math —
    // unless someone priced them by hand, in which case that price stands.
    .filter((p) => hasOverride(p) || !exclusionsOf(p).includes("all"))
    // From here on, "views" means countable views under the view window.
    .map((p) => ({ ...p, views: windowedViews(p, rules.viewWindowDays, now) }));
  // Cross-posts fold into one original before anything is counted, so the
  // rules below always see videos made rather than rows stored. An original
  // belongs to the period it first went up in, wherever its copies landed.
  const originals = collapseCrossPosts(eligible, rules.payPerOriginal === true)
    .filter((p) => at(p) >= bounds.start.getTime() && at(p) <= bounds.end.getTime());
  // Starter window: the first N days of a creator posting. Videos posted
  // inside it are paid a flat rate instead of by views.
  const anchorSrc = ctx.firstPostAt ?? ctx.onboardedAt;
  const anchor = anchorSrc ? new Date(anchorSrc) : null;
  const starterDays = rules.starterDays ?? 0;
  const starterRate = rules.starterPerPost ?? 0;
  const starterEnd =
    anchor && !isNaN(anchor.getTime()) && starterDays > 0 ? anchor.getTime() + starterDays * DAY : null;
  const isStarter = (p: EarningPost) => {
    if (starterEnd == null || hasOverride(p)) return false;
    const t = (p.postedAt instanceof Date ? p.postedAt : new Date(p.postedAt)).getTime();
    return t >= (anchor as Date).getTime() && t <= starterEnd;
  };

  // Hand-priced videos always qualify (someone decided what they're worth) and
  // so do starter-window videos; the rest have to clear the minimum views.
  const qualifying = originals.filter((p) => hasOverride(p) || isStarter(p) || p.views >= (rules.minViews || 0));
  // Per-component opt-outs: a video can count for some pay rules but not
  // others. Hand-priced and starter videos sit outside every rule-computed
  // component — they are already priced.
  const counted = (list: typeof qualifying, c: PayComponent) =>
    list.filter((p) => !hasOverride(p) && !isStarter(p) && !exclusionsOf(p).includes(c));
  const custom = qualifying.filter(hasOverride);
  const starters = qualifying.filter(isStarter);
  const qCount = qualifying.length;
  const qViews = qualifying.reduce((s, p) => s + p.cpmViews, 0);
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
  if (starters.length && starterRate) {
    breakdown.push({ label: `Starter pay × ${starters.length}`, amount: starterRate * starters.length });
  }
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
        const v = (rules.cpmRate * p.cpmViews) / 1000;
        return s + (cap != null && cap > 0 ? Math.min(v, cap) : v);
      }, 0);
      if (cpmPosts.length) breakdown.push({ label: `CPM per video × ${cpmPosts.length}`, amount: amt });
    } else {
      const cpmViews = cpmPosts.reduce((s, p) => s + p.cpmViews, 0);
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
  if (custom.length) {
    breakdown.push({ label: `Custom-priced × ${custom.length}`, amount: custom.reduce((s, p) => s + (p.payOverride as number), 0) });
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
  starterDays?: number | null;
  starterPerPost?: number | null;
  payPerOriginal?: boolean;
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
  const starterDays = num(r.starterDays); const starterPerPost = num(r.starterPerPost);
  // Both halves are needed for the window to mean anything.
  if (starterDays && starterPerPost) { out.starterDays = Math.round(starterDays); out.starterPerPost = starterPerPost; }
  if (r.payPerOriginal === true) out.payPerOriginal = true;
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

/** What a single video earns, in a word — for pay menus, lists and invoices. */
export function paySummary(
  v: { exclusions: PayExclusion[]; isWarmUp: boolean; payOverride: number | null },
  currency = "USD"
): { label: string; tone: string } {
  if (v.payOverride != null) return { label: `${money(v.payOverride, currency)} fixed`, tone: "text-[var(--signal)]" };
  if (v.exclusions.includes("all")) return { label: "Excluded", tone: "text-[var(--bad)]" };
  if (v.isWarmUp) return { label: "Warm-up", tone: "text-[var(--warn)]" };
  if (v.exclusions.length === 0) return { label: "Counts", tone: "text-[var(--muted)]" };
  const short: Record<PayComponent, string> = { perPost: "post fee", cpm: "CPM", tiers: "bonuses" };
  return { label: `No ${v.exclusions.map((e) => short[e as PayComponent]).join(", ")}`, tone: "text-[var(--warn)]" };
}

export function money(amount: number, currency = "USD"): string {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}
