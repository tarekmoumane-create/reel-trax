"use client";

import { useEffect, useRef, useState } from "react";
import { PAY_COMPONENTS, paySummary, type PayComponent, type PayExclusion } from "@/lib/payouts";

export { paySummary };

// Per-video pay controls, shared by the Videos page and a creator's post list.
// One menu answers "what does this video earn?": rule-based (with per-
// component opt-outs), a warm-up post (no view-based pay), a hand-set price,
// or nothing at all.

export interface VideoPay {
  exclusions: PayExclusion[];
  isWarmUp: boolean;
  payOverride: number | null;
}

export type VideoPayPatch = Partial<{ payExclusions: PayExclusion[]; isWarmUp: boolean; payOverride: number | null }>;

const COMPONENT_LABEL: Record<PayComponent, string> = {
  perPost: "Per-post fee",
  cpm: "CPM / view pay",
  tiers: "View bonuses",
};

export function VideoPayMenu({
  value,
  currency = "USD",
  onChange,
  align = "right",
}: {
  value: VideoPay;
  currency?: string;
  onChange: (patch: VideoPayPatch) => void;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const [dropUp, setDropUp] = useState(false);
  const [price, setPrice] = useState(value.payOverride == null ? "" : String(value.payOverride));
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  // Rows near the bottom of a list open upward instead of running off-page.
  function toggle() {
    const box = ref.current?.getBoundingClientRect();
    if (box) setDropUp(window.innerHeight - box.bottom < 330 && box.top > 330);
    // Re-seed the price field from the saved value each time the menu opens.
    if (!open) setPrice(value.payOverride == null ? "" : String(value.payOverride));
    setOpen((o) => !o);
  }

  const all = value.exclusions.includes("all");
  const fixed = value.payOverride != null;
  const { label, tone } = paySummary(value, currency);

  // Warm-up folds CPM + bonuses out; the checkboxes reflect that.
  const countsFor = (c: PayComponent) =>
    !all && !fixed && !value.exclusions.includes(c) && !(value.isWarmUp && (c === "cpm" || c === "tiers"));

  function toggleComponent(c: PayComponent) {
    const cur = value.exclusions.filter((e) => e !== "all");
    // Un-checking a view component on a warm-up video keeps it off; checking it
    // back on is only possible once the warm-up flag is cleared.
    onChange({ payExclusions: cur.includes(c) ? cur.filter((e) => e !== c) : [...cur, c] });
  }
  function setFixed() {
    const n = Number(price);
    if (price.trim() === "" || !Number.isFinite(n) || n < 0) return;
    onChange({ payOverride: Math.round(n * 100) / 100, payExclusions: value.exclusions.filter((e) => e !== "all") });
  }

  const row = "flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs hover:bg-[var(--panel2)] disabled:opacity-40";
  const check = (on: boolean) => (
    <span className={`grid h-4 w-4 shrink-0 place-items-center rounded border ${on ? "border-[var(--signal)] bg-[var(--signal)] text-white" : "border-[var(--line)]"}`}>
      {on && <svg width="10" height="10" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>}
    </span>
  );

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={toggle}
        title="What this video earns"
        className={`inline-flex w-full items-center justify-between gap-1.5 rounded-lg border px-2 py-1 text-[12.5px] font-medium hover:border-[var(--signal)] ${open ? "border-[var(--signal)]" : "border-[var(--line)]"} ${tone}`}
      >
        <span className="truncate">{label}</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" className="shrink-0 text-[var(--faint)]">
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className={`absolute z-40 w-60 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--panel)] py-1 shadow-2xl ${align === "right" ? "right-0" : "left-0"} ${dropUp ? "bottom-full mb-1.5" : "top-full mt-1.5"}`}>
          {/* warm-up */}
          <button
            disabled={all || fixed}
            onClick={() => onChange({ isWarmUp: !value.isWarmUp })}
            className={`${row} py-2`}
          >
            <span>
              <span className="block font-medium">Warm-up post</span>
              <span className="block text-[11.5px] text-[var(--faint)]">No CPM or view bonuses</span>
            </span>
            {check(value.isWarmUp && !all && !fixed)}
          </button>

          <div className="mt-1 border-t border-[var(--line2)] px-3 pb-0.5 pt-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-[var(--faint)]">Counts toward</div>
          {PAY_COMPONENTS.map((c) => {
            const lockedByWarmUp = value.isWarmUp && (c === "cpm" || c === "tiers");
            return (
              <button key={c} disabled={all || fixed || lockedByWarmUp} onClick={() => toggleComponent(c)} className={row}>
                {COMPONENT_LABEL[c]}
                {check(countsFor(c))}
              </button>
            );
          })}

          {/* fixed price */}
          <div className="mt-1 border-t border-[var(--line2)] px-3 pb-1 pt-1.5">
            <div className="text-[11.5px] font-semibold uppercase tracking-wide text-[var(--faint)]">Custom price</div>
            <div className="mt-1 flex items-center gap-1.5">
              <span className="mono text-xs text-[var(--faint)]">$</span>
              <input
                type="number"
                min={0}
                step="0.01"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") setFixed(); }}
                placeholder="e.g. 25"
                className="mono min-w-0 flex-1 px-2 py-1 text-xs"
              />
              <button onClick={setFixed} className="btn px-2 py-1 text-[12.5px]">Set</button>
            </div>
            <p className="mt-1 text-[11.5px] leading-snug text-[var(--faint)]">
              {fixed ? "Pays exactly this — the rules above are ignored." : "Pay a fixed amount for this video instead of the rules."}
            </p>
            {fixed && (
              <button onClick={() => onChange({ payOverride: null })} className="mt-1 text-[12.5px] text-[var(--muted)] hover:text-[var(--ink)]">Remove custom price</button>
            )}
          </div>

          <div className="mt-1 border-t border-[var(--line2)] p-1">
            <button
              onClick={() => { onChange(all ? { payExclusions: [] } : { payExclusions: ["all"], payOverride: null }); setOpen(false); }}
              className={`w-full rounded-lg px-2 py-1.5 text-left text-xs font-medium ${all ? "text-[var(--ok)] hover:bg-[var(--panel2)]" : "text-[var(--bad)] hover:bg-[color:rgba(242,104,95,0.1)]"}`}
            >
              {all ? "Include in pay again" : "Exclude from all pay"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
