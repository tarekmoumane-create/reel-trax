import { prisma } from "./db";
import {
  fetchTikTok,
  fetchInstagram,
  parseTikTokHandle,
  parseInstagramHandle,
  type NormalizedPost,
} from "./scrapecreators";
import type { Creator } from "@prisma/client";

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
  creator: Creator,
  apiKey: string
): Promise<CreatorSyncResult> {
  const results: PlatformSyncResult[] = [];

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

  const anyTried = results.length > 0;
  const anyOk = results.some((r) => r.ok);
  const errors = results.filter((r) => !r.ok).map((r) => `${r.platform}: ${r.error}`);

  await prisma.creator.update({
    where: { id: creator.id },
    data: {
      lastSyncedAt: new Date(),
      lastSyncStatus: !anyTried ? "never" : anyOk && !errors.length ? "ok" : anyOk ? "partial" : "error",
      lastSyncError: errors.length ? errors.join(" | ") : null,
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
  creators: Creator[],
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
