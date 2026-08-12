// ScrapeCreators API client + tolerant normalizers.
// TikTok schema is confirmed from their OpenAPI spec. Instagram's exact field
// names can drift, so the IG normalizer probes several candidate paths and we
// keep the raw payload logged on the caller side when parsing yields nothing.

const BASE = "https://api.scrapecreators.com";

export type Platform = "tiktok" | "instagram";

export interface NormalizedPost {
  platform: Platform;
  platformPostId: string;
  url: string | null;
  caption: string | null;
  thumbnailUrl: string | null;
  postedAt: Date;
  views: number;
  likes: number;
  comments: number;
  shares: number;
}

export interface FetchResult {
  posts: NormalizedPost[];
  /** platform user id we discovered (cache it for faster future lookups) */
  userId?: string | null;
  /** follower count if present in the payload (for growth charts) */
  followers?: number | null;
  rawCount: number;
}

export class ScrapeCreatorsError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "ScrapeCreatorsError";
    this.status = status;
  }
}

// ---------- URL / handle parsing ----------

export function parseTikTokHandle(input: string): string | null {
  if (!input) return null;
  const s = input.trim();
  const m = s.match(/tiktok\.com\/@([A-Za-z0-9._]+)/i);
  if (m) return m[1];
  if (s.startsWith("@")) return s.slice(1);
  if (/^[A-Za-z0-9._]+$/.test(s)) return s;
  return null;
}

export function parseInstagramHandle(input: string): string | null {
  if (!input) return null;
  const s = input.trim();
  const m = s.match(/instagram\.com\/([A-Za-z0-9._]+)/i);
  if (m && !["p", "reel", "reels", "stories"].includes(m[1].toLowerCase()))
    return m[1];
  if (s.startsWith("@")) return s.slice(1);
  if (/^[A-Za-z0-9._]+$/.test(s)) return s;
  return null;
}

// ---------- helpers ----------

function num(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? Number(n) : 0;
}

/** first defined value among candidate paths like "a.b.c" */
function pick(obj: any, paths: string[]): unknown {
  for (const path of paths) {
    let cur: any = obj;
    let ok = true;
    for (const part of path.split(".")) {
      if (cur == null) {
        ok = false;
        break;
      }
      cur = cur[part];
    }
    if (ok && cur != null) return cur;
  }
  return undefined;
}

function toDate(v: unknown): Date | null {
  if (v == null) return null;
  if (typeof v === "number") {
    // seconds vs milliseconds
    const ms = v < 1e12 ? v * 1000 : v;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof v === "string") {
    if (/^\d+$/.test(v)) return toDate(Number(v));
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

async function scGet(path: string, params: Record<string, string>, apiKey: string) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${BASE}${path}?${qs}`, {
    headers: { "x-api-key": apiKey },
    // never cache creator data
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ScrapeCreatorsError(
      `ScrapeCreators ${path} -> ${res.status} ${body.slice(0, 200)}`,
      res.status
    );
  }
  return res.json();
}

// ---------- TikTok ----------

export async function fetchTikTok(
  opts: { handle?: string | null; userId?: string | null },
  apiKey: string
): Promise<FetchResult> {
  const params: Record<string, string> = { sort_by: "latest", trim: "true" };
  if (opts.userId) params.user_id = opts.userId;
  else if (opts.handle) params.handle = opts.handle;
  else throw new ScrapeCreatorsError("TikTok: need handle or userId");

  const data = await scGet("/v3/tiktok/profile/videos", params, apiKey);
  const list: any[] = data?.aweme_list ?? data?.data?.aweme_list ?? [];
  const posts: NormalizedPost[] = [];
  let userId: string | null = opts.userId ?? null;

  for (const it of list) {
    const id = String(pick(it, ["aweme_id", "id"]) ?? "");
    if (!id) continue;
    const author = pick(it, ["author.unique_id", "author.uniqueId"]) as string | undefined;
    if (!userId) userId = (pick(it, ["author.uid", "author.id"]) as string) ?? null;
    const postedAt = toDate(pick(it, ["create_time", "createTime"]));
    if (!postedAt) continue;
    const handle = author || opts.handle || "";
    posts.push({
      platform: "tiktok",
      platformPostId: id,
      url: handle ? `https://www.tiktok.com/@${handle}/video/${id}` : null,
      caption: (pick(it, ["desc"]) as string) ?? null,
      thumbnailUrl:
        (pick(it, [
          "video.cover.url_list.0",
          "video.origin_cover.url_list.0",
          "video.dynamic_cover.url_list.0",
        ]) as string) ?? null,
      postedAt,
      views: num(pick(it, ["statistics.play_count"])),
      likes: num(pick(it, ["statistics.digg_count"])),
      comments: num(pick(it, ["statistics.comment_count"])),
      shares: num(pick(it, ["statistics.share_count"])),
    });
  }
  const followers = list.length
    ? num(pick(list[0], ["author.follower_count", "author.followerCount"])) || null
    : null;
  return { posts, userId, followers, rawCount: list.length };
}

// ---------- Instagram ----------

export async function fetchInstagram(
  opts: { handle: string },
  apiKey: string
): Promise<FetchResult> {
  const data = await scGet(
    "/v2/instagram/user/posts",
    { handle: opts.handle },
    apiKey
  );

  // The array of items lives under one of these depending on API version.
  const list: any[] =
    (pick(data, ["items", "data.items", "data", "posts", "media"]) as any[]) ?? [];

  const posts: NormalizedPost[] = [];
  for (const raw of Array.isArray(list) ? list : []) {
    // Some responses wrap the media object.
    const it = raw?.media ?? raw?.node ?? raw;
    const code =
      (pick(it, ["code", "shortcode"]) as string) ??
      (pick(it, ["pk", "id"]) as string);
    const id = String(pick(it, ["pk", "id", "code", "shortcode"]) ?? "");
    if (!id) continue;
    const postedAt = toDate(
      pick(it, ["taken_at", "taken_at_timestamp", "device_timestamp", "timestamp"])
    );
    if (!postedAt) continue;

    const caption =
      (pick(it, ["caption.text", "caption", "edge_media_to_caption.edges.0.node.text"]) as string) ??
      null;

    posts.push({
      platform: "instagram",
      platformPostId: id,
      url: code ? `https://www.instagram.com/p/${code}/` : null,
      caption: typeof caption === "string" ? caption : null,
      thumbnailUrl:
        (pick(it, [
          "image_versions2.candidates.0.url",
          "thumbnail_url",
          "display_url",
          "thumbnail_src",
        ]) as string) ?? null,
      postedAt,
      views: num(
        pick(it, ["play_count", "view_count", "ig_play_count", "video_view_count"])
      ),
      likes: num(pick(it, ["like_count", "edge_liked_by.count", "edge_media_preview_like.count"])),
      comments: num(pick(it, ["comment_count", "edge_media_to_comment.count"])),
      shares: num(pick(it, ["reshare_count", "share_count"])),
    });
  }
  const followers =
    num(
      pick(data, [
        "user.follower_count",
        "user.edge_followed_by.count",
        "data.user.follower_count",
        "follower_count",
      ])
    ) || null;
  return { posts, followers, rawCount: Array.isArray(list) ? list.length : 0 };
}
