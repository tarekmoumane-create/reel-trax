"use client";

import { useState } from "react";
import { initials } from "@/lib/ui";
import { imgSrc } from "@/lib/img";

// Client avatar: shows the brand logo (from their website / uploaded URL),
// falling back to a colored square with initials.
export function ClientLogo({
  name,
  logoUrl,
  color,
  size = 32,
  radius = 9,
}: {
  name: string;
  logoUrl?: string | null;
  color?: string | null;
  size?: number;
  radius?: number;
}) {
  const [broken, setBroken] = useState(false);
  const src = imgSrc(logoUrl);
  if (src && !broken) {
    return (
      <span
        className="grid shrink-0 place-items-center overflow-hidden border border-[var(--line)] bg-[var(--logo-tile)] p-[2px]"
        style={{ width: size, height: size, borderRadius: radius }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt=""
          referrerPolicy="no-referrer"
          loading="lazy"
          onError={() => setBroken(true)}
          className="h-full w-full object-contain"
        />
      </span>
    );
  }
  return (
    <span
      className="grid shrink-0 place-items-center font-bold text-white"
      style={{ width: size, height: size, borderRadius: radius, background: color || "#ec5a35", fontSize: Math.round(size * 0.36) }}
    >
      {initials(name)}
    </span>
  );
}
