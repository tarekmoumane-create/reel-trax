"use client";

import { useState } from "react";
import { initials } from "@/lib/ui";
import { imgSrc } from "@/lib/img";

// Creator avatar. Pass `creatorId` and it serves our own stored copy of the
// picture, which never expires; `src` covers anything else (and gets proxied
// when the origin blocks hotlinking). Falls back to initials either way.
export function Avatar({
  name,
  creatorId,
  src,
  size = 36,
  rounded = "9999px",
  className = "",
}: {
  name: string;
  creatorId?: string;
  src?: string | null;
  size?: number;
  rounded?: string;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  // v2: bust browser caches that hold the unrenderable HEIC responses v1 served
  const resolved = creatorId ? `/api/creators/${creatorId}/avatar?v=2` : imgSrc(src);
  const show = resolved && !broken;
  return (
    <span
      className={`grid shrink-0 place-items-center overflow-hidden bg-[var(--panel2)] text-[var(--muted)] ${className}`}
      style={{ width: size, height: size, borderRadius: rounded, fontSize: Math.round(size * 0.36), fontWeight: 600 }}
    >
      {show ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={resolved!}
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
