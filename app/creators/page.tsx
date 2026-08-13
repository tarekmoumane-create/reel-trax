"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useClients } from "../providers";
import type { OverviewResponse } from "@/lib/types";
import { TopBar, PageTitle } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { AddCreatorModal } from "@/components/AddCreatorModal";
import { Avatar } from "@/components/Avatar";
import { SOURCE_LABEL, daysLabel, timeAgo } from "@/lib/ui";

export default function CreatorsPage() {
  const { currentClientId, currentClient, reloadClients } = useClients();
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(async () => {
    if (!currentClientId) return;
    const res = await fetch(`/api/overview?clientId=${currentClientId}`);
    if (res.ok) setData(await res.json());
  }, [currentClientId]);

  useEffect(() => {
    load();
  }, [load]);

  const rows = data?.rows ?? [];

  return (
    <>
      <TopBar
        crumbs={["Creator Hub", "Creators"]}
        right={<button onClick={() => setShowAdd(true)} className="btn btn-primary">+ Add creator</button>}
      />
      <div className="px-6 py-6">
        <PageTitle title="Creators" sub={`Manage every creator for ${currentClient?.name ?? "this client"}.`} />

        <div className="card overflow-hidden">
          <div className="hidden grid-cols-[minmax(220px,2fr)_110px_1fr_120px_100px_90px] items-center gap-4 border-b border-[var(--line)] px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--faint)] md:grid">
            <div>Name</div>
            <div>Status</div>
            <div>Accounts</div>
            <div>Source</div>
            <div>Last post</div>
            <div>Synced</div>
          </div>
          {rows.length === 0 ? (
            <div className="py-16 text-center text-sm text-[var(--muted)]">No creators yet. Add your first creator.</div>
          ) : (
            rows.map((r) => (
              <Link
                key={r.id}
                href={`/creators/${r.id}`}
                className="grid grid-cols-1 items-center gap-2 border-b border-[var(--line2)] px-4 py-3 last:border-0 hover:bg-[var(--panel2)] md:grid-cols-[minmax(220px,2fr)_110px_1fr_120px_100px_90px] md:gap-4"
              >
                <div className="flex items-center gap-3">
                  <Avatar name={r.displayName} creatorId={r.id} size={36} />
                  <span className="truncate text-sm font-medium">{r.displayName}</span>
                </div>
                <div><StatusBadge status={r.cadence.status} /></div>
                <div className="mono flex flex-wrap gap-x-2 text-[11px] text-[var(--muted)]">
                  {r.tiktokHandle && <span>TT @{r.tiktokHandle}</span>}
                  {r.instagramHandle && <span>IG @{r.instagramHandle}</span>}
                  {!r.tiktokHandle && !r.instagramHandle && <span className="text-[var(--faint)]">—</span>}
                </div>
                <div className="text-[13px] text-[var(--muted)]">{SOURCE_LABEL[r.source] ?? r.source}</div>
                <div className="mono text-[13px]">{daysLabel(r.cadence.daysSinceLastPost)}</div>
                <div className="text-[12px] text-[var(--faint)]">{timeAgo(r.lastSyncedAt)}</div>
              </Link>
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
