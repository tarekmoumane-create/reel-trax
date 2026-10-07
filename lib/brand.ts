// Brand logos for clients.
//
// These used to point at logo.clearbit.com, whose free Logo API was retired —
// the host no longer resolves, so every client logo rendered as a broken image
// and fell back to initials. We now serve them from /api/logo, which resolves
// a real icon server-side (with fallbacks) and can be re-pointed at a different
// provider later without touching stored data.

export function hostOf(url: string): string | null {
  try {
    const u = new URL(/:\/\//.test(url) ? url : `https://${url}`);
    const h = u.hostname.replace(/^www\./, "").toLowerCase();
    return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(h) ? h : null;
  } catch {
    return null;
  }
}

/** Our own logo endpoint for a website — stored on the client row. */
export function logoFromWebsite(website: string): string | null {
  const h = hostOf(website);
  return h ? `/api/logo?domain=${encodeURIComponent(h)}` : null;
}

/** Logo URLs from the dead Clearbit API, so we can heal old rows on read. */
export function isDeadLogoUrl(url: string | null | undefined): boolean {
  return !!url && url.includes("logo.clearbit.com");
}

/**
 * The numeric Apple ID of an app, from whatever got pasted: the id itself, or
 * an App Store link like apps.apple.com/us/app/name/id1234567890. Null when
 * there's no number in it.
 */
export function cleanAppleAppId(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const m = s.match(/\bid(\d{6,})\b/) ?? s.match(/^(\d{6,})$/);
  return m ? m[1] : null;
}
