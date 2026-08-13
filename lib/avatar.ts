import { refererFor } from "./img";

// Server-side download of a profile picture so we can keep our own copy.
// Platform CDN URLs are signed and expire, so storing the URL alone means the
// avatar quietly breaks a few days later; storing the bytes means it never does.

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

/** Profile pictures are small; anything larger is not a photo we want. */
const MAX_BYTES = 2_000_000;

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
    if (!res.ok || !mime.startsWith("image/")) return null;

    const buf = await res.arrayBuffer();
    if (!buf.byteLength || buf.byteLength > MAX_BYTES) return null;

    return { data: new Uint8Array(buf), mime: mime.split(";")[0].trim() };
  } catch {
    return null;
  }
}
