import { prisma } from "./db";

// Cross-post grouping: one original video, posted to several platforms, is
// still one video. Payout rules that pay per video (and judge "500 views on at
// least one platform") need to know which rows are copies of the same original
// — nothing else in the app does, since a Post is keyed per platform.
//
// There is no shared id across platforms to join on, so this matches on the
// two signals we actually store: when it went up, and what the caption says.
// Auto-matching is a guess, so every decision is overridable by hand — a post
// with groupPinned set keeps the groupKey it was given and is never moved.

const HOUR = 3_600_000;

// A confident caption match tolerates a slow cross-post (posted to IG the next
// day). Without one, copies have to have gone up in the same sitting.
const CAPTION_MATCH_HOURS = 72;
const NO_CAPTION_HOURS = 3;
// Below this many meaningful characters a caption says nothing useful — "😂"
// or "new drop" matches half a creator's output.
const MIN_CAPTION_CHARS = 12;
const STRONG_SIM = 0.82;
const PARTIAL_SIM = 0.5;

export interface GroupablePost {
  id: string;
  platform: string;
  postedAt: Date;
  caption: string | null;
  groupKey: string | null;
  groupPinned: boolean;
}

/** Caption stripped down to the words that actually identify a video. */
export function normalizeCaption(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ") // links
    .replace(/[#@][\p{L}\p{N}_.]+/gu, " ") // hashtags + mentions differ per platform
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}]/gu, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Dice coefficient over character bigrams: 1 = identical, 0 = nothing shared.
 * Returns -1 when either caption is too thin to judge, so callers can tell
 * "these disagree" from "there's nothing to compare".
 */
export function captionSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const x = normalizeCaption(a);
  const y = normalizeCaption(b);
  if (x.length < MIN_CAPTION_CHARS || y.length < MIN_CAPTION_CHARS) return -1;
  if (x === y) return 1;

  const bigrams = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };
  const ax = bigrams(x);
  const by = bigrams(y);
  let shared = 0;
  for (const [g, n] of ax) shared += Math.min(n, by.get(g) ?? 0);
  return (2 * shared) / (x.length - 1 + y.length - 1);
}

/**
 * How strongly two posts look like the same original. Negative = not a match.
 * Higher wins when a post could join more than one group.
 */
export function matchScore(a: GroupablePost, b: GroupablePost): number {
  if (a.platform === b.platform) return -1; // one original, one copy per platform
  const gapH = Math.abs(a.postedAt.getTime() - b.postedAt.getTime()) / HOUR;
  if (gapH > CAPTION_MATCH_HOURS) return -1;
  const sim = captionSimilarity(a.caption, b.caption);
  // Closer in time breaks ties, but never outranks better caption evidence.
  const recency = gapH / (CAPTION_MATCH_HOURS * 100);
  if (sim >= STRONG_SIM) return 1 - recency;
  if (gapH > NO_CAPTION_HOURS) return -1;
  if (sim < 0) return 0.5 - recency; // no caption to judge — went up together
  if (sim >= PARTIAL_SIM) return 0.6 - recency;
  return 0.35 - recency; // captions disagree, but posted in the same sitting
}

interface Group {
  key: string | null;
  members: GroupablePost[];
  earliest: number;
  platforms: Set<string>;
  pinned: boolean;
}

/**
 * Assign every post to an original. Pure — no DB. Returns the groupKey each
 * post should have; null means "on its own" (the common case).
 *
 * Pinned posts are taken as given: they seed the groups they name and are
 * never reassigned. Everything else is regrouped from scratch, so a fixed
 * mistake stays fixed while new posts still land automatically.
 */
export function autoGroup(posts: GroupablePost[]): Map<string, string | null> {
  const out = new Map<string, string | null>();
  const byTime = [...posts].sort((a, b) => a.postedAt.getTime() - b.postedAt.getTime());

  // Pinned posts sharing a key are an untouchable group; a pinned post with no
  // key was split off deliberately and stays alone.
  const groups: Group[] = [];
  const pinnedByKey = new Map<string, Group>();
  for (const p of byTime) {
    if (!p.groupPinned) continue;
    out.set(p.id, p.groupKey);
    if (!p.groupKey) continue;
    let g = pinnedByKey.get(p.groupKey);
    if (!g) {
      g = { key: p.groupKey, members: [], earliest: p.postedAt.getTime(), platforms: new Set(), pinned: true };
      pinnedByKey.set(p.groupKey, g);
      groups.push(g);
    }
    g.members.push(p);
    g.platforms.add(p.platform);
    g.earliest = Math.min(g.earliest, p.postedAt.getTime());
  }

  // Posts are in time order, so any group older than the caption window can
  // never take another member — that keeps this near-linear on long histories.
  const open: Group[] = groups.filter((g) => g.members.length > 0);

  for (const p of byTime) {
    if (p.groupPinned) continue;
    const cutoff = p.postedAt.getTime() - CAPTION_MATCH_HOURS * HOUR;
    for (let i = open.length - 1; i >= 0; i--) if (open[i].earliest < cutoff) open.splice(i, 1);

    let best: Group | null = null;
    let bestScore = 0;
    for (const g of open) {
      if (g.platforms.has(p.platform)) continue;
      // Every existing member has to agree it's the same video — the weakest
      // link decides, so a group can't drift across a chain of near-misses.
      let score = Infinity;
      for (const m of g.members) score = Math.min(score, matchScore(m, p));
      if (score > bestScore) {
        bestScore = score;
        best = g;
      }
    }

    if (best) {
      best.members.push(p);
      best.platforms.add(p.platform);
      out.set(p.id, best.key);
    } else {
      const g: Group = { key: null, members: [p], earliest: p.postedAt.getTime(), platforms: new Set([p.platform]), pinned: false };
      groups.push(g);
      open.push(g);
      out.set(p.id, null);
    }
  }

  // Name the groups that ended up with copies. Reuse a key the members already
  // carry so a re-run doesn't churn the column; otherwise derive one from the
  // earliest member, which is stable as long as the original doesn't change.
  for (const g of groups) {
    if (g.pinned) continue;
    if (g.members.length < 2) {
      for (const m of g.members) out.set(m.id, null);
      continue;
    }
    const inherited = g.members.map((m) => m.groupKey).find((k) => k != null) ?? null;
    const key = inherited ?? `grp_${[...g.members].sort((a, b) => a.postedAt.getTime() - b.postedAt.getTime())[0].id}`;
    for (const m of g.members) out.set(m.id, key);
  }

  return out;
}

/**
 * Recompute cross-post groups and persist the changes. Idempotent and cheap on
 * a settled roster — only posts whose group actually moved are written — so the
 * sync routes can call it every run, like dedupePosts.
 */
export async function syncVideoGroups(clientId?: string): Promise<{ grouped: number; changed: number }> {
  const creators = await prisma.creator.findMany({
    where: clientId ? { clientId } : {},
    select: { id: true },
  });

  let grouped = 0;
  let changed = 0;
  for (const c of creators) {
    const posts = await prisma.post.findMany({
      where: { creatorId: c.id },
      select: { id: true, platform: true, postedAt: true, caption: true, groupKey: true, groupPinned: true },
    });
    if (posts.length < 2) continue;

    const assigned = autoGroup(posts);
    const writes = posts
      .filter((p) => !p.groupPinned && (assigned.get(p.id) ?? null) !== p.groupKey)
      .map((p) => prisma.post.update({ where: { id: p.id }, data: { groupKey: assigned.get(p.id) ?? null } }));
    // Chunked: the very first run over a long history can move thousands of
    // rows, which is more than one transaction should carry.
    for (let i = 0; i < writes.length; i += 200) await prisma.$transaction(writes.slice(i, i + 200));
    changed += writes.length;
    grouped += new Set([...assigned.values()].filter((k): k is string => k != null)).size;
  }
  return { grouped, changed };
}
