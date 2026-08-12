"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useClients } from "./providers";
import type { OverviewResponse, OverviewRow } from "@/lib/types";
import type { CadenceStatus } from "@/lib/cadence";
import { PostActivity } from "@/components/PostActivity";
import { StatusBadge } from "@/components/StatusBadge";
import { AddCreatorModal } from "@/components/AddCreatorModal";
import { TopBar, PageTitle } from "@/components/PageHeader";
import { SOURCE_LABEL, daysLabel, initials, timeAgo } from "@/lib/ui";

type Filter = "all" | CadenceStatus | "follow_up";

export default function Overview() {
  const { currentClientId, currentClient, loading: clientsLoading, reloadClients } = useClients();
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [busyRow, setBusyRow] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!currentClientId) {
      setData(null);
      return;
    }
    setLoading(true);
    const res = await fetch(`/api/overview?clientId=${currentClientId}`);
    if (res.ok) setData(await res.json());
    setLoading(false);
  }, [currentClientId]);

  useEffect(() => {
    load();
  }, [load]);

  async function syncAll() {
    if (!currentClientId) return;
    setSyncing(true);
    await fetch(`/api/sync?clientId=${currentClientId}`, { method: "POST" });
    await load();
    setSyncing(false);
  }

  async function markContacted(id: string) {
    setBusyRow(id);
    await fetch(`/api/creators/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markContactedNow: true }),
    });
    await load();
    setBusyRow(null);
  }
  async function resync(id: string) {
    setBusyRow(id);
    await fetch(`/api/creators/${id}/sync`, { method: "POST" });
    await load();
    setBusyRow(null);
  }

  const rows = useMemo(() => {
    let r = data?.rows ?? [];
    if (filter === "follow_up") r = r.filter((x) => x.needsFollowUp);
    else if (filter !== "all") r = r.filter((x) => x.cadence.status === filter);
    if (q.trim()) {
      const s = q.toLowerCase();
      r = r.filter(
        (x) =>
          x.displayName.toLowerCase().includes(s) ||
          x.tiktokHandle?.toLowerCase().includes(s) ||
          x.instagramHandle?.toLowerCase().includes(s)
      );
    }
    return r;
  }, [data, filter, q]);

  const s = data?.summary;

  if (!clientsLoading && !currentClient) {
    return (
      <>
        <TopBar crumbs={["Analytics", "Overview"]} />
        <div className="mx-auto max-w-md px-6 py-24 text-center">
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-[var(--signal)] text-2xl font-black text-white">R</div>
          <h1 className="font-display text-xl font-bold">Welcome to Reel Trax</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Create your first client from the switcher in the top-left, then add creators to start tracking posting cadence automatically.
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <TopBar
        crumbs={["Analytics", "Overview"]}
        right={
          <>
            <button onClick={syncAll} disabled={syncing} className="btn disabled:opacity-60">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className={syncing ? "animate-spin" : ""}>
                <path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {syncing ? "Syncing…" : "Sync now"}
            </button>
            <button onClick={() => setShowAdd(true)} className="btn btn-primary">+ Add creator</button>
          </>
        }
      />

      <div className="px-6 py-6">
        <PageTitle title={currentClient?.name ?? "Overview"} sub={s ? `${s.total} creators tracked · times in ${data?.timeZone}` : "Loading…"} />

        {/* KPI cards */}
        {s && (
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Kpi label="Creators" value={s.total} active={filter === "all"} onClick={() => setFilter("all")} />
            <Kpi label="On track" value={s.onTrack} tone="var(--ok)" active={filter === "on_track"} onClick={() => setFilter("on_track")} />
            <Kpi label="Behind" value={s.behind} tone="var(--warn)" active={filter === "behind"} onClick={() => setFilter("behind")} />
            <Kpi label="Gone quiet" value={s.quiet} tone="var(--bad)" active={filter === "quiet"} onClick={() => setFilter("quiet")} />
            <Kpi label="Follow-ups due" value={s.needFollowUp} tone="var(--signal)" active={filter === "follow_up"} onClick={() => setFilter("follow_up")} />
          </div>
        )}

        {/* toolbar */}
        <div className="mb-3 flex items-center gap-2">
          <div className="relative w-full max-w-xs">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--faint)]">
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" /><path d="M21 21l-4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search creators or handles…" className="w-full py-2 pl-9 pr-3 text-sm" />
          </div>
          {filter !== "all" && (
            <button onClick={() => setFilter("all")} className="btn text-xs text-[var(--muted)]">Clear filter ✕</button>
          )}
        </div>

        {/* roster */}
        <div className="card overflow-hidden">
          <div className="hidden grid-cols-[minmax(200px,1.6fr)_auto_84px_72px_64px_104px_150px] items-center gap-4 border-b border-[var(--line)] px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--faint)] lg:grid">
            <div>Creator</div>
            <div>Post activity · 30d</div>
            <div>Last post</div>
            <div>7d / target</div>
            <div>Streak</div>
            <div>Status</div>
            <div className="text-right">Actions</div>
          </div>

          {loading && !data ? (
            <div className="py-16 text-center text-sm text-[var(--muted)]">Loading roster…</div>
          ) : rows.length === 0 ? (
            <div className="py-16 text-center text-sm text-[var(--muted)]">
              {data?.rows.length ? "No creators match this filter." : "No creators yet. Add your first creator to start tracking."}
            </div>
          ) : (
            rows.map((r) => (
              <CreatorRow key={r.id} row={r} busy={busyRow === r.id} onContacted={() => markContacted(r.id)} onResync={() => resync(r.id)} />
            ))
          )}
        </div>
      </div>

      {showAdd && currentClient && (
        <AddCreatorModal
          clientId={currentClient.id}
          clientName={currentClient.name}
          onClose={() => setShowAdd(false)}
          onCreated={async () => {
            setShowAdd(false);
            await Promise.all([load(), reloadClients()]);
          }}
        />
      )}
    </>
  );
}

function Kpi({ label, value, tone, active, onClick }: { label: string; value: number; tone?: string; active?: boolean; onClick?: () => void }) {
  return (
    <button onClick={onClick} className={`card px-4 py-3.5 text-left transition hover:border-[var(--signal)] ${active ? "ring-1 ring-[var(--signal)]" : ""}`}>
      <div className="mono text-[26px] font-bold leading-none" style={{ color: tone }}>{value}</div>
      <div className="mt-2 text-[11px] uppercase tracking-wide text-[var(--muted)]">{label}</div>
    </button>
  );
}

function CreatorRow({ row, busy, onContacted, onResync }: { row: OverviewRow; busy: boolean; onContacted: () => void; onResync: () => void }) {
  const c = row.cadence;
  return (
    <div className="grid grid-cols-1 items-center gap-3 border-b border-[var(--line2)] px-4 py-3 last:border-0 lg:grid-cols-[minmax(200px,1.6fr)_auto_84px_72px_64px_104px_150px] lg:gap-4">
      {/* identity */}
      <div className="flex min-w-0 items-center gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--panel2)] text-xs font-semibold text-[var(--muted)]">
          {initials(row.displayName)}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Link href={`/creators/${row.id}`} className="truncate text-sm font-medium hover:text-[var(--signal)]">{row.displayName}</Link>
            {row.status !== "active" && <span className="rounded-full bg-[var(--panel2)] px-1.5 py-0.5 text-[9px] text-[var(--muted)]">{row.status}</span>}
          </div>
          <div className="mono flex flex-wrap items-center gap-x-2 text-[11px] text-[var(--faint)]">
            {row.tiktokHandle && <span>TT @{row.tiktokHandle}</span>}
            {row.instagramHandle && <span>IG @{row.instagramHandle}</span>}
            <span className="rounded bg-[var(--panel2)] px-1.5 py-0.5 text-[9px] text-[var(--muted)]">{SOURCE_LABEL[row.source] ?? row.source}</span>
          </div>
        </div>
      </div>

      {/* activity strip */}
      <div className="overflow-x-auto"><PostActivity calendar={c.calendar} days={30} dot={12} gap={4} /></div>

      {/* metrics */}
      <div className="mono text-[13px]">{daysLabel(c.daysSinceLastPost)}</div>
      <div className="mono text-[13px]">{c.postsLast7d}/{c.expectedPerWeek}</div>
      <div className="mono text-[13px]">{c.currentStreakDays > 0 ? `🔥${c.currentStreakDays}` : "—"}</div>
      <div><StatusBadge status={c.status} /></div>

      {/* actions */}
      <div className="flex items-center justify-end gap-1.5">
        <button onClick={onContacted} disabled={busy} title={`Last contacted ${timeAgo(row.lastContactedAt)}`}
          className={`btn px-2.5 py-1.5 text-xs disabled:opacity-50 ${row.needsFollowUp ? "border-[var(--signal)] text-[var(--signal)]" : ""}`}>
          {row.needsFollowUp ? "Follow up" : "Contacted"}
        </button>
        <button onClick={onResync} disabled={busy} title={`Synced ${timeAgo(row.lastSyncedAt)}`} className="btn px-2.5 py-1.5 text-xs disabled:opacity-50">
          {busy ? "…" : "Sync"}
        </button>
      </div>
    </div>
  );
}
