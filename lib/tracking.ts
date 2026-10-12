// A creator's tracking window. Creators often repurpose their account once
// their time with a client is over, so each creator can carry a cutoff day:
// posts dated after it are not theirs-for-the-client and are never ingested,
// while everything before it stays tracked (stats keep refreshing on sync).
// The cutoff is stored as UTC midnight of the chosen calendar day and compared
// by day in the app timezone, the same way posts are bucketed everywhere else.

import { dayKey } from "./cadence";

/** "YYYY-MM-DD" of a creator's tracking cutoff, or null when still tracking. */
export function trackUntilDay(trackUntil: Date | string | null | undefined): string | null {
  if (!trackUntil) return null;
  const d = trackUntil instanceof Date ? trackUntil : new Date(trackUntil);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** Whether a post dated `postedAt` falls inside the creator's tracked span. */
export function isTracked(postedAt: Date, trackUntil: Date | string | null | undefined, tz: string): boolean {
  const day = trackUntilDay(trackUntil);
  return !day || dayKey(postedAt, tz) <= day;
}

/** True once `now` is past the cutoff day. */
export function trackingEnded(trackUntil: Date | string | null | undefined, now: Date, tz: string): boolean {
  const day = trackUntilDay(trackUntil);
  return !!day && dayKey(now, tz) > day;
}

/**
 * The instant cadence is judged at: now for a tracked creator, the cutoff day
 * for one whose tracking has ended — so a creator who left reads the way they
 * did on their last day instead of drifting to "gone quiet" forever after.
 */
export function cadenceNow(trackUntil: Date | string | null | undefined, now: Date, tz: string): Date {
  const day = trackUntilDay(trackUntil);
  if (!day || dayKey(now, tz) <= day) return now;
  // Noon UTC falls on that calendar day in every timezone the app runs in.
  return new Date(`${day}T12:00:00Z`);
}
