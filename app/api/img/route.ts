import { needsProxy, refererFor } from "@/lib/img";

// Image proxy for CDNs that block hotlinking (TikTok / Instagram profile
// pictures and thumbnails). Only hosts on the allowlist in lib/img.ts are
// fetchable — this route must never become an open forwarder.
//
// A failure returns 404 with no body so the <img> onError handler fires and the
// component falls back to initials.

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("u");
  if (!raw || !needsProxy(raw)) return new Response(null, { status: 400 });

  const target = new URL(raw);
  const referer = refererFor(target.hostname);

  try {
    const res = await fetch(target, {
      headers: {
        "user-agent": UA,
        accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        ...(referer ? { referer, origin: referer.replace(/\/$/, "") } : {}),
      },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
      redirect: "follow",
    });

    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !type.startsWith("image/")) return new Response(null, { status: 404 });

    return new Response(res.body, {
      headers: {
        "content-type": type,
        // These URLs are content-addressed and short-lived upstream; caching a
        // day in the browser and a week at the edge keeps rosters instant.
        "cache-control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
