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
import { downloadImage, type StoredImage } from "./avatar";
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
  postsAvatar: string | null;
}

/**
 * Finds the creator's profile picture and downloads it. Instagram is the source
 * of truth, TikTok covers creators with no IG, and an avatar seen on a post is
 * the last resort. Returns null when nothing usable turned up.
 */
async function resolveAvatar(
  src: AvatarSource,
  apiKey: string
): Promise<{ url: string; image: StoredImage | null } | null> {
  let url: string | null = null;

  if (src.igHandle) {
    try {
      url = (await fetchInstagramProfile(src.igHandle, apiKey)).avatarUrl;
    } catch (e) {
      // A missing photo shouldn't fail an otherwise good sync.
      console.warn(`avatar (ig @${src.igHandle}):`, (e as Error).message);
    }
  }
  if (!url && src.tiktokHandle) {
    try {
      url = (await fetchTikTokProfile(src.tiktokHandle, apiKey)).avatarUrl;
    } catch (e) {
      console.warn(`avatar (tt @${src.tiktokHandle}):`, (e as Error).message);
    }
  }
  if (!url) url = src.postsAvatar;
  if (!url) return null;

  return { url, image: await downloadImage(url) };
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
  // Avatar found on a post payload — the weakest source, used only as a backstop.
  let postsAvatar: string | null = null;

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
      if (r.avatarUrl) postsAvatar = r.avatarUrl;
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
      if (r.avatarUrl && !postsAvatar) postsAvatar = r.avatarUrl;
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
  // so once we've stored the image (avatarAt is set) every later sync skips
  // this entirely — no extra API credits, nothing to break. Resyncing a single
  // creator passes refreshAvatar to deliberately re-pull it.
  const avatar =
    opts.refreshAvatar || !creator.avatarAt
      ? await resolveAvatar({ igHandle, tiktokHandle, postsAvatar }, apiKey)
      : null;

  const anyTried = results.length > 0;
  const anyOk = results.some((r) => r.ok);
  const errors = results.filter((r) => !r.ok).map((r) => `${r.platform}: ${r.error}`);

  await prisma.creator.update({
    where: { id: creator.id },
    data: {
      lastSyncedAt: new Date(),
      lastSyncStatus: !anyTried ? "never" : anyOk && !errors.length ? "ok" : anyOk ? "partial" : "error",
      lastSyncError: errors.length ? errors.join(" | ") : null,
      // Only stamp avatarAt once the bytes are safely stored — if the download
      // failed we keep the URL and try again on the next sync.
      ...(avatar ? { avatarUrl: avatar.url } : {}),
      ...(avatar?.image
        ? {
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
