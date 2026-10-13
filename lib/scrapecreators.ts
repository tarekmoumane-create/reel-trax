// ScrapeCreators API client + tolerant normalizers.
// TikTok schema is confirmed from their OpenAPI spec. Instagram's exact field
// names can drift, so the IG normalizer probes several candidate paths and we
// keep the raw payload logged on the caller side when parsing yields nothing.

const BASE = "https://api.scrapecreators.com";

export type Platform = "tiktok" | "instagram" | "youtube" | "threads" | "facebook" | "snapchat";

/**
 * The key a post is stored under, derived from its public URL. Instagram and
 * Threads payloads carry the same post under several id formats (`pk`,
 * `id` = "pk_ownerid", …) and the format drifts between API responses, so
 * keying on a raw id stored the same reel twice. The shortcode in the URL is
 * the one identifier that never changes. TikTok and YouTube ids are already
 * stable, so for them this simply re-derives the same id.
 */
export function canonicalPostKey(platform: string, url: string | null | undefined): string | null {
  if (!url) return null;
  const m =
    platform === "instagram" ? url.match(/instagram\.com\/(?:[^/]+\/)?(?:p|reel|reels)\/([A-Za-z0-9_-]+)/i)
    : platform === "threads" ? url.match(/threads\.(?:net|com)\/@?[^/]+\/post\/([A-Za-z0-9_-]+)/i)
    : platform === "tiktok" ? url.match(/tiktok\.com\/@[^/]+\/(?:video|photo)\/(\d+)/i)
    : platform === "youtube" ? url.match(/(?:youtube\.com\/(?:shorts\/|watch\?v=)|youtu\.be\/)([A-Za-z0-9_-]{6,})/i)
    : platform === "facebook" ? url.match(/facebook\.com\/(?:reel|[^/]+\/videos)\/(\d+)/i)
    : platform === "snapchat" ? url.match(/snapchat\.com\/(?:@[^/]+\/)?spotlight\/([A-Za-z0-9_-]+)/i)
    : null;
  return m ? m[1] : null;
}

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
  /**
   * Candidate profile-picture URLs, best first. A list because TikTok offers
   * the same photo in several formats and only some render in a browser —
   * the downloader picks the first one that actually works.
   */
  avatarUrls?: string[];
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

/**
 * YouTube channel identity from whatever got pasted: "@handle", a bare handle,
 * youtube.com/@handle, youtube.com/channel/UC…, or a youtube.com/c|user/… URL
 * (those only resolve to an id via the API — see fetchYouTubeProfile).
 */
export function parseYouTube(input: string): { handle: string | null; channelId: string | null } {
  const none = { handle: null, channelId: null };
  if (!input) return none;
  const s = input.trim();
  const ch = s.match(/youtube\.com\/channel\/(UC[A-Za-z0-9_-]{10,})/i);
  if (ch) return { handle: null, channelId: ch[1] };
  const at = s.match(/youtube\.com\/@([A-Za-z0-9._-]+)/i);
  if (at) return { handle: at[1], channelId: null };
  if (/youtube\.com|youtu\.be/i.test(s)) return none; // /c/… or /user/… — resolve later
  if (/^UC[A-Za-z0-9_-]{10,}$/.test(s)) return { handle: null, channelId: s };
  if (s.startsWith("@")) return { handle: s.slice(1), channelId: null };
  if (/^[A-Za-z0-9._-]+$/.test(s)) return { handle: s, channelId: null };
  return none;
}

export function parseThreadsHandle(input: string): string | null {
  if (!input) return null;
  const s = input.trim();
  const m = s.match(/threads\.(?:net|com)\/@?([A-Za-z0-9._]+)/i);
  if (m) return m[1];
  if (s.startsWith("@")) return s.slice(1);
  if (/^[A-Za-z0-9._]+$/.test(s)) return s;
  return null;
}

/**
 * Facebook page identity from whatever got pasted: facebook.com/<slug>,
 * facebook.com/profile.php?id=123, fb.com/<slug>, "@slug" or a bare slug.
 * Returns the slug (or numeric id) plus the canonical page URL the API takes.
 */
export function parseFacebook(input: string): { handle: string | null; url: string | null } {
  const none = { handle: null, url: null };
  if (!input) return none;
  const s = input.trim();
  const byId = s.match(/(?:facebook|fb)\.com\/profile\.php\?(?:.*&)?id=(\d+)/i);
  if (byId) return { handle: byId[1], url: `https://www.facebook.com/profile.php?id=${byId[1]}` };
  const slug = s.match(/(?:facebook|fb)\.com\/(?!reel\b|watch\b|share\b|groups\b|events\b|photo\b)([A-Za-z0-9.\-_]+)/i);
  if (slug) return { handle: slug[1], url: `https://www.facebook.com/${slug[1]}` };
  if (/facebook\.com|fb\.com/i.test(s)) return none;
  const bare = s.startsWith("@") ? s.slice(1) : s;
  if (/^[A-Za-z0-9.\-_]+$/.test(bare)) return { handle: bare, url: `https://www.facebook.com/${bare}` };
  return none;
}

/**
 * Snapchat username from whatever got pasted: snapchat.com/add/<user>,
 * snapchat.com/@<user>, "@user" or a bare username.
 */
export function parseSnapchatHandle(input: string): string | null {
  if (!input) return null;
  const s = input.trim();
  const m = s.match(/snapchat\.com\/(?:add\/|@)([A-Za-z0-9._-]+)/i);
  if (m) return m[1];
  if (/snapchat\.com/i.test(s)) return null; // a spotlight/story link, not a profile
  const bare = s.startsWith("@") ? s.slice(1) : s;
  if (/^[A-Za-z0-9._-]+$/.test(bare)) return bare;
  return null;
}

/**
 * A snapchat.com/t/<code> share link — what the Snapchat app's Share sheet
 * copies for a profile. It only says whose profile it is after a redirect,
 * so the username has to be resolved over the network (resolveSnapchat).
 */
export function isSnapchatShareLink(input: string): boolean {
  return /snapchat\.com\/t\/[A-Za-z0-9_-]+/i.test(input.trim());
}

const SNAP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** Follow a share link to the profile it opens; null when it goes nowhere. */
async function followSnapchatShareLink(input: string): Promise<string | null> {
  const m = input.trim().match(/(?:https?:\/\/)?(?:www\.)?snapchat\.com\/t\/[A-Za-z0-9_-]+/i);
  if (!m) return null;
  const url = m[0].startsWith("http") ? m[0] : `https://${m[0]}`;
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "user-agent": SNAP_UA },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const fromUrl = parseSnapchatHandle(res.url || "");
    if (fromUrl) return fromUrl;
    // Some share links land on a page whose address is still the short code;
    // the page itself names the profile it belongs to.
    const html = await res.text().catch(() => "");
    const canon = html.match(/<link[^>]+rel="canonical"[^>]+href="([^"]+)"/i)?.[1] ?? html.match(/"username":"([A-Za-z0-9._-]+)"/)?.[1];
    return canon ? parseSnapchatHandle(canon) : null;
  } catch {
    return null;
  }
}

/**
 * Snapchat profile URL + username for anything a user might paste: a profile
 * URL, "@user", a bare username, or a share link (followed to the profile it
 * opens, and stored as that profile's URL). A share link that can't be
 * resolved right now keeps its URL with no handle, so the next sync retries.
 */
export async function resolveSnapchat(input: string | null | undefined): Promise<{ url: string | null; handle: string | null }> {
  const s = (input ?? "").trim();
  if (!s) return { url: null, handle: null };
  const isUrl = /snapchat\.com/i.test(s);
  const direct = parseSnapchatHandle(s);
  if (direct) return { url: isUrl ? s : `https://www.snapchat.com/add/${direct}`, handle: direct };
  if (isSnapchatShareLink(s)) {
    const handle = await followSnapchatShareLink(s);
    if (handle) return { url: `https://www.snapchat.com/@${handle}`, handle };
  }
  return { url: isUrl ? s : null, handle: null };
}

export function parseYouTubeHandle(input: string): string | null {
  return parseYouTube(input).handle;
}

// ---------- helpers ----------

function num(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? Number(n) : 0;
}

/** every defined string value among candidate paths (keeps order, dedupes) */
function pickAll(obj: any, paths: string[]): string[] {
  const out: string[] = [];
  for (const path of paths) {
    const v = pick(obj, [path]);
    if (typeof v === "string" && v && !out.includes(v)) out.push(v);
  }
  return out;
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
  // Each avatar field carries a url_list where index 0 is often HEIC and a
  // later entry is the JPEG fallback — collect them all, biggest size first.
  const avatarUrls = list.length
    ? pickAll(list[0], [
        "author.avatar_larger.url_list.0",
        "author.avatar_larger.url_list.1",
        "author.avatar_medium.url_list.0",
        "author.avatar_medium.url_list.1",
        "author.avatar_168x168.url_list.0",
        "author.avatar_168x168.url_list.1",
        "author.avatar_thumb.url_list.0",
        "author.avatar_thumb.url_list.1",
      ])
    : [];
  return { posts, userId, followers, avatarUrls, rawCount: list.length };
}

// ---------- Profiles (avatars) ----------

export interface ProfileResult {
  /** candidate picture URLs, best first (see FetchResult.avatarUrls) */
  avatarUrls: string[];
  followers: number | null;
  userId: string | null;
}

/**
 * Instagram profile — the reliable source for a creator's profile picture.
 * The posts endpoint doesn't always carry the user object, which is why
 * avatars came back empty; this endpoint always does.
 */
export async function fetchInstagramProfile(
  handle: string,
  apiKey: string
): Promise<ProfileResult> {
  const data = await scGet("/v1/instagram/profile", { handle }, apiKey);
  // Response nesting drifts between API versions (data.user vs data.data.user).
  const avatarUrls = pickAll(data, [
    "data.user.profile_pic_url_hd",
    "data.user.profile_pic_url",
    "data.data.user.profile_pic_url_hd",
    "data.data.user.profile_pic_url",
    "user.profile_pic_url_hd",
    "user.profile_pic_url",
    "profile_pic_url_hd",
    "profile_pic_url",
  ]);
  const followers =
    num(
      pick(data, [
        "data.user.edge_followed_by.count",
        "data.user.follower_count",
        "data.data.user.edge_followed_by.count",
        "user.edge_followed_by.count",
        "user.follower_count",
        "follower_count",
      ])
    ) || null;
  const userId =
    (pick(data, ["data.user.id", "data.user.pk", "data.data.user.id", "user.id", "user.pk"]) as string) ||
    null;
  return { avatarUrls, followers, userId: userId ? String(userId) : null };
}

/** TikTok profile — fallback avatar source for creators with no Instagram. */
export async function fetchTikTokProfile(
  handle: string,
  apiKey: string
): Promise<ProfileResult> {
  const data = await scGet("/v1/tiktok/profile", { handle }, apiKey);
  const avatarUrls = pickAll(data, [
    "user.avatarLarger",
    "user.avatarMedium",
    "user.avatarThumb",
    "user.avatar_larger.url_list.0",
    "user.avatar_larger.url_list.1",
    "user.avatar_medium.url_list.0",
    "user.avatar_medium.url_list.1",
    "user.avatar_thumb.url_list.0",
    "user.avatar_thumb.url_list.1",
    "data.user.avatarLarger",
    "data.user.avatarMedium",
    "avatarLarger",
  ]);
  const followers =
    num(
      pick(data, [
        "statsV2.followerCount",
        "stats.followerCount",
        "user.follower_count",
        "data.stats.followerCount",
      ])
    ) || null;
  const userId =
    (pick(data, ["user.id", "user.uid", "data.user.id"]) as string) || null;
  return { avatarUrls, followers, userId: userId ? String(userId) : null };
}

// ---------- YouTube (Shorts) ----------

/**
 * YouTube channel details — subscriber count, avatar, and the channel id we
 * cache so later calls skip handle resolution. Accepts any one identifier.
 */
export async function fetchYouTubeProfile(
  opts: { handle?: string | null; channelId?: string | null; url?: string | null },
  apiKey: string
): Promise<ProfileResult> {
  const params: Record<string, string> = {};
  if (opts.channelId) params.channelId = opts.channelId;
  else if (opts.handle) params.handle = opts.handle;
  else if (opts.url) params.url = opts.url;
  else throw new ScrapeCreatorsError("YouTube: need handle, channelId or url");
  const data = await scGet("/v1/youtube/channel", params, apiKey);

  // The avatar comes as an image object with several sizes; collect every
  // source, largest first. Fall back to plain URL fields if the shape drifts.
  const sources = (pick(data, ["avatar.image.sources", "avatar.sources", "avatar.thumbnails"]) as unknown) ?? [];
  const fromSources = Array.isArray(sources)
    ? (sources as any[])
        .map((x) => ({ url: x?.url, size: num(x?.width) }))
        .filter((x) => typeof x.url === "string" && x.url)
        .sort((a, b) => b.size - a.size)
        .map((x) => x.url as string)
    : [];
  const avatarUrls = [...new Set([...fromSources, ...pickAll(data, ["avatar.url", "avatar", "thumbnail"])])];
  const followers = num(pick(data, ["subscriberCount", "subscriber_count"])) || null;
  const channelId = (pick(data, ["channelId", "channel_id", "id"]) as string) || null;
  return { avatarUrls, followers, userId: channelId ? String(channelId) : null };
}

/** One Short's details — used to backfill a publish date the list omitted. */
async function fetchYouTubeVideoDate(url: string, apiKey: string): Promise<Date | null> {
  try {
    const data = await scGet("/v1/youtube/video", { url }, apiKey);
    return toDate(pick(data, ["publishDate", "publish_date", "uploadDate"]));
  } catch {
    return null;
  }
}

// Shorts the list endpoint didn't date get one details call each, capped so
// a brand-new channel with a huge backlog can't burn credits in one sync.
const YT_DATE_LOOKUP_CAP = 12;

export async function fetchYouTubeShorts(
  opts: { handle?: string | null; channelId?: string | null },
  apiKey: string
): Promise<FetchResult> {
  const params: Record<string, string> = { sort: "newest" };
  if (opts.channelId) params.channelId = opts.channelId;
  else if (opts.handle) params.handle = opts.handle;
  else throw new ScrapeCreatorsError("YouTube: need handle or channelId");

  const data = await scGet("/v1/youtube/channel/shorts", params, apiKey);
  const list: any[] = (pick(data, ["shorts", "data.shorts", "videos", "items"]) as any[]) ?? [];
  const posts: NormalizedPost[] = [];
  let lookups = 0;

  for (const it of Array.isArray(list) ? list : []) {
    const id = String(pick(it, ["id", "videoId", "video_id"]) ?? "");
    if (!id) continue;
    const url = (pick(it, ["url"]) as string) || `https://www.youtube.com/shorts/${id}`;
    let postedAt = toDate(pick(it, ["publishDate", "publishedTime", "publish_date", "publishedAt"]));
    if (!postedAt && lookups < YT_DATE_LOOKUP_CAP) {
      lookups++;
      postedAt = await fetchYouTubeVideoDate(url, apiKey);
    }
    if (!postedAt) continue;
    posts.push({
      platform: "youtube",
      platformPostId: id,
      url,
      caption: (pick(it, ["title"]) as string) ?? null,
      thumbnailUrl:
        (pick(it, ["thumbnail", "thumbnails.0.url", "thumbnail.url"]) as string) ??
        `https://i.ytimg.com/vi/${id}/oardefault.jpg`,
      postedAt,
      views: num(pick(it, ["viewCountInt", "viewCount", "views"])),
      likes: num(pick(it, ["likeCountInt", "likeCount", "likes"])),
      comments: num(pick(it, ["commentCountInt", "commentCount", "comments"])),
      shares: 0, // YouTube doesn't expose share counts
    });
  }
  return { posts, rawCount: Array.isArray(list) ? list.length : 0 };
}

// ---------- Threads ----------

export async function fetchThreadsProfile(handle: string, apiKey: string): Promise<ProfileResult> {
  const data = await scGet("/v1/threads/profile", { handle }, apiKey);
  const hd = (pick(data, ["hd_profile_pic_versions", "user.hd_profile_pic_versions"]) as unknown) ?? [];
  const fromHd = Array.isArray(hd)
    ? (hd as any[])
        .map((x) => ({ url: x?.url, size: num(x?.width) }))
        .filter((x) => typeof x.url === "string" && x.url)
        .sort((a, b) => b.size - a.size)
        .map((x) => x.url as string)
    : [];
  const avatarUrls = [...new Set([...fromHd, ...pickAll(data, ["profile_pic_url", "user.profile_pic_url"])])];
  const followers = num(pick(data, ["follower_count", "user.follower_count"])) || null;
  const userId = (pick(data, ["pk", "id", "user.pk", "user.id"]) as string) || null;
  return { avatarUrls, followers, userId: userId ? String(userId) : null };
}

/**
 * A creator's recent Threads posts. Threads only exposes the last ~20–30
 * posts and reports no view counts, so views stay 0 — cadence still works.
 */
export async function fetchThreads(opts: { handle: string }, apiKey: string): Promise<FetchResult> {
  const data = await scGet("/v1/threads/user/posts", { handle: opts.handle }, apiKey);
  const list: any[] = (pick(data, ["posts", "data.posts", "items", "data"]) as any[]) ?? [];
  const posts: NormalizedPost[] = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const it = raw?.post ?? raw?.node ?? raw;
    const code = pick(it, ["code"]) as string | undefined;
    // Keyed by shortcode — see canonicalPostKey for why not pk/id.
    const id = String(code || pick(it, ["pk", "id"]) || "");
    if (!id) continue;
    const postedAt = toDate(pick(it, ["taken_at", "taken_at_timestamp", "timestamp"]));
    if (!postedAt) continue;
    const user = (pick(it, ["user.username"]) as string) || opts.handle;
    const caption = pick(it, ["caption.text", "caption", "text_post_app_info.text", "text"]);
    const info = "text_post_app_info";
    posts.push({
      platform: "threads",
      platformPostId: id,
      url: (pick(it, ["url"]) as string) || (code ? `https://www.threads.com/@${user}/post/${code}` : null),
      caption: typeof caption === "string" ? caption : null,
      thumbnailUrl:
        (pick(it, [
          "image_versions2.candidates.0.url",
          "carousel_media.0.image_versions2.candidates.0.url",
          "video_versions.0.thumbnail_url",
        ]) as string) ?? null,
      postedAt,
      views: num(pick(it, ["view_count", "play_count", `${info}.view_count`, "video_view_count"])),
      likes: num(pick(it, ["like_count", `${info}.like_count`])),
      comments: num(pick(it, [`${info}.direct_reply_count`, "reply_count", "comment_count"])),
      shares: num(pick(it, [`${info}.repost_count`])) + num(pick(it, [`${info}.reshare_count`])),
    });
  }
  const avatarUrls = list.length ? pickAll(list[0], ["user.profile_pic_url", "post.user.profile_pic_url"]) : [];
  return { posts, avatarUrls, rawCount: Array.isArray(list) ? list.length : 0 };
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
    const code = pick(it, ["code", "shortcode"]) as string | undefined;
    // Keyed by shortcode: `pk` and `id` ("pk_ownerid") name the same post and
    // the API alternates between them, which used to store every reel twice.
    const id = String(code || pick(it, ["pk", "id"]) || "");
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
  const avatarUrls = pickAll(data, [
    "user.profile_pic_url_hd",
    "user.profile_pic_url",
    "data.user.profile_pic_url",
  ]);
  return { posts, followers, avatarUrls, rawCount: list.length };
}

// ---------- Facebook (Reels) ----------

/** Facebook page details — follower count + profile picture. */
export async function fetchFacebookProfile(url: string, apiKey: string): Promise<ProfileResult> {
  const data = await scGet("/v1/facebook/profile", { url }, apiKey);
  const avatarUrls = pickAll(data, ["profilePicLarge", "profilePicMedium", "profilePicSmall", "profile_pic_url"]);
  const followers = num(pick(data, ["followerCount", "follower_count"])) || num(pick(data, ["likeCount", "like_count"])) || null;
  const userId = (pick(data, ["id"]) as string) || null;
  return { avatarUrls, followers, userId: userId ? String(userId) : null };
}

/**
 * A page's Reels, newest first. The endpoint returns 10 per call with a
 * cursor, so `maxPages` bounds the credits one sync can spend: a creator's
 * first sync digs deeper for history, later syncs just refresh the newest.
 * Facebook only exposes a view count here — likes/comments/shares stay 0.
 */
export async function fetchFacebookReels(
  opts: { url: string; maxPages?: number },
  apiKey: string
): Promise<FetchResult> {
  const maxPages = Math.max(1, opts.maxPages ?? 2);
  const posts: NormalizedPost[] = [];
  const seen = new Set<string>();
  const avatarUrls: string[] = [];
  let rawCount = 0;
  let cursor: string | null = null;
  let nextPageId: string | null = null;

  for (let page = 0; page < maxPages; page++) {
    const params: Record<string, string> = { url: opts.url };
    if (cursor) params.cursor = cursor;
    if (nextPageId) params.next_page_id = nextPageId;
    const data = await scGet("/v1/facebook/profile/reels", params, apiKey);
    const list: any[] = (pick(data, ["reels", "data.reels", "items"]) as any[]) ?? [];
    if (!Array.isArray(list) || list.length === 0) break;
    rawCount += list.length;

    for (const it of list) {
      const videoId = pick(it, ["video_id", "post_id", "id"]) as string | undefined;
      const url = (pick(it, ["url"]) as string) || (videoId ? `https://www.facebook.com/reel/${videoId}` : null);
      const id = canonicalPostKey("facebook", url) || (videoId ? String(videoId) : "");
      if (!id || seen.has(id)) continue;
      const postedAt = toDate(pick(it, ["creation_time", "created_time", "publish_time"]));
      if (!postedAt) continue;
      seen.add(id);
      const caption = pick(it, ["description", "message", "text"]);
      posts.push({
        platform: "facebook",
        platformPostId: id,
        url,
        caption: typeof caption === "string" ? caption : null,
        thumbnailUrl: (pick(it, ["thumbnail", "thumbnail_url", "image"]) as string) ?? null,
        postedAt,
        views: num(pick(it, ["view_count", "play_count", "views"])),
        likes: num(pick(it, ["like_count", "reaction_count", "reactions"])),
        comments: num(pick(it, ["comment_count", "comments"])),
        shares: num(pick(it, ["share_count", "shares"])),
      });
      if (avatarUrls.length === 0) avatarUrls.push(...pickAll(it, ["author.image", "author.profile_pic_url"]));
    }

    cursor = (pick(data, ["cursor"]) as string) || null;
    nextPageId = (pick(data, ["next_page_id"]) as string) || null;
    if (!cursor && !nextPageId) break;
  }
  return { posts, avatarUrls, rawCount };
}

// ---------- Snapchat (Spotlight) ----------

/**
 * A creator's public Snapchat profile: their Spotlight videos with view
 * counts, plus subscriber count and profile picture — all from one call.
 * Snapchat exposes no like counts, so likes stay 0; the id that keys a
 * Spotlight is only present inside its deeplink, which is where the public
 * URL is rebuilt from.
 */
export async function fetchSnapchat(opts: { handle: string }, apiKey: string): Promise<FetchResult> {
  const data = await scGet("/v1/snapchat/profile", { handle: opts.handle }, apiKey);
  const raw = pick(data, ["spotlightStoryMetadata", "data.spotlightStoryMetadata", "spotlights"]);
  const list: unknown[] = Array.isArray(raw) ? raw : [];
  const posts: NormalizedPost[] = [];
  const seen = new Set<string>();
  const user = (pick(data, ["userProfile.username", "username"]) as string) || opts.handle;

  for (const it of list) {
    const vm = pick(it, ["videoMetadata"]) ?? it;
    const link =
      (pick(it, ["deeplink", "oneLinkParams.deepLinkUrl", "url", "shareUrl"]) as string) ??
      (pick(vm, ["url", "shareUrl"]) as string);
    const id =
      canonicalPostKey("snapchat", link) ||
      String(pick(it, ["snapId", "storyId.value", "storyId", "id"]) ?? pick(vm, ["snapId", "storyId", "id"]) ?? "");
    if (!id || seen.has(id)) continue;
    const postedAt = toDate(pick(vm, ["uploadDateMs", "uploadDate", "createdAtMs", "timestampMs"]) ?? pick(it, ["uploadDateMs", "timestampInSec.value"]));
    if (!postedAt) continue;
    seen.add(id);
    // The title is the creator's own text when they gave one; untitled snaps
    // come back as "Spotlight Snap" and `description` is usually Snapchat's
    // share blurb ("Another Spotlight Snap brought to you by @…"). Neither
    // placeholder is a caption — better no caption than a fake one.
    const caption =
      [pick(vm, ["name", "title"]), pick(vm, ["embeddedTextCaption"]), pick(vm, ["description"]), pick(it, ["description"])]
        .map((v) => (typeof v === "string" ? v.trim() : ""))
        .find((v) => v && !/^spotlight snap$/i.test(v) && !/^another spotlight snap brought to you by/i.test(v)) ?? null;
    posts.push({
      platform: "snapchat",
      platformPostId: id,
      url: `https://www.snapchat.com/@${user}/spotlight/${id}`,
      caption,
      thumbnailUrl: (pick(vm, ["thumbnailUrl", "thumbnail", "posterUrl"]) as string) ?? null,
      postedAt,
      views: num(pick(vm, ["viewCount", "views"])) || num(pick(it, ["engagementStats.viewCount"])),
      likes: num(pick(it, ["engagementStats.likeCount"])) || num(pick(vm, ["likeCount"])),
      comments: num(pick(it, ["engagementStats.commentCount"])) || num(pick(vm, ["commentCount"])),
      shares: num(pick(it, ["engagementStats.shareCount"])) || num(pick(vm, ["shareCount"])),
    });
  }
  const followers = num(pick(data, ["userProfile.subscriberCount", "subscriberCount", "userProfile.followerCount"])) || null;
  const avatarUrls = pickAll(data, ["userProfile.profilePictureUrl", "userProfile.squareHeroImageUrl", "profilePictureUrl"]);
  return { posts, followers, avatarUrls, rawCount: list.length };
}
