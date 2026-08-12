"use client";

import { useState } from "react";
import { initials } from "@/lib/ui";

// Creator avatar: shows the synced profile picture, falls back to initials when
// there's no image or the CDN blocks hotlinking.
export function Avatar({
  name,
  src,
  size = 36,
  rounded = "9999px",
  className = "",
}: {
  name: string;
  src?: string | null;
  size?: number;
  rounded?: string;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  const show = src && !broken;
  return (
    <span
      className={`grid shrink-0 place-items-center overflow-hidden bg-[var(--panel2)] text-[var(--muted)] ${className}`}
      style={{ width: size, height: size, borderRadius: rounded, fontSize: Math.round(size * 0.36), fontWeight: 600 }}
    >
      {show ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src!}
          alt=""
          referrerPolicy="no-referrer"
          loading="lazy"
          onError={() => setBroken(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        initials(name)
      )}
    </span>
  );
}
