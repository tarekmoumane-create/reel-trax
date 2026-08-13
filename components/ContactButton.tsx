"use client";

import { useEffect, useRef, useState } from "react";
import { contactLinks, type ContactCreator } from "@/lib/contact";
import { timeAgo } from "@/lib/ui";

const ICONS: Record<string, React.ReactNode> = {
  imessage: <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7A8.5 8.5 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z" />,
  whatsapp: <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7A8.5 8.5 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z" />,
  instagram: <><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="0.5" /></>,
  discord: <path d="M7 8c3-1.5 7-1.5 10 0M7 16c3 1.5 7 1.5 10 0M8 9c-1 2-1 4 0 6M16 9c1 2 1 4 0 6" />,
  email: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></>,
  sideshift: <><path d="M7 8l-4 4 4 4" /><path d="M17 8l4 4-4 4" /><path d="M14 4l-4 16" /></>,
};

/**
 * Opens the creator in the right app (iMessage, WhatsApp, IG DM…) and stamps
 * "last contacted" at the same time — reaching out and logging it are one
 * action, and the button confirms on screen that the stamp landed.
 */
export function ContactButton({
  creator,
  lastContactedAt,
  needsFollowUp,
  onContacted,
  compact = false,
}: {
  creator: ContactCreator;
  lastContactedAt?: string | null;
  needsFollowUp?: boolean;
  onContacted?: () => void | Promise<void>;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [dropUp, setDropUp] = useState(false);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const links = contactLinks(creator);

  // Rows near the bottom of the roster have no room below — open upward there
  // instead of letting the menu run off the page.
  function toggle() {
    const box = ref.current?.getBoundingClientRect();
    if (box) {
      const needed = 90 + links.length * 46;
      setDropUp(window.innerHeight - box.bottom < needed && box.top > needed);
    }
    setOpen((o) => !o);
  }

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  // Clear the confirmation tick a couple of seconds after it appears.
  useEffect(() => {
    if (!justSaved) return;
    const t = setTimeout(() => setJustSaved(false), 2200);
    return () => clearTimeout(t);
  }, [justSaved]);

  async function mark() {
    if (!onContacted) return;
    setSaving(true);
    try {
      await onContacted();
      setJustSaved(true);
    } finally {
      setSaving(false);
    }
  }

  const label = justSaved
    ? "Logged ✓"
    : saving
      ? "Saving…"
      : needsFollowUp
        ? "Follow up"
        : "Contact";

  const btnClass = compact
    ? `btn whitespace-nowrap px-2.5 py-1.5 text-xs ${needsFollowUp ? "border-[var(--signal)] text-[var(--signal)]" : ""}`
    : "btn btn-primary whitespace-nowrap";

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={toggle}
        disabled={saving}
        title={lastContactedAt === undefined ? undefined : `Last contacted ${timeAgo(lastContactedAt)}`}
        className={`${btnClass} disabled:opacity-60`}
      >
        {!compact && (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        )}
        {label}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          className={`absolute right-0 z-40 w-60 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--panel)] shadow-2xl ${
            dropUp ? "bottom-full mb-1.5" : "top-full mt-1.5"
          }`}
        >
          {lastContactedAt !== undefined && (
            <div className="border-b border-[var(--line2)] px-3 py-2 text-[11px] text-[var(--faint)]">
              Last contacted <span className="mono text-[var(--muted)]">{timeAgo(lastContactedAt)}</span>
            </div>
          )}

          {links.length === 0 ? (
            <div className="px-3 py-2.5 text-xs text-[var(--faint)]">
              No phone, IG or email on file yet — add one from Edit.
            </div>
          ) : (
            links.map((l) => (
              <a
                key={l.channel}
                href={l.href}
                target={l.href.startsWith("http") ? "_blank" : undefined}
                rel="noreferrer"
                onClick={() => {
                  setOpen(false);
                  mark();
                }}
                className="flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-[var(--panel2)]"
              >
                <span className="tile-ico h-7 w-7 text-[var(--signal)]">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{ICONS[l.channel]}</svg>
                </span>
                <span className="min-w-0">
                  <span className="block font-medium">{l.label}</span>
                  {l.hint && <span className="mono block truncate text-[11px] text-[var(--faint)]">{l.hint}</span>}
                </span>
              </a>
            ))
          )}

          {onContacted && (
            <button
              onClick={() => {
                setOpen(false);
                mark();
              }}
              className="flex w-full items-center gap-3 border-t border-[var(--line2)] px-3 py-2.5 text-left text-sm text-[var(--muted)] hover:bg-[var(--panel2)] hover:text-[var(--ink)]"
            >
              <span className="tile-ico h-7 w-7">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              </span>
              Mark contacted now
            </button>
          )}
        </div>
      )}
    </div>
  );
}
