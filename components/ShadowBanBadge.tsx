"use client";

import type { ShadowBanFlag } from "@/lib/shadowban";
import { SHADOW_BAN_RULE } from "@/lib/shadowban";

const PLATFORM_LABEL: Record<string, string> = { tiktok: "TikTok", instagram: "Instagram", youtube: "YouTube", threads: "Threads", facebook: "Facebook" };

export function describeShadowBans(flags: ShadowBanFlag[]): string {
  return flags
    .map((f) => `${PLATFORM_LABEL[f.platform] ?? f.platform}: under 10 views on ${f.days} posting days in a row (${f.posts} post${f.posts === 1 ? "" : "s"})`)
    .join(" · ");
}

/**
 * "Shadow ban?" pill. Renders nothing when there's nothing to flag, so it can
 * sit next to any status badge unconditionally.
 */
export function ShadowBanBadge({ flags, compact = false }: { flags: ShadowBanFlag[] | undefined; compact?: boolean }) {
  if (!flags?.length) return null;
  const platforms = flags.map((f) => PLATFORM_LABEL[f.platform] ?? f.platform);
  return (
    <span
      title={`${describeShadowBans(flags)}. Rule: ${SHADOW_BAN_RULE}.`}
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium"
      style={{ color: "var(--bad)", background: "color-mix(in srgb, var(--bad) 15%, transparent)" }}
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 3l18 18" /><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" /><path d="M9.9 5.1A10.4 10.4 0 0 1 12 5c5 0 9 4 10 7a11.6 11.6 0 0 1-2.2 3.4M6.2 6.2C4 7.6 2.6 9.6 2 12c1 3 5 7 10 7 1.5 0 2.9-.3 4.1-.9" />
      </svg>
      Shadow ban?{!compact && platforms.length ? <span className="font-normal opacity-80">· {platforms.join(", ")}</span> : null}
    </span>
  );
}
