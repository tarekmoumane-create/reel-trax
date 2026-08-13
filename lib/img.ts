// Remote images we can't hotlink directly.
//
// TikTok and Instagram serve profile pictures and thumbnails from signed CDN
// URLs that refuse requests without the right Referer (and expire after a few
// days). Pointing an <img> straight at them yields a broken image, which is why
// avatars fell back to initials. We fetch those hosts server-side through
// /api/img instead, which sets the headers the CDN expects and caches the bytes.
//
// The list doubles as the SSRF allowlist for the proxy route — never widen it
// to "any host".

const PROXY_HOST_SUFFIXES = [
  // TikTok
  "tiktokcdn.com",
  "tiktokcdn-us.com",
  "tiktokcdn-eu.com",
  "tiktokv.com",
  "ibyteimg.com",
  "byteimg.com",
  "muscdn.com",
  // Instagram / Meta
  "cdninstagram.com",
  "fbcdn.net",
  // logo sources
  "icons.duckduckgo.com",
  "img.logo.dev",
];

/** Is this a host whose images we must fetch server-side? */
export function needsProxy(rawUrl: string): boolean {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  const host = u.hostname.toLowerCase();
  if (host === "www.google.com") return u.pathname.startsWith("/s2/favicons");
  return PROXY_HOST_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`));
}

/**
 * Browser-safe src for a remote image: proxied when the origin blocks
 * hotlinking, left alone otherwise (relative URLs, our own /api/logo, or a
 * plain image URL someone pasted in).
 */
export function imgSrc(url: string | null | undefined): string | null {
  if (!url) return null;
  const s = url.trim();
  if (!s) return null;
  if (s.startsWith("/") || s.startsWith("data:")) return s;
  return needsProxy(s) ? `/api/img?u=${encodeURIComponent(s)}` : s;
}

/** Referer the CDN wants to see, so it doesn't 403 us. */
export function refererFor(host: string): string | undefined {
  const h = host.toLowerCase();
  if (h.includes("cdninstagram") || h.includes("fbcdn")) return "https://www.instagram.com/";
  if (h.includes("tiktok") || h.includes("byteimg") || h.includes("muscdn")) return "https://www.tiktok.com/";
  return undefined;
}
