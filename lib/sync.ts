import { prisma } from "./db";
import {
  fetchTikTok,
  fetchInstagram,
  fetchInstagramProfile,
  fetchTikTokProfile,
  fetchYouTubeProfile,
  fetchYouTubeShorts,
  fetchThreads,
  fetchThreadsProfile,
  parseTikTokHandle,
  parseInstagramHandle,
  parseYouTube,
  parseThreadsHandle,
  parseFacebook,
  fetchFacebookProfile,
  fetchFacebookReels,
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
  platform: "tiktok" | "instagram" | "youtube" | "threads" | "facebook";
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
  youtube: { handle: string | null; channelId: string | null } | null;
  threadsHandle: string | null;
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
  if (candidates.length === 0 && src.youtube && (src.youtube.handle || src.youtube.channelId)) {
    try {
      candidates.push(...(await fetchYouTubeProfile(src.youtube, apiKey)).avatarUrls);
    } catch (e) {
      console.warn(`avatar (yt ${src.youtube.handle ?? src.youtube.channelId}):`, (e as Error).message);
    }
  }
  if (candidates.length === 0 && src.threadsHandle) {
    try {
      candidates.push(...(await fetchThreadsProfile(src.threadsHandle, apiKey)).avatarUrls);
    } catch (e) {
      console.warn(`avatar (threads @${src.threadsHandle}):`, (e as Error).message);
    }
  }
  // Facebook's page photo is already in postsAvatars (fetched during sync).
  candidates.push(...src.postsAvatars);

  return downloadFirstWebSafe(candidates);
}

// Per-post daily history is only kept while a payout view-window could still
// reference it; beyond that the post's current totals are all anyone needs.
const POST_SNAPSHOT_MAX_AGE_DAYS = 60;

// Facebook's reels endpoint pages 10 at a time, one credit per page.
const FB_FIRST_SYNC_PAGES = 8; // up to 80 reels of history on first sync
const FB_SYNC_PAGES = 2; // the 20 newest get fresh view counts after that

async function upsertPosts(creatorId: string, posts: NormalizedPost[], tz: string): Promise<number> {
  let count = 0;
  const day = dayKey(new Date(), tz);
  const snapshotCutoff = Date.now() - POST_SNAPSHOT_MAX_AGE_DAYS * 86_400_000;
  for (const p of posts) {
    const row = await prisma.post.upsert({
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
    // Today's per-post view count — the history that makes "views within N
    // days of posting" (viewWindowDays payout rules) judgeable later.
    if (row.postedAt.getTime() >= snapshotCutoff) {
      await prisma.postStatSnapshot.upsert({
        where: { postId_day: { postId: row.id, day } },
        create: { postId: row.id, day, views: p.views },
        update: { views: p.views },
      });
    }
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
      const upserted = await upsertPosts(creator.id, r.posts, tz);
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
      const upserted = await upsertPosts(creator.id, r.posts, tz);
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

  // ---- YouTube Shorts ----
  const ytParsed = parseYouTube(creator.youtubeUrl || "");
  const yt = {
    handle: creator.youtubeHandle || ytParsed.handle,
    channelId: creator.youtubeChannelId || ytParsed.channelId,
  };
  if (yt.handle || yt.channelId || creator.youtubeUrl) {
    try {
      // Channel details every sync: subscriber count for the followers chart,
      // and the channel id (a /c/… or /user/… URL only resolves through here).
      const prof = await fetchYouTubeProfile(
        yt.handle || yt.channelId ? yt : { url: creator.youtubeUrl },
        apiKey
      );
      if (prof.userId && prof.userId !== creator.youtubeChannelId) {
        yt.channelId = prof.userId;
        await prisma.creator.update({ where: { id: creator.id }, data: { youtubeChannelId: prof.userId } });
      }
      if (prof.avatarUrls.length) postsAvatars.push(...prof.avatarUrls);
      const r = await fetchYouTubeShorts(yt, apiKey);
      const upserted = await upsertPosts(creator.id, r.posts, tz);
      await snapshotFollowers(creator.id, "youtube", prof.followers, tz);
      results.push({ platform: "youtube", ok: true, fetched: r.rawCount, upserted });
    } catch (e) {
      results.push({ platform: "youtube", ok: false, fetched: 0, upserted: 0, error: (e as Error).message });
    }
  }

  // ---- Threads ----
  const threadsHandle = creator.threadsHandle || parseThreadsHandle(creator.threadsUrl || "") || null;
  if (threadsHandle) {
    try {
      const r = await fetchThreads({ handle: threadsHandle }, apiKey);
      const upserted = await upsertPosts(creator.id, r.posts, tz);
      if (r.avatarUrls?.length) postsAvatars.push(...r.avatarUrls);
      // Follower count only lives on the profile endpoint (1 credit).
      try {
        const prof = await fetchThreadsProfile(threadsHandle, apiKey);
        await snapshotFollowers(creator.id, "threads", prof.followers, tz);
        if (prof.avatarUrls.length) postsAvatars.unshift(...prof.avatarUrls);
      } catch (e) {
        console.warn(`threads profile @${threadsHandle}:`, (e as Error).message);
      }
      results.push({ platform: "threads", ok: true, fetched: r.rawCount, upserted });
    } catch (e) {
      results.push({ platform: "threads", ok: false, fetched: 0, upserted: 0, error: (e as Error).message });
    }
  }

  // ---- Facebook Reels ----
  const fb = creator.facebookUrl ? { handle: creator.facebookHandle, url: creator.facebookUrl } : parseFacebook(creator.facebookHandle || "");
  if (fb.url) {
    try {
      // Page details every sync: follower count for the chart, numeric id cached.
      let followers: number | null = null;
      try {
        const prof = await fetchFacebookProfile(fb.url, apiKey);
        followers = prof.followers;
        if (prof.avatarUrls.length) postsAvatars.unshift(...prof.avatarUrls);
        if (prof.userId && prof.userId !== creator.facebookPageId) {
          await prisma.creator.update({ where: { id: creator.id }, data: { facebookPageId: prof.userId } });
        }
      } catch (e) {
        console.warn(`facebook profile ${fb.url}:`, (e as Error).message);
      }
      // 10 reels per page: a creator we've never pulled gets a deep first
      // pass for history, after that just the newest pages get refreshed.
      const known = await prisma.post.count({ where: { creatorId: creator.id, platform: "facebook" } });
      const r = await fetchFacebookReels({ url: fb.url, maxPages: known === 0 ? FB_FIRST_SYNC_PAGES : FB_SYNC_PAGES }, apiKey);
      const upserted = await upsertPosts(creator.id, r.posts, tz);
      await snapshotFollowers(creator.id, "facebook", followers, tz);
      if (r.avatarUrls?.length) postsAvatars.push(...r.avatarUrls);
      results.push({ platform: "facebook", ok: true, fetched: r.rawCount, upserted });
    } catch (e) {
      results.push({ platform: "facebook", ok: false, fetched: 0, upserted: 0, error: (e as Error).message });
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
      ? await resolveAvatar({ igHandle, tiktokHandle, youtube: yt, threadsHandle, postsAvatars }, apiKey)
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
      views: BigInt(agg._sum.views ?? 0),
      likes: BigInt(agg._sum.likes ?? 0),
      comments: BigInt(agg._sum.comments ?? 0),
      shares: BigInt(agg._sum.shares ?? 0),
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
