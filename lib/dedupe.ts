import { prisma } from "./db";
import { canonicalPostKey } from "./scrapecreators";

// One-time repair that stays on: earlier syncs keyed Instagram (and Threads)
// posts by whichever raw id the API happened to return, so the same reel got
// stored under `pk` one sync and `pk_ownerid` the next — every leaderboard
// then listed it twice. This collapses those rows onto the URL-derived key
// that syncs now use, keeping the freshest stats, any pay flags set on either
// copy, and the merged daily snapshot history. Idempotent: once every row is
// on its canonical key there is nothing left to do, so the sync routes can
// call it every run.
export async function dedupePosts(): Promise<{ merged: number; rekeyed: number }> {
  const rows = await prisma.post.findMany({
    where: { platform: { in: ["instagram", "threads", "facebook", "snapchat"] }, url: { not: null } },
    select: {
      id: true, creatorId: true, platform: true, platformPostId: true, url: true, fetchedAt: true,
      views: true, likes: true, comments: true, shares: true, postedAt: true, caption: true, thumbnailUrl: true,
      payExclusions: true, isWarmUp: true, payOverride: true, source: true,
    },
  });

  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = canonicalPostKey(r.platform, r.url);
    if (!key) continue;
    const g = `${r.platform}|${key}`;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(r);
  }

  let merged = 0;
  let rekeyed = 0;
  for (const [g, members] of groups) {
    const key = g.slice(g.indexOf("|") + 1);
    const onKey = members.find((m) => m.platformPostId === key);
    if (members.length === 1 && onKey) continue; // already canonical

    // Keep the row already on the canonical key (so nothing else has to move),
    // else the most recently synced one.
    const byFresh = [...members].sort((a, b) => b.fetchedAt.getTime() - a.fetchedAt.getTime());
    const winner = onKey ?? byFresh[0];
    const losers = members.filter((m) => m.id !== winner.id);
    const freshest = byFresh[0];

    await prisma.$transaction(async (tx) => {
      for (const l of losers) {
        // Snapshot history: fold the loser's days into the winner's.
        const snaps = await tx.postStatSnapshot.findMany({ where: { postId: l.id } });
        for (const s of snaps) {
          const existing = await tx.postStatSnapshot.findUnique({ where: { postId_day: { postId: winner.id, day: s.day } } });
          if (!existing) await tx.postStatSnapshot.create({ data: { postId: winner.id, day: s.day, views: s.views } });
          else if (s.views > existing.views) await tx.postStatSnapshot.update({ where: { id: existing.id }, data: { views: s.views } });
        }
        await tx.post.delete({ where: { id: l.id } });
        merged++;
      }
      // Pay flags set on any copy survive; stats come from the freshest copy.
      const anyWarm = members.some((m) => m.isWarmUp);
      const override = members.find((m) => m.payOverride != null)?.payOverride ?? null;
      const exclusions = members.find((m) => m.payExclusions)?.payExclusions ?? null;
      await tx.post.update({
        where: { id: winner.id },
        data: {
          platformPostId: key,
          views: freshest.views, likes: freshest.likes, comments: freshest.comments, shares: freshest.shares,
          caption: freshest.caption ?? winner.caption, thumbnailUrl: freshest.thumbnailUrl ?? winner.thumbnailUrl,
          fetchedAt: freshest.fetchedAt,
          isWarmUp: anyWarm, payOverride: override, payExclusions: exclusions,
        },
      });
      if (winner.platformPostId !== key) rekeyed++;
    });
  }
  return { merged, rekeyed };
}
