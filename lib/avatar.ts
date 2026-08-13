import { refererFor } from "./img";

// Server-side download of a profile picture so we can keep our own copy.
// Platform CDN URLs are signed and expire, so storing the URL alone means the
// avatar quietly breaks a few days later; storing the bytes means it never does.

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

/** Profile pictures are small; anything larger is not a photo we want. */
const MAX_BYTES = 2_000_000;

// Formats browsers can actually render. TikTok's CDN loves to hand out HEIC,
// which decodes nowhere outside Safari — storing one paints a blank circle in
// Chrome, so a HEIC download counts as a failure and we try the next candidate.
const WEB_SAFE = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);

export function isWebSafeMime(mime: string | null | undefined): boolean {
  return !!mime && WEB_SAFE.has(mime.split(";")[0].trim().toLowerCase());
}

/** Order candidate URLs so likely-renderable formats download first. */
export function preferWebSafe(urls: (string | null | undefined)[]): string[] {
  const list = [...new Set(urls.filter((u): u is string => !!u))];
  const score = (u: string) => (/\.hei[cf](\?|$)/i.test(u) ? 1 : /\.(jpe?g|png|webp)(\?|$)/i.test(u) ? -1 : 0);
  return list.sort((a, b) => score(a) - score(b));
}

export interface StoredImage {
  /** Backed by a plain ArrayBuffer, which is what Prisma's Bytes column takes. */
  data: Uint8Array<ArrayBuffer>;
  mime: string;
}

export async function downloadImage(url: string): Promise<StoredImage | null> {
  try {
    const referer = refererFor(new URL(url).hostname);
    const res = await fetch(url, {
      headers: {
        "user-agent": UA,
        accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        ...(referer ? { referer, origin: referer.replace(/\/$/, "") } : {}),
      },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
      redirect: "follow",
    });

    const mime = res.headers.get("content-type") ?? "";
    if (!res.ok || !isWebSafeMime(mime)) return null;

    const buf = await res.arrayBuffer();
    if (!buf.byteLength || buf.byteLength > MAX_BYTES) return null;

    return { data: new Uint8Array(buf), mime: mime.split(";")[0].trim() };
  } catch {
    return null;
  }
}

/** First candidate that downloads as a browser-renderable image wins. */
export async function downloadFirstWebSafe(
  urls: (string | null | undefined)[]
): Promise<{ url: string; image: StoredImage } | null> {
  for (const url of preferWebSafe(urls)) {
    const image = await downloadImage(url);
    if (image) return { url, image };
  }
  return null;
}
