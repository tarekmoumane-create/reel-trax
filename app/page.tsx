"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useClients } from "./providers";
import type { OverviewResponse, OverviewRow } from "@/lib/types";
import type { CadenceStatus } from "@/lib/cadence";
import { Heatmap } from "@/components/Heatmap";
import { StatusBadge } from "@/components/StatusBadge";
import { AddCreatorModal } from "@/components/AddCreatorModal";
import { SOURCE_LABEL, daysLabel, initials, timeAgo } from "@/lib/ui";

type Filter = "all" | CadenceStatus | "follow_up";

export default function Dashboard() {
  const { currentClientId, currentClient, loading: clientsLoading, reloadClients } =
    useClients();
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
      <div className="mx-auto max-w-md px-4 py-24 text-center">
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-[var(--accent)] text-2xl font-black text-white">
          R
        </div>
        <h1 className="text-xl font-semibold">Welcome to Reel Trax</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Create your first client using the switcher in the top-left, then add
          creators to start tracking posting cadence automatically.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:px-6">
      {/* header */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            {currentClient && (
              <span
                className="grid h-6 w-6 place-items-center rounded-md text-[11px] font-bold text-white"
                style={{ background: currentClient.color }}
              >
                {initials(currentClient.name)}
              </span>
            )}
            {currentClient?.name}
          </h1>
          <p className="text-xs text-[var(--muted)]">
            {s ? `${s.total} creators` : "…"}
            {data?.timeZone ? ` · times in ${data.timeZone}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={syncAll}
            disabled={syncing}
            className="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm hover:bg-[var(--panel2)] disabled:opacity-60"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              className={syncing ? "animate-spin" : ""}
            >
              <path
                d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {syncing ? "Syncing…" : "Sync now"}
          </button>
          <button
            onClick={() => setShowAdd(true)}
            className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white"
          >
            + Add creator
          </button>
        </div>
      </div>

      {/* summary cards */}
      {s && (
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StatCard label="Creators" value={s.total} active={filter === "all"} onClick={() => setFilter("all")} />
          <StatCard label="On track" value={s.onTrack} tone="#22c55e" active={filter === "on_track"} onClick={() => setFilter("on_track")} />
          <StatCard label="Behind" value={s.behind} tone="#f59e0b" active={filter === "behind"} onClick={() => setFilter("behind")} />
          <StatCard label="Gone quiet" value={s.quiet} tone="#ef4444" active={filter === "quiet"} onClick={() => setFilter("quiet")} />
          <StatCard label="Follow-ups due" value={s.needFollowUp} tone="#7c5cff" active={filter === "follow_up"} onClick={() => setFilter("follow_up")} />
        </div>
      )}

      {/* search */}
      <div className="mb-4 flex items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search creators or handles…"
          className="w-full max-w-xs px-3 py-2 text-sm"
        />
        {filter !== "all" && (
          <button
            onClick={() => setFilter("all")}
            className="rounded-lg border px-2.5 py-2 text-xs text-[var(--muted)] hover:bg-[var(--panel2)]"
          >
            Clear filter ✕
          </button>
        )}
      </div>

      {/* roster */}
      {loading && !data ? (
        <div className="py-16 text-center text-sm text-[var(--muted)]">Loading roster…</div>
      ) : rows.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-sm text-[var(--muted)]">
            {data?.rows.length
              ? "No creators match this filter."
              : "No creators yet. Add your first creator to start tracking."}
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {rows.map((r) => (
            <CreatorRow
              key={r.id}
              row={r}
              busy={busyRow === r.id}
              onContacted={() => markContacted(r.id)}
              onResync={() => resync(r.id)}
            />
          ))}
        </div>
      )}

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
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
  active,
  onClick,
}: {
  label: string;
  value: number;
  tone?: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`card px-4 py-3 text-left transition hover:border-[var(--accent)] ${
        active ? "ring-1 ring-[var(--accent)]" : ""
      }`}
    >
      <div className="text-2xl font-semibold" style={{ color: tone }}>
        {value}
      </div>
      <div className="text-xs text-[var(--muted)]">{label}</div>
    </button>
  );
}

function CreatorRow({
  row,
  busy,
  onContacted,
  onResync,
}: {
  row: OverviewRow;
  busy: boolean;
  onContacted: () => void;
  onResync: () => void;
}) {
  const c = row.cadence;
  return (
    <div className="card flex flex-col gap-3 p-3.5 md:flex-row md:items-center md:gap-4">
      {/* identity */}
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--panel2)] text-sm font-semibold text-[var(--muted)]">
          {initials(row.displayName)}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Link
              href={`/creators/${row.id}`}
              className="truncate font-medium hover:text-[var(--accent)]"
            >
              {row.displayName}
            </Link>
            {row.status !== "active" && (
              <span className="rounded-full bg-[var(--panel2)] px-2 py-0.5 text-[10px] text-[var(--muted)]">
                {row.status}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[var(--muted)]">
            {row.tiktokHandle && <span>TT @{row.tiktokHandle}</span>}
            {row.instagramHandle && <span>IG @{row.instagramHandle}</span>}
            <span className="rounded bg-[var(--panel2)] px-1.5 py-0.5 text-[10px]">
              {SOURCE_LABEL[row.source] ?? row.source}
            </span>
          </div>
        </div>
      </div>

      {/* heatmap (last 5 weeks) */}
      <div className="hidden lg:block">
        <Heatmap calendar={c.calendar.slice(-35)} cell={10} gap={2} />
      </div>

      {/* metrics */}
      <div className="flex items-center gap-4 md:gap-5">
        <Metric label="Last post" value={daysLabel(c.daysSinceLastPost)} />
        <Metric label="7d" value={`${c.postsLast7d}/${c.expectedPerWeek}`} />
        <Metric
          label="Streak"
          value={c.currentStreakDays > 0 ? `🔥 ${c.currentStreakDays}` : "—"}
        />
        <div className="w-[92px] text-right">
          <StatusBadge status={c.status} />
        </div>
      </div>

      {/* actions */}
      <div className="flex items-center gap-1.5 border-t pt-2.5 md:border-l md:border-t-0 md:pl-3 md:pt-0">
        <button
          onClick={onContacted}
          title={`Last contacted ${timeAgo(row.lastContactedAt)}`}
          disabled={busy}
          className={`rounded-lg border px-2.5 py-1.5 text-xs hover:bg-[var(--panel2)] disabled:opacity-50 ${
            row.needsFollowUp ? "border-[var(--accent)] text-[var(--accent)]" : ""
          }`}
        >
          {row.needsFollowUp ? "Follow up" : "Contacted"}
        </button>
        <button
          onClick={onResync}
          disabled={busy}
          title={`Synced ${timeAgo(row.lastSyncedAt)}`}
          className="rounded-lg border px-2.5 py-1.5 text-xs hover:bg-[var(--panel2)] disabled:opacity-50"
        >
          {busy ? "…" : "Sync"}
        </button>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <div className="text-sm font-medium tabular-nums">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-[var(--muted)]">
        {label}
      </div>
    </div>
  );
}
