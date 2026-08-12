"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useClients } from "@/app/providers";
import { initials } from "@/lib/ui";

type Item = { href: string; label: string; icon: React.ReactNode; soon?: boolean };

const I = {
  grid: <path d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z" />,
  at: <path d="M12 2a10 10 0 1 0 4 19M16 12a4 4 0 1 0-8 0 4 4 0 0 0 8 0v-2" />,
  video: <path d="M15 10l5-3v10l-5-3zM3 6h12v12H3z" />,
  users: <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />,
  target: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4" /></>,
  wallet: <path d="M20 12V8H6a2 2 0 0 1 0-4h12v4M4 6v12a2 2 0 0 0 2 2h14v-4M18 12a2 2 0 0 0 0 4h4v-4z" />,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 0 0-.1-1l2-1.6-2-3.4-2.4 1a7 7 0 0 0-1.7-1L14.5 2h-4l-.3 2.6a7 7 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7 7 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 1.7 1l.3 2.6h4l.3-2.6a7 7 0 0 0 1.7-1l2.4 1 2-3.4-2-1.6a7 7 0 0 0 .1-1z" /></>,
};

const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: "Analytics",
    items: [
      { href: "/", label: "Overview", icon: I.grid },
      { href: "/accounts", label: "Accounts", icon: I.at, soon: true },
      { href: "/videos", label: "Videos", icon: I.video, soon: true },
    ],
  },
  {
    title: "Creator Hub",
    items: [
      { href: "/creators", label: "Creators", icon: I.users },
      { href: "/campaigns", label: "Campaigns", icon: I.target, soon: true },
      { href: "/payouts", label: "Payouts", icon: I.wallet, soon: true },
    ],
  },
  {
    title: "Organization",
    items: [{ href: "/settings", label: "Settings", icon: I.gear }],
  },
];

function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

export function Sidebar() {
  const { clients, currentClient, setCurrentClientId, reloadClients } = useClients();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setCreating(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  async function createClient() {
    const name = newName.trim();
    if (!name) return;
    const res = await fetch("/api/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const client = await res.json();
    await reloadClients();
    setCurrentClientId(client.id);
    setNewName("");
    setCreating(false);
    setOpen(false);
  }

  return (
    <aside className="flex w-[228px] shrink-0 flex-col border-r border-[var(--line)] bg-[var(--rail)]">
      {/* client switcher */}
      <div className="relative p-3" ref={ref}>
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center gap-2.5 rounded-xl border border-[var(--line)] bg-[var(--panel)] px-2.5 py-2 text-left hover:border-[var(--signal)]"
        >
          <span
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-xs font-bold text-white"
            style={{ background: currentClient?.color ?? "#f5a524" }}
          >
            {currentClient ? initials(currentClient.name) : "—"}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold">
              {currentClient?.name ?? "Select client"}
            </span>
            <span className="block text-[11px] text-[var(--muted)]">
              {currentClient ? `${currentClient._count?.creators ?? 0} creators` : "Reel Trax"}
            </span>
          </span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-[var(--faint)]">
            <path d="M8 9l4-4 4 4M8 15l4 4 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {open && (
          <div className="absolute left-3 right-3 z-40 mt-1.5 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--panel)] shadow-2xl">
            <div className="max-h-64 overflow-y-auto p-1">
              {clients.map((c) => (
                <button
                  key={c.id}
                  onClick={() => {
                    setCurrentClientId(c.id);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-[var(--panel2)] ${
                    c.id === currentClient?.id ? "bg-[var(--panel2)]" : ""
                  }`}
                >
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-[10px] font-bold text-white" style={{ background: c.color }}>
                    {initials(c.name)}
                  </span>
                  <span className="flex-1 truncate">{c.name}</span>
                  <span className="mono text-[11px] text-[var(--faint)]">{c._count?.creators ?? 0}</span>
                </button>
              ))}
            </div>
            <div className="border-t border-[var(--line)] p-1">
              {creating ? (
                <div className="flex items-center gap-1.5 p-1">
                  <input
                    autoFocus
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && createClient()}
                    placeholder="Client name"
                    className="min-w-0 flex-1 px-2 py-1.5 text-[13px]"
                  />
                  <button onClick={createClient} className="btn-primary shrink-0 rounded-lg px-2.5 py-1.5 text-[12px]">
                    Add
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setCreating(true)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-[var(--muted)] hover:bg-[var(--panel2)] hover:text-[var(--ink)]"
                >
                  <span className="grid h-6 w-6 place-items-center rounded-md border border-[var(--line)] text-[var(--muted)]">+</span>
                  New client
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* nav */}
      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        {GROUPS.map((g) => (
          <div key={g.title} className="mb-4">
            <div className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--faint)]">
              {g.title}
            </div>
            {g.items.map((it) => {
              const active = pathname === it.href;
              return (
                <Link
                  key={it.href}
                  href={it.href}
                  className={`group mb-0.5 flex items-center gap-2.5 rounded-lg px-2 py-[7px] text-[13px] ${
                    active
                      ? "bg-[var(--panel2)] text-[var(--ink)]"
                      : "text-[var(--muted)] hover:bg-[var(--panel2)] hover:text-[var(--ink)]"
                  }`}
                >
                  <span className={active ? "text-[var(--signal)]" : "text-[var(--faint)] group-hover:text-[var(--muted)]"}>
                    <Icon>{it.icon}</Icon>
                  </span>
                  <span className="flex-1">{it.label}</span>
                  {it.soon && (
                    <span className="rounded bg-[var(--panel)] px-1.5 py-0.5 text-[9px] font-medium text-[var(--faint)]">
                      soon
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* user footer */}
      <div className="flex items-center gap-2.5 border-t border-[var(--line)] p-3">
        <span className="grid h-8 w-8 place-items-center rounded-full bg-[var(--panel2)] text-[11px] font-semibold text-[var(--muted)]">
          TM
        </span>
        <div className="min-w-0 flex-1 text-[12px]">
          <div className="truncate font-medium">Reel Trax</div>
          <div className="truncate text-[var(--faint)]">The Reel Work</div>
        </div>
      </div>
    </aside>
  );
}
