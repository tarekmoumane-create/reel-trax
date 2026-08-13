import { prisma } from "./db";
import {
  fetchTikTok,
  fetchInstagram,
  fetchInstagramProfile,
  fetchTikTokProfile,
  parseTikTokHandle,
  parseInstagramHandle,
  type NormalizedPost,
} from "./scrapecreators";
import { downloadFirstWebSafe, isWebSafeMime, type StoredImage } from "./avatar";
import { dayKey } from "./cadence";
import { getTimeZone } from "./settings";
import type { Creator } from "@prisma/client";

async function snapshotFollowers(
  creatorId: string,
  platform: string,
  followers: number | null | undefined,
  tz: string
) {
  if (!followers || followers <= 0) return;
  const day = dayKey(new Date(), tz);
  await prisma.followerSnapshot.upsert({
    where: { creatorId_platform_day: { creatorId, platform, day } },
    create: { creatorId, platform, day, followers },
    update: { followers },
  });
}

export interface PlatformSyncResult {
  platform: "tiktok" | "instagram";
  ok: boolean;
  fetched: number;
  upserted: number;
  error?: string;
}

export interface CreatorSyncResult {
  creatorId: string;
  displayName: string;
  results: PlatformSyncResult[];
  ok: boolean;
}

/**
 * A creator to sync. Stored avatar bytes are deliberately excluded — a bulk
 * sync would otherwise pull every creator's image into memory to do nothing
 * with it. `avatarAt` is all the sync needs to know we already have a photo.
 */
export type SyncableCreator = Omit<Creator, "avatarData">;

interface AvatarSource {
  igHandle: string | null;
  tiktokHandle: string | null;
  postsAvatars: string[];
}

/**
 * Finds the creator's profile picture and downloads it. Instagram is the source
 * of truth, TikTok covers creators with no IG, and avatars seen on posts are
 * the last resort. Candidates are pooled and the first one that downloads as a
 * browser-renderable image wins — TikTok's HEIC-only URLs are skipped over.
 * Returns null when nothing usable turned up.
 */
async function resolveAvatar(
  src: AvatarSource,
  apiKey: string
): Promise<{ url: string; image: StoredImage } | null> {
  const candidates: string[] = [];

  if (src.igHandle) {
    try {
      candidates.push(...(await fetchInstagramProfile(src.igHandle, apiKey)).avatarUrls);
    } catch (e) {
      // A missing photo shouldn't fail an otherwise good sync.
      console.warn(`avatar (ig @${src.igHandle}):`, (e as Error).message);
    }
  }
  if (candidates.length === 0 && src.tiktokHandle) {
    try {
      candidates.push(...(await fetchTikTokProfile(src.tiktokHandle, apiKey)).avatarUrls);
    } catch (e) {
      console.warn(`avatar (tt @${src.tiktokHandle}):`, (e as Error).message);
    }
  }
  candidates.push(...src.postsAvatars);

  return downloadFirstWebSafe(candidates);
}

async function upsertPosts(creatorId: string, posts: NormalizedPost[]): Promise<number> {
  let count = 0;
  for (const p of posts) {
    await prisma.post.upsert({
      where: {
        platform_platformPostId: {
          platform: p.platform,
          platformPostId: p.platformPostId,
        },
      },
      create: {
        creatorId,
        platform: p.platform,
        platformPostId: p.platformPostId,
        url: p.url,
        caption: p.caption,
        thumbnailUrl: p.thumbnailUrl,
        postedAt: p.postedAt,
        views: p.views,
        likes: p.likes,
        comments: p.comments,
        shares: p.shares,
        source: "auto",
      },
      update: {
        // refresh mutable stats + backfill fields, keep creator link stable
        url: p.url ?? undefined,
        caption: p.caption ?? undefined,
        thumbnailUrl: p.thumbnailUrl ?? undefined,
        postedAt: p.postedAt,
        views: p.views,
        likes: p.likes,
        comments: p.comments,
        shares: p.shares,
        fetchedAt: new Date(),
      },
    });
    count++;
  }
  return count;
}

export async function syncCreator(
  creator: SyncableCreator,
  apiKey: string,
  opts: { refreshAvatar?: boolean } = {}
): Promise<CreatorSyncResult> {
  const results: PlatformSyncResult[] = [];
  const tz = await getTimeZone();
  // Avatar candidates found on post payloads — the weakest source, a backstop.
  const postsAvatars: string[] = [];

  // ---- TikTok ----
  const tiktokHandle =
    creator.tiktokHandle ||
    parseTikTokHandle(creator.tiktokUrl || "") ||
    null;
  if (tiktokHandle || creator.tiktokUserId) {
    try {
      const r = await fetchTikTok(
        { handle: tiktokHandle, userId: creator.tiktokUserId },
        apiKey
      );
      const upserted = await upsertPosts(creator.id, r.posts);
      await snapshotFollowers(creator.id, "tiktok", r.followers, tz);
      if (r.avatarUrls?.length) postsAvatars.push(...r.avatarUrls);
      // cache discovered user id for faster future calls
      if (r.userId && r.userId !== creator.tiktokUserId) {
        await prisma.creator.update({
          where: { id: creator.id },
          data: { tiktokUserId: r.userId },
        });
      }
      results.push({
        platform: "tiktok",
        ok: true,
        fetched: r.rawCount,
        upserted,
      });
    } catch (e) {
      results.push({
        platform: "tiktok",
        ok: false,
        fetched: 0,
        upserted: 0,
        error: (e as Error).message,
      });
    }
  }

  // ---- Instagram ----
  const igHandle =
    creator.instagramHandle ||
    parseInstagramHandle(creator.instagramUrl || "") ||
    null;
  if (igHandle) {
    try {
      const r = await fetchInstagram({ handle: igHandle }, apiKey);
      const upserted = await upsertPosts(creator.id, r.posts);
      await snapshotFollowers(creator.id, "instagram", r.followers, tz);
      if (r.avatarUrls?.length) postsAvatars.push(...r.avatarUrls);
      results.push({
        platform: "instagram",
        ok: true,
        fetched: r.rawCount,
        upserted,
      });
    } catch (e) {
      results.push({
        platform: "instagram",
        ok: false,
        fetched: 0,
        upserted: 0,
        error: (e as Error).message,
      });
    }
  }

  // ---- Profile picture ----
  // Fetched once and then left alone: creators almost never change their photo,
  // so once we've stored a usable image every later sync skips this entirely —
  // no extra API credits, nothing to break. A stored photo in a format browsers
  // can't render (HEIC from TikTok) counts as not having one, so those heal
  // here too. Resyncing a single creator passes refreshAvatar to re-pull it.
  const hasGoodAvatar = !!creator.avatarAt && isWebSafeMime(creator.avatarMime);
  const avatar =
    opts.refreshAvatar || !hasGoodAvatar
      ? await resolveAvatar({ igHandle, tiktokHandle, postsAvatars }, apiKey)
      : null;

  const anyTried = results.length > 0;
  const anyOk = results.some((r) => r.ok);
  const errors = results.filter((r) => !r.ok).map((r) => `${r.platform}: ${r.error}`);

  // ---- Daily stats snapshot ----
  // Post rows only hold each post's current totals, so "views gained today"
  // has to be captured while it's happening: after every successful sync we
  // record the creator's summed totals for today, and the analytics endpoint
  // charts the day-over-day differences.
  if (anyOk) {
    const agg = await prisma.post.aggregate({
      where: { creatorId: creator.id },
      _sum: { views: true, likes: true, comments: true, shares: true },
      _count: true,
    });
    const day = dayKey(new Date(), tz);
    const stats = {
      views: agg._sum.views ?? 0,
      likes: agg._sum.likes ?? 0,
      comments: agg._sum.comments ?? 0,
      shares: agg._sum.shares ?? 0,
      posts: agg._count,
    };
    await prisma.creatorStatSnapshot.upsert({
      where: { creatorId_day: { creatorId: creator.id, day } },
      create: { creatorId: creator.id, day, ...stats },
      update: stats,
    });
  }

  await prisma.creator.update({
    where: { id: creator.id },
    data: {
      lastSyncedAt: new Date(),
      lastSyncStatus: !anyTried ? "never" : anyOk && !errors.length ? "ok" : anyOk ? "partial" : "error",
      lastSyncError: errors.length ? errors.join(" | ") : null,
      // resolveAvatar only returns once the bytes are downloaded and renderable,
      // so storing and stamping avatarAt happen together — or not at all, in
      // which case the next sync simply tries again.
      ...(avatar
        ? {
            avatarUrl: avatar.url,
            avatarData: avatar.image.data,
            avatarMime: avatar.image.mime,
            avatarAt: new Date(),
          }
        : {}),
    },
  });

  return {
    creatorId: creator.id,
    displayName: creator.displayName,
    results,
    ok: anyOk,
  };
}

/** Sync many creators with light concurrency to be gentle on the API. */
export async function syncCreators(
  creators: SyncableCreator[],
  apiKey: string,
  concurrency = 3
): Promise<CreatorSyncResult[]> {
  const out: CreatorSyncResult[] = [];
  let i = 0;
  async function worker() {
    while (i < creators.length) {
      const idx = i++;
      out[idx] = await syncCreator(creators[idx], apiKey);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, creators.length) }, worker)
  );
  return out;
}
