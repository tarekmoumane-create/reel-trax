"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useClients } from "@/app/providers";
import { initials } from "@/lib/ui";

export function TopBar() {
  const { clients, currentClient, setCurrentClientId, reloadClients } =
    useClients();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

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
    <header className="sticky top-0 z-30 flex items-center gap-4 border-b bg-[var(--bg)]/85 px-4 py-3 backdrop-blur md:px-6">
      <Link href="/" className="flex items-center gap-2 shrink-0">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--accent)] text-sm font-black text-white">
          R
        </span>
        <span className="hidden text-[15px] font-semibold tracking-tight sm:block">
          Reel&nbsp;Trax
        </span>
      </Link>

      {/* Client switcher */}
      <div className="relative" ref={ref}>
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-2 rounded-xl border bg-[var(--panel)] px-3 py-1.5 text-sm hover:border-[var(--accent)]"
        >
          {currentClient ? (
            <>
              <span
                className="grid h-5 w-5 place-items-center rounded-md text-[10px] font-bold text-white"
                style={{ background: currentClient.color }}
              >
                {initials(currentClient.name)}
              </span>
              <span className="max-w-[160px] truncate font-medium">
                {currentClient.name}
              </span>
            </>
          ) : (
            <span className="text-[var(--muted)]">Select client</span>
          )}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-[var(--muted)]">
            <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {open && (
          <div className="absolute left-0 mt-2 w-64 overflow-hidden rounded-xl border bg-[var(--panel)] shadow-2xl">
            <div className="max-h-72 overflow-y-auto p-1">
              {clients.length === 0 && (
                <p className="px-3 py-3 text-sm text-[var(--muted)]">
                  No clients yet. Create your first one below.
                </p>
              )}
              {clients.map((c) => (
                <button
                  key={c.id}
                  onClick={() => {
                    setCurrentClientId(c.id);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-[var(--panel2)] ${
                    c.id === currentClient?.id ? "bg-[var(--panel2)]" : ""
                  }`}
                >
                  <span
                    className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-[10px] font-bold text-white"
                    style={{ background: c.color }}
                  >
                    {initials(c.name)}
                  </span>
                  <span className="flex-1 truncate">{c.name}</span>
                  <span className="text-xs text-[var(--muted)]">
                    {c._count?.creators ?? 0}
                  </span>
                  {c.id === currentClient?.id && (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="text-[var(--accent)]">
                      <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
            <div className="border-t p-1">
              {creating ? (
                <div className="flex items-center gap-1.5 p-1.5">
                  <input
                    autoFocus
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && createClient()}
                    placeholder="Client name"
                    className="flex-1 px-2.5 py-1.5 text-sm"
                  />
                  <button
                    onClick={createClient}
                    className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white"
                  >
                    Add
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setCreating(true)}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-[var(--muted)] hover:bg-[var(--panel2)] hover:text-[var(--text)]"
                >
                  <span className="grid h-6 w-6 place-items-center rounded-md border text-[var(--muted)]">+</span>
                  New client
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <nav className="ml-auto flex items-center gap-1 text-sm">
        <Link
          href="/"
          className={`rounded-lg px-3 py-1.5 ${
            pathname === "/" ? "bg-[var(--panel)] text-[var(--text)]" : "text-[var(--muted)] hover:text-[var(--text)]"
          }`}
        >
          Dashboard
        </Link>
        <Link
          href="/settings"
          className={`rounded-lg px-3 py-1.5 ${
            pathname === "/settings" ? "bg-[var(--panel)] text-[var(--text)]" : "text-[var(--muted)] hover:text-[var(--text)]"
          }`}
        >
          Settings
        </Link>
      </nav>
    </header>
  );
}
