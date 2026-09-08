"use client";

import { useState } from "react";
import { imgSrc } from "@/lib/img";

// Small portrait thumbnail for a short-form post. Clicking opens the post in a
// new tab. Falls back to a platform-tinted placeholder when there's no image
// yet (e.g. before the first sync, or if the CDN blocks hotlinking).
export function VideoThumb({
  url,
  thumbnailUrl,
  platform,
  w = 40,
  h = 56,
  asLink = true,
}: {
  url: string | null;
  thumbnailUrl: string | null;
  platform: string;
  w?: number;
  h?: number;
  asLink?: boolean;
}) {
  const [broken, setBroken] = useState(false);
  const isTT = platform === "tiktok";
  const isYT = platform === "youtube";
  const badge = isTT ? "TT" : isYT ? "YT" : "IG";
  const tint = isTT ? "var(--chip-tt)" : isYT ? "rgba(224,60,60,0.12)" : "rgba(214,67,143,0.12)";
  const tintInk = isTT ? "var(--muted)" : isYT ? "var(--yt)" : "var(--ig)";
  const thumb = imgSrc(thumbnailUrl);
  const showImg = thumb && !broken;

  const inner = (
    <div
      className="group relative shrink-0 overflow-hidden rounded-md border border-[var(--line)] bg-[var(--panel2)]"
      style={{ width: w, height: h }}
    >
      {showImg ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={thumb!}
          alt=""
          referrerPolicy="no-referrer"
          loading="lazy"
          onError={() => setBroken(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="grid h-full w-full place-items-center" style={{ background: tint }}>
          <span className="mono text-[10px] font-bold" style={{ color: tintInk }}>{badge}</span>
        </div>
      )}
      {/* platform badge + play hint */}
      <span className="mono absolute left-1 top-1 rounded bg-black/55 px-1 text-[8px] font-bold text-white">{badge}</span>
      {url && (
        <span className="absolute inset-0 grid place-items-center bg-black/0 opacity-0 transition group-hover:bg-black/35 group-hover:opacity-100">
          <svg width={Math.round(w * 0.4)} height={Math.round(w * 0.4)} viewBox="0 0 24 24" fill="white">
            <path d="M8 5v14l11-7z" />
          </svg>
        </span>
      )}
    </div>
  );

  if (asLink && url) {
    return (
      <a href={url} target="_blank" rel="noreferrer" title="Open video in new tab">
        {inner}
      </a>
    );
  }
  return inner;
}
