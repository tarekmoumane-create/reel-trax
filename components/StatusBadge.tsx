"use client";

import type { CadenceStatus } from "@/lib/cadence";
import { STATUS_STYLE } from "@/lib/ui";

export function StatusBadge({ status }: { status: CadenceStatus }) {
  const s = STATUS_STYLE[status];
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium"
      style={{ color: s.text, background: s.bg }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: s.dot }}
      />
      {s.label}
    </span>
  );
}
