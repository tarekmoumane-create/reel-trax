// Pure cadence engine. No DB, no I/O — takes posts in, returns cadence stats.
// Kept dependency-free and `now`/timezone injectable so it's unit-testable.

export type CadenceStatus = "on_track" | "behind" | "quiet" | "no_data";

export interface CadenceInput {
  postedAt: Date | string;
}

export interface CadenceResult {
  lastPostAt: Date | null;
  daysSinceLastPost: number | null;
  postsLast7d: number;
  postsLast30d: number;
  currentStreakDays: number;
  expectedPerWeek: number;
  /** postsLast7d / expectedPerWeek, clamped display-friendly ratio */
  pace7d: number;
  status: CadenceStatus;
  /** oldest → newest, one entry per day for the trailing window */
  calendar: { date: string; count: number }[];
}

const DAY_MS = 86_400_000;

/** Local calendar-day key "YYYY-MM-DD" for a date in a given IANA timezone. */
export function dayKey(date: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** Days since the Unix epoch for a "YYYY-MM-DD" key (timezone-agnostic ordinal). */
function keyToOrdinal(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / DAY_MS);
}

function ordinalToKey(ord: number): string {
  const dt = new Date(ord * DAY_MS);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export interface CadenceOptions {
  expectedPerWeek: number;
  now?: Date;
  timeZone?: string;
  /** trailing days to include in the calendar heatmap (default 84 = 12 weeks) */
  calendarDays?: number;
}

export function computeCadence(
  posts: CadenceInput[],
  opts: CadenceOptions
): CadenceResult {
  const now = opts.now ?? new Date();
  const timeZone = opts.timeZone ?? "America/New_York";
  const expectedPerWeek = Math.max(1, opts.expectedPerWeek || 1);
  const calendarDays = opts.calendarDays ?? 84;

  const dates = posts
    .map((p) => (p.postedAt instanceof Date ? p.postedAt : new Date(p.postedAt)))
    .filter((d) => !isNaN(d.getTime()))
    .sort((a, b) => a.getTime() - b.getTime());

  const todayOrd = keyToOrdinal(dayKey(now, timeZone));

  // Bucket posts by calendar-day ordinal.
  const counts = new Map<number, number>();
  for (const d of dates) {
    const ord = keyToOrdinal(dayKey(d, timeZone));
    counts.set(ord, (counts.get(ord) ?? 0) + 1);
  }

  const lastPostAt = dates.length ? dates[dates.length - 1] : null;
  const lastOrd = lastPostAt ? keyToOrdinal(dayKey(lastPostAt, timeZone)) : null;
  const daysSinceLastPost = lastOrd === null ? null : todayOrd - lastOrd;

  const nowMs = now.getTime();
  const postsLast7d = dates.filter((d) => nowMs - d.getTime() < 7 * DAY_MS).length;
  const postsLast30d = dates.filter((d) => nowMs - d.getTime() < 30 * DAY_MS).length;

  // Current streak: consecutive days with ≥1 post, allowing "today" to be
  // still-open (so a streak that's intact through yesterday still counts today).
  let currentStreakDays = 0;
  let cursor = counts.has(todayOrd) ? todayOrd : todayOrd - 1;
  // only start a streak if the anchor day actually has a post
  if (counts.has(cursor)) {
    while (counts.has(cursor)) {
      currentStreakDays++;
      cursor--;
    }
  }

  // Calendar window (oldest → newest).
  const calendar: { date: string; count: number }[] = [];
  for (let i = calendarDays - 1; i >= 0; i--) {
    const ord = todayOrd - i;
    calendar.push({ date: ordinalToKey(ord), count: counts.get(ord) ?? 0 });
  }

  const pace7d = postsLast7d / expectedPerWeek;

  // Status. Priority: no_data → quiet → behind → on_track.
  const expectedGapDays = 7 / expectedPerWeek;
  const quietThreshold = Math.max(3, expectedGapDays * 2.5);
  let status: CadenceStatus;
  if (dates.length === 0 || daysSinceLastPost === null) {
    status = "no_data";
  } else if (daysSinceLastPost > quietThreshold) {
    status = "quiet";
  } else if (postsLast7d >= expectedPerWeek) {
    status = "on_track";
  } else {
    status = "behind";
  }

  return {
    lastPostAt,
    daysSinceLastPost,
    postsLast7d,
    postsLast30d,
    currentStreakDays,
    expectedPerWeek,
    pace7d,
    status,
    calendar,
  };
}

export const STATUS_META: Record<
  CadenceStatus,
  { label: string; tone: string; hint: string }
> = {
  on_track: { label: "On track", tone: "green", hint: "Meeting the weekly target" },
  behind: { label: "Behind", tone: "amber", hint: "Posting, but under target pace" },
  quiet: { label: "Gone quiet", tone: "red", hint: "No recent posts — reach out" },
  no_data: { label: "No posts yet", tone: "slate", hint: "Nothing tracked yet" },
};
