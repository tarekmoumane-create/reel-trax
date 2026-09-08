"use client";

import { useEffect, useRef, useState } from "react";
import { contactLinks, type ContactCreator } from "@/lib/contact";

const ICONS: Record<string, React.ReactNode> = {
  imessage: <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7A8.5 8.5 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z" />,
  whatsapp: <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7A8.5 8.5 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z" />,
  instagram: <><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="0.5" /></>,
  discord: <path d="M7 8c3-1.5 7-1.5 10 0M7 16c3 1.5 7 1.5 10 0M8 9c-1 2-1 4 0 6M16 9c1 2 1 4 0 6" />,
  discordChannel: <path d="M4 9h16M4 15h16M10 3L8 21M16 3l-2 18" />,
  email: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></>,
  sideshift: <><path d="M7 8l-4 4 4 4" /><path d="M17 8l4 4-4 4" /><path d="M14 4l-4 16" /></>,
};

/**
 * Opens the creator in the right app (iMessage, WhatsApp, IG DM, Discord…).
 * Purely a launcher — Reel Trax doesn't track conversations.
 */
export function ContactButton({ creator, compact = false }: { creator: ContactCreator; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [dropUp, setDropUp] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const links = contactLinks(creator);

  // Rows near the bottom of the roster have no room below — open upward there
  // instead of letting the menu run off the page.
  function toggle() {
    const box = ref.current?.getBoundingClientRect();
    if (box) {
      const needed = 40 + links.length * 46;
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

  const btnClass = compact ? "btn whitespace-nowrap px-2.5 py-1.5 text-xs" : "btn btn-primary whitespace-nowrap";

  return (
    <div className="relative" ref={ref}>
      <button onClick={toggle} className={btnClass}>
        {!compact && (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        )}
        Contact
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
          {links.length === 0 ? (
            <div className="px-3 py-2.5 text-xs text-[var(--faint)]">
              No phone, IG, Discord or email on file yet — add one from Edit.
            </div>
          ) : (
            links.map((l) => (
              <a
                key={l.channel}
                href={l.href}
                target={l.href.startsWith("http") ? "_blank" : undefined}
                rel="noreferrer"
                onClick={() => setOpen(false)}
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
        </div>
      )}
    </div>
  );
}
