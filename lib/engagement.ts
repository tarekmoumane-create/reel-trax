// Engagement rate: reactions (likes + comments + shares) per view.

interface Reactions {
  views: number;
  likes: number;
  comments: number;
  shares?: number;
}

/** One video's rate. Null when the platform gave no view count (Threads). */
export function engagementRate(p: Reactions): number | null {
  return p.views > 0 ? (p.likes + p.comments + (p.shares ?? 0)) / p.views : null;
}

/**
 * The rate across a set of videos: all their reactions over all their views.
 * Pooled rather than a mean of per-video rates, so a 12-view post with 6 likes
 * can't drag the average to 50%. Videos with no view count are left out of
 * both sides — their likes would otherwise count against no views at all.
 */
export function avgEngagement(posts: Reactions[]): number | null {
  let views = 0;
  let reactions = 0;
  for (const p of posts) {
    if (p.views <= 0) continue;
    views += p.views;
    reactions += p.likes + p.comments + (p.shares ?? 0);
  }
  return views > 0 ? reactions / views : null;
}

export function fmtPct(rate: number | null | undefined): string {
  if (rate == null) return "—";
  const pct = rate * 100;
  return `${pct >= 100 ? Math.round(pct) : pct.toFixed(1)}%`;
}
