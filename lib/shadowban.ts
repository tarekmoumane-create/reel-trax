// Shadow-ban detection. Pure: posts in, flags out — no DB, no I/O.
//
// The rule (set by the agency): an account looks shadow banned when it gets
// under 10 views for more than two days in a row. "Days" are posting days —
// a creator who posts every other day still burns a day per upload — and a
// run only counts if it reaches the account's most recent posts, so an old
// bad patch they've since recovered from doesn't keep the flag up.

import { dayKey } from "./cadence";

export interface ShadowBanPost {
  platform: string;
  postedAt: Date | string;
  views: number;
}

export interface ShadowBanFlag {
  platform: string;
  /** consecutive posting days under the view threshold, latest first */
  days: number;
  /** posts across those days */
  posts: number;
  /** first and last of those posting days, YYYY-MM-DD */
  from: string;
  to: string;
}

export interface ShadowBanOptions {
  now?: Date;
  timeZone?: string;
  /** a post with fewer views than this counts as throttled (default 10) */
  viewThreshold?: number;
  /** flag after this many throttled posting days in a row (default 3 = "more than two") */
  minDays?: number;
  /** posts younger than this haven't had a fair chance to be seen yet (default 24h) */
  minAgeHours?: number;
  /** a run whose last post is older than this is dormancy, not a ban (default 30d) */
  maxStaleDays?: number;
}

// Threads reports no view counts at all — every post would look throttled.
const NO_VIEW_COUNTS = new Set(["threads"]);

export function detectShadowBans(posts: ShadowBanPost[], opts: ShadowBanOptions = {}): ShadowBanFlag[] {
  const now = opts.now ?? new Date();
  const tz = opts.timeZone ?? "America/New_York";
  const threshold = opts.viewThreshold ?? 10;
  const minDays = opts.minDays ?? 3;
  const minAgeMs = (opts.minAgeHours ?? 24) * 3_600_000;
  const staleMs = (opts.maxStaleDays ?? 30) * 86_400_000;

  // platform → day → [views...] over posts old enough to judge
  const byPlatform = new Map<string, Map<string, number[]>>();
  for (const p of posts) {
    if (NO_VIEW_COUNTS.has(p.platform)) continue;
    const at = p.postedAt instanceof Date ? p.postedAt : new Date(p.postedAt);
    if (isNaN(at.getTime()) || now.getTime() - at.getTime() < minAgeMs) continue;
    const day = dayKey(at, tz);
    let days = byPlatform.get(p.platform);
    if (!days) byPlatform.set(p.platform, (days = new Map()));
    const arr = days.get(day);
    if (arr) arr.push(p.views);
    else days.set(day, [p.views]);
  }

  const flags: ShadowBanFlag[] = [];
  for (const [platform, days] of byPlatform) {
    const ordered = [...days.keys()].sort().reverse(); // latest posting day first
    if (!ordered.length) continue;
    // Dormant account: nothing recent enough to judge.
    if (now.getTime() - new Date(`${ordered[0]}T12:00:00Z`).getTime() > staleMs) continue;
    let run = 0;
    let count = 0;
    for (const day of ordered) {
      const views = days.get(day)!;
      if (views.every((v) => v < threshold)) {
        run++;
        count += views.length;
      } else break;
    }
    if (run >= minDays) {
      flags.push({ platform, days: run, posts: count, from: ordered[run - 1], to: ordered[0] });
    }
  }
  return flags.sort((a, b) => b.days - a.days);
}

export const SHADOW_BAN_RULE = "Under 10 views on more than two posting days in a row";
