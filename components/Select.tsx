"use client";

import { useEffect, useRef, useState } from "react";

// Custom dropdowns that flow with the app's design instead of the OS-native
// <select> menu. Same tokens as every other control: --panel, --line, --ink.

export interface SelectOption {
  value: string;
  label: string;
}

function useOutsideClose(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return ref;
}

function Chevron() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" className="shrink-0 text-[var(--faint)]">
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Check() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className="shrink-0 text-[var(--signal)]">
      <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Select({
  value,
  onChange,
  options,
  size = "md",
  align = "left",
  className = "",
  buttonClassName = "",
}: {
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[] | [string, string][];
  size?: "sm" | "md";
  align?: "left" | "right";
  className?: string;
  buttonClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useOutsideClose(() => setOpen(false));
  const opts: SelectOption[] = options.map((o) =>
    Array.isArray(o) ? { value: o[0], label: o[1] } : o
  );
  const current = opts.find((o) => o.value === value);

  function onButtonKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const i = opts.findIndex((o) => o.value === value);
      const next = opts[(i + (e.key === "ArrowDown" ? 1 : opts.length - 1)) % opts.length];
      if (next) onChange(next.value);
    }
  }

  const pad = size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-2 text-sm";

  return (
    <div className={`relative inline-block ${className}`} ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onButtonKey}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`inline-flex w-full items-center justify-between gap-2 rounded-lg border bg-[var(--panel)] font-medium text-[var(--ink)] hover:border-[var(--signal)] ${
          open ? "border-[var(--signal)]" : "border-[var(--line)]"
        } ${pad} ${buttonClassName}`}
      >
        <span className="truncate">{current?.label ?? value}</span>
        <Chevron />
      </button>
      {open && (
        <div
          role="listbox"
          className={`absolute z-50 mt-1.5 min-w-full overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--panel)] py-1 shadow-2xl ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {opts.map((o) => {
            const active = o.value === value;
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between gap-3 whitespace-nowrap px-3 py-1.5 text-left ${
                  size === "sm" ? "text-xs" : "text-sm"
                } ${active ? "bg-[var(--panel2)] font-semibold" : "hover:bg-[var(--panel2)]"}`}
              >
                {o.label}
                {active && <Check />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Leaderboard "top N" picker: quick presets plus a free-form number, clamped
 * to [1, max]. "All" is whatever max currently is.
 */
export function CountPicker({
  value,
  onChange,
  max,
  presets = [5, 10, 25],
}: {
  value: number;
  onChange: (n: number) => void;
  max: number;
  presets?: number[];
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const ref = useOutsideClose(() => setOpen(false));
  const cap = Math.max(1, max);
  const usable = presets.filter((p) => p < cap);
  const shown = Math.min(value, cap);

  function commitDraft() {
    const n = Number(draft);
    if (Number.isFinite(n) && n >= 1) {
      onChange(Math.min(Math.round(n), cap));
      setDraft("");
      setOpen(false);
    }
  }

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`inline-flex items-center gap-1.5 rounded-lg border bg-[var(--panel)] px-2.5 py-1 text-xs font-medium text-[var(--ink)] hover:border-[var(--signal)] ${
          open ? "border-[var(--signal)]" : "border-[var(--line)]"
        }`}
      >
        Top {shown}
        <Chevron />
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-1.5 w-32 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--panel)] py-1 shadow-2xl">
          {usable.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => {
                onChange(p);
                setOpen(false);
              }}
              className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-xs ${
                shown === p ? "bg-[var(--panel2)] font-semibold" : "hover:bg-[var(--panel2)]"
              }`}
            >
              Top {p}
              {shown === p && <Check />}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              onChange(cap);
              setOpen(false);
            }}
            className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-xs ${
              shown === cap ? "bg-[var(--panel2)] font-semibold" : "hover:bg-[var(--panel2)]"
            }`}
          >
            All ({cap})
            {shown === cap && <Check />}
          </button>
          <div className="border-t border-[var(--line2)] p-1.5">
            <input
              type="number"
              min={1}
              max={cap}
              value={draft}
              placeholder="Custom…"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && commitDraft()}
              onBlur={() => draft && commitDraft()}
              className="w-full rounded-md px-2 py-1 text-xs"
            />
          </div>
        </div>
      )}
    </div>
  );
}
