// Resolves a brand logo for a domain and streams the image back.
//
// Providers are tried in quality order and the first real image wins, so one
// dead provider (see: Clearbit) can't take the feature down again.

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

function sources(domain: string): string[] {
  return [
    `https://icons.duckduckgo.com/ip3/${domain}.ico`,
    `https://${domain}/apple-touch-icon.png`,
    `https://www.google.com/s2/favicons?domain=${domain}&sz=128`,
  ];
}

export async function GET(request: Request) {
  const domain = (new URL(request.url).searchParams.get("domain") ?? "")
    .trim()
    .toLowerCase()
    .replace(/^www\./, "");
  if (!DOMAIN_RE.test(domain)) return new Response(null, { status: 400 });

  for (const url of sources(domain)) {
    try {
      const res = await fetch(url, {
        headers: { "user-agent": UA, accept: "image/*,*/*;q=0.8" },
        signal: AbortSignal.timeout(6_000),
        redirect: "follow",
        cache: "no-store",
      });
      const type = res.headers.get("content-type") ?? "";
      if (!res.ok || !type.startsWith("image/")) continue;

      const buf = await res.arrayBuffer();
      // Providers answer "no logo" with a tiny placeholder — skip those and let
      // the next source (or the initials fallback) have a go.
      if (buf.byteLength < 120) continue;

      return new Response(buf, {
        headers: {
          "content-type": type,
          "cache-control": "public, max-age=604800, s-maxage=2592000, stale-while-revalidate=2592000",
          "x-content-type-options": "nosniff",
          "x-logo-source": new URL(url).hostname,
        },
      });
    } catch {
      // try the next provider
    }
  }

  // Nothing found — 404 so ClientLogo falls back to the colored initials tile.
  return new Response(null, { status: 404 });
}
