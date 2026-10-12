"use client";

import { useEffect, useRef, useState } from "react";
import { fmtNum } from "@/lib/ui";

// The manual half of cross-post grouping. lib/videogroups matches copies of the
// same original automatically from caption and posting time, which is a guess —
// this is where a wrong guess gets fixed, and the fix sticks (both ends are
// pinned, so the next sync leaves them alone).
//
// Only matters on campaigns with "count cross-posts as one video" on; elsewhere
// it's harmless bookkeeping.

const PLATFORM_LABEL: Record<string, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  youtube: "YouTube",
  threads: "Threads",
  facebook: "Facebook",
  snapchat: "Snapchat",
};

interface GroupInfo {
  groupKey: string | null;
  groupPinned: boolean;
  members: { id: string; platform: string; url: string | null; postedAt: string; views: number; groupPinned: boolean }[];
  candidates: { id: string; platform: string; url: string | null; caption: string | null; postedAt: string; views: number; grouped: boolean }[];
}

const shortDate = (s: string) =>
  new Date(s).toLocaleDateString("en", { month: "short", day: "numeric", year: "2-digit" });

export function CrossPostMenu({
  postId,
  platform,
  groupSize,
  groupPinned,
  onChanged,
}: {
  postId: string;
  platform: string;
  groupSize: number;
  groupPinned: boolean;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [dropUp, setDropUp] = useState(false);
  const [info, setInfo] = useState<GroupInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  async function toggle() {
    const box = ref.current?.getBoundingClientRect();
    if (box) setDropUp(window.innerHeight - box.bottom < 340 && box.top > 340);
    const next = !open;
    setOpen(next);
    // Candidates are a per-video query, so only pay for it when the menu opens.
    if (next) {
      setError("");
      setInfo(null);
      const res = await fetch(`/api/videos/${postId}`);
      if (res.ok) setInfo(await res.json());
      else setError("Couldn't load this video's cross-posts.");
    }
  }

  async function send(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    const res = await fetch(`/api/videos/${postId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!res.ok) {
      const e = await res.json().catch(() => null);
      setError(e?.error ?? "That didn't work.");
      return;
    }
    setOpen(false);
    onChanged();
  }

  const linked = groupSize > 1;
  const label = linked ? `${groupSize} platforms` : "Solo";
  const tone = linked ? "text-[var(--signal)]" : "text-[var(--faint)]";

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={toggle}
        title={linked ? `Cross-posted to ${groupSize} platforms — paid as one video` : "Not linked to any other post"}
        className={`inline-flex w-full items-center justify-between gap-1 rounded-lg border px-2 py-1 text-[12.5px] font-medium hover:border-[var(--signal)] ${open ? "border-[var(--signal)]" : "border-[var(--line)]"} ${tone}`}
      >
        <span className="inline-flex min-w-0 items-center gap-1">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" className="shrink-0">
            <path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="truncate">{label}</span>
        </span>
        {groupPinned && <span className="shrink-0 text-[11px] text-[var(--faint)]" title="Set by hand — the auto-matcher leaves this alone">📌</span>}
      </button>

      {open && (
        <div className={`absolute right-0 z-40 w-72 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--panel)] py-1 shadow-2xl ${dropUp ? "bottom-full mb-1.5" : "top-full mt-1.5"}`}>
          <div className="px-3 pb-1 pt-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-[var(--faint)]">
            Same video, other platforms
          </div>

          {!info ? (
            <p className="px-3 py-2 text-xs text-[var(--muted)]">Loading…</p>
          ) : (
            <>
              {info.members.length > 1 ? (
                <>
                  <ul className="px-3 pb-1.5 text-xs">
                    {info.members.map((m) => (
                      <li key={m.id} className="flex items-center justify-between gap-2 py-0.5">
                        <span className={m.id === postId ? "font-medium" : "text-[var(--muted)]"}>
                          {PLATFORM_LABEL[m.platform] ?? m.platform}
                          {m.id === postId && <span className="text-[var(--faint)]"> (this one)</span>}
                        </span>
                        <span className="mono shrink-0 text-[11.5px] text-[var(--faint)]">{fmtNum(m.views)} · {shortDate(m.postedAt)}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="px-3 pb-1.5 text-[11.5px] leading-snug text-[var(--faint)]">
                    Paid as one video, qualifying on the best platform&apos;s views.
                  </p>
                  <div className="border-t border-[var(--line2)] p-1">
                    <button
                      disabled={busy}
                      onClick={() => send({ ungroup: true })}
                      className="w-full rounded-lg px-2 py-1.5 text-left text-xs font-medium text-[var(--bad)] hover:bg-[color:rgba(242,104,95,0.1)] disabled:opacity-50"
                    >
                      Not the same video — split this one off
                    </button>
                  </div>
                </>
              ) : (
                <p className="px-3 pb-1.5 text-[12.5px] leading-snug text-[var(--muted)]">
                  Counted as its own original. Link it below if it&apos;s a copy of one of these.
                </p>
              )}

              <div className="border-t border-[var(--line2)] px-3 pb-0.5 pt-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-[var(--faint)]">
                Link to another post
              </div>
              {info.candidates.length === 0 ? (
                <p className="px-3 py-2 text-[12.5px] text-[var(--faint)]">Nothing else from this creator within a week.</p>
              ) : (
                <ul className="max-h-48 overflow-y-auto py-0.5">
                  {info.candidates.map((c) => (
                    <li key={c.id}>
                      <button
                        disabled={busy || c.platform === platform}
                        onClick={() => send({ groupWith: c.id })}
                        title={c.platform === platform ? "Same platform — can't be a cross-post" : c.caption ?? ""}
                        className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs hover:bg-[var(--panel2)] disabled:opacity-35 disabled:hover:bg-transparent"
                      >
                        <span className="min-w-0">
                          <span className="block truncate">{c.caption || <span className="text-[var(--faint)]">(no caption)</span>}</span>
                          <span className="block text-[11.5px] text-[var(--faint)]">
                            {PLATFORM_LABEL[c.platform] ?? c.platform} · {shortDate(c.postedAt)} · {fmtNum(c.views)} views
                            {c.grouped && " · already grouped"}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {error && <p className="px-3 py-1.5 text-[12.5px] text-[var(--bad)]">{error}</p>}
        </div>
      )}
    </div>
  );
}
