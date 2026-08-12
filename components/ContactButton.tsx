"use client";

import { useEffect, useRef, useState } from "react";
import { contactLinks, type ContactCreator } from "@/lib/contact";

const ICONS: Record<string, React.ReactNode> = {
  imessage: <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7A8.5 8.5 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z" />,
  whatsapp: <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7A8.5 8.5 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z" />,
  instagram: <><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="0.5" /></>,
  discord: <path d="M7 8c3-1.5 7-1.5 10 0M7 16c3 1.5 7 1.5 10 0M8 9c-1 2-1 4 0 6M16 9c1 2 1 4 0 6" />,
  email: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></>,
};

export function ContactButton({
  creator,
  onContacted,
}: {
  creator: ContactCreator;
  onContacted?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const links = contactLinks(creator);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  if (links.length === 0) {
    return <button disabled className="btn opacity-50" title="No contact info yet">Contact</button>;
  }

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="btn btn-primary">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
        Contact
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-1.5 w-56 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--panel)] shadow-2xl">
          {links.map((l) => (
            <a
              key={l.channel}
              href={l.href}
              target={l.href.startsWith("http") ? "_blank" : undefined}
              rel="noreferrer"
              onClick={() => { setOpen(false); onContacted?.(); }}
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
          ))}
        </div>
      )}
    </div>
  );
}
