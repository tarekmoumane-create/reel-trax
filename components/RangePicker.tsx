"use client";

import { useEffect, useRef, useState } from "react";

// ---------- time ranges (viral-style presets + custom) ----------

export interface Range { from: string; to: string; label: string }

export function dstr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

export const PRESETS: { key: string; label: string; range: () => Range }[] = [
  { key: "today", label: "Today", range: () => ({ from: dstr(new Date()), to: dstr(new Date()), label: "Today" }) },
  { key: "yesterday", label: "Yesterday", range: () => ({ from: dstr(daysAgo(1)), to: dstr(daysAgo(1)), label: "Yesterday" }) },
  { key: "7d", label: "Last 7 days", range: () => ({ from: dstr(daysAgo(6)), to: dstr(new Date()), label: "Last 7 days" }) },
  { key: "14d", label: "Last 14 days", range: () => ({ from: dstr(daysAgo(13)), to: dstr(new Date()), label: "Last 14 days" }) },
  { key: "30d", label: "Last 30 days", range: () => ({ from: dstr(daysAgo(29)), to: dstr(new Date()), label: "Last 30 days" }) },
  { key: "90d", label: "Last 90 days", range: () => ({ from: dstr(daysAgo(89)), to: dstr(new Date()), label: "Last 90 days" }) },
  {
    key: "mtd", label: "Month to date",
    range: () => { const n = new Date(); return { from: dstr(new Date(n.getFullYear(), n.getMonth(), 1)), to: dstr(n), label: "Month to date" }; },
  },
  {
    key: "lastmonth", label: "Last month",
    range: () => { const n = new Date(); return { from: dstr(new Date(n.getFullYear(), n.getMonth() - 1, 1)), to: dstr(new Date(n.getFullYear(), n.getMonth(), 0)), label: "Last month" }; },
  },
  {
    key: "ytd", label: "Year to date",
    range: () => { const n = new Date(); return { from: dstr(new Date(n.getFullYear(), 0, 1)), to: dstr(n), label: "Year to date" }; },
  },
];

export const fmtRangeDate = (d: string) => {
  const [, m, day] = d.split("-").map(Number);
  return new Date(2000, m - 1, day).toLocaleDateString("en", { month: "short", day: "numeric" });
};

/**
 * `onAllTime` adds an "All time" entry above the fixed presets. The range it
 * covers depends on the data being shown, so the caller resolves it rather
 * than the picker computing a date.
 */
export function RangePicker({ range, onChange, onAllTime, allTimeActive, leading }: {
  range: Range;
  onChange: (r: Range, presetKey?: string) => void;
  onAllTime?: () => void;
  allTimeActive?: boolean;
  /** Caller-resolved entries listed first, e.g. "Since last payment". */
  leading?: { label: string; active: boolean; onPick: () => void }[];
}) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onDoc(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  useEffect(() => { setFrom(range.from); setTo(range.to); }, [range.from, range.to]);

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="btn px-2.5 py-1 text-xs">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
        {range.label}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-1.5 flex w-[290px] overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--panel)] shadow-2xl">
          {/* presets */}
          <div className="max-h-72 w-1/2 overflow-y-auto border-r border-[var(--line2)] py-1">
            {leading?.map((l) => (
              <button
                key={l.label}
                onClick={() => { l.onPick(); setOpen(false); }}
                className={`block w-full px-3 py-1.5 text-left text-xs hover:bg-[var(--panel2)] ${l.active ? "bg-[var(--panel2)] font-semibold" : ""}`}
              >{l.label}</button>
            ))}
            {onAllTime && (
              <button
                onClick={() => { onAllTime(); setOpen(false); }}
                className={`block w-full border-b border-[var(--line2)] px-3 py-1.5 text-left text-xs hover:bg-[var(--panel2)] ${allTimeActive ? "bg-[var(--panel2)] font-semibold" : ""}`}
              >All time</button>
            )}
            {PRESETS.map((p) => (
              <button
                key={p.key}
                onClick={() => { onChange(p.range(), p.key); setOpen(false); }}
                className={`block w-full px-3 py-1.5 text-left text-xs hover:bg-[var(--panel2)] ${range.label === p.label ? "bg-[var(--panel2)] font-semibold" : ""}`}
              >{p.label}</button>
            ))}
          </div>
          {/* custom */}
          <div className="w-1/2 space-y-2 p-2.5">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--faint)]">Custom</div>
            <label className="block text-[10px] text-[var(--muted)]">From
              <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="mt-0.5 w-full px-2 py-1 text-xs" />
            </label>
            <label className="block text-[10px] text-[var(--muted)]">To
              <input type="date" value={to} min={from} max={dstr(new Date())} onChange={(e) => setTo(e.target.value)} className="mt-0.5 w-full px-2 py-1 text-xs" />
            </label>
            <button
              onClick={() => {
                if (!from || !to || from > to) return;
                onChange({ from, to, label: `${fmtRangeDate(from)} – ${fmtRangeDate(to)}` });
                setOpen(false);
              }}
              className="btn btn-primary w-full justify-center py-1 text-xs"
            >Apply</button>
          </div>
        </div>
      )}
    </div>
  );
}
