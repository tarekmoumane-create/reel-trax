"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useClients } from "../providers";
import type { OverviewResponse, OverviewRow } from "@/lib/types";
import { TopBar, PageTitle } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { ShadowBanBadge } from "@/components/ShadowBanBadge";
import { PostActivity } from "@/components/PostActivity";
import { AddCreatorModal } from "@/components/AddCreatorModal";
import { Avatar } from "@/components/Avatar";
import { Select } from "@/components/Select";
import { SOURCE_LABEL, daysLabel, fmtNum, timeAgo } from "@/lib/ui";
import { fmtPct } from "@/lib/engagement";

type SortKey = "status" | "views30d" | "viewsTotal" | "engagement30d" | "lastPost" | "cadence7d" | "newest" | "name";

const SORT_OPTIONS: [SortKey, string][] = [
  ["status", "Status"],
  ["views30d", "Views · 30d"],
  ["viewsTotal", "Views · all time"],
  ["engagement30d", "Engagement · 30d"],
  ["lastPost", "Last post"],
  ["cadence7d", "Posts · 7d"],
  ["newest", "Recently added"],
  ["name", "Name"],
];

// null daysSinceLastPost (never posted) sorts to the bottom of "Last post"
const days = (r: OverviewRow) => r.cadence.daysSinceLastPost ?? Number.MAX_SAFE_INTEGER;

const SORTS: Record<SortKey, (a: OverviewRow, b: OverviewRow) => number> = {
  status: () => 0, // API order: active first, severity, most-overdue
  views30d: (a, b) => b.views30d - a.views30d,
  viewsTotal: (a, b) => b.viewsTotal - a.viewsTotal,
  // no views in the window = no rate; those sort to the bottom
  engagement30d: (a, b) => (b.engagement30d ?? -1) - (a.engagement30d ?? -1),
  lastPost: (a, b) => days(a) - days(b),
  cadence7d: (a, b) => b.cadence.postsLast7d - a.cadence.postsLast7d,
  newest: (a, b) => (a.createdAt < b.createdAt ? 1 : -1),
  name: (a, b) => a.displayName.localeCompare(b.displayName),
};

const SORT_LS_KEY = "rt.creatorsSort";

const GRID = "md:grid-cols-[minmax(170px,1.6fr)_100px_minmax(120px,340px)_minmax(110px,1fr)_84px_124px_100px_88px_80px]";

export default function CreatorsPage() {
  const { currentClientId, currentClient, reloadClients } = useClients();
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [sort, setSort] = useState<SortKey>("status");

  useEffect(() => {
    const saved = localStorage.getItem(SORT_LS_KEY) as SortKey | null;
    if (saved && SORT_OPTIONS.some(([k]) => k === saved)) setSort(saved);
  }, []);

  const load = useCallback(async () => {
    if (!currentClientId) return;
    const res = await fetch(`/api/overview?clientId=${currentClientId}`);
    if (res.ok) setData(await res.json());
  }, [currentClientId]);

  useEffect(() => {
    load();
  }, [load]);

  const rows = useMemo(
    () => [...(data?.rows ?? [])].sort(SORTS[sort]),
    [data, sort]
  );

  return (
    <>
      <TopBar
        crumbs={["Creator Hub", "Creators"]}
        right={<button onClick={() => setShowAdd(true)} className="btn btn-primary">+ Add creator</button>}
      />
      <div className="px-6 py-6">
        <PageTitle title="Creators" sub={`Manage every creator for ${currentClient?.name ?? "this client"}.`} />

        <div className="mb-3 flex items-center justify-end gap-2">
          <span className="text-xs text-[var(--faint)]">Sort by</span>
          <Select
            size="sm"
            align="right"
            value={sort}
            onChange={(v) => {
              setSort(v as SortKey);
              localStorage.setItem(SORT_LS_KEY, v);
            }}
            options={SORT_OPTIONS}
          />
        </div>

        <div className="card overflow-hidden">
          <div className={`hidden ${GRID} items-center gap-4 border-b border-[var(--line)] px-4 py-2.5 text-[11.5px] font-semibold uppercase tracking-wide text-[var(--muted)] md:grid`}>
            <div>Name</div>
            <div>Status</div>
            <div>Post activity · 30d</div>
            <div>Accounts</div>
            <div>Views · 30d</div>
            <div title="Likes + comments + shares, divided by views, across their videos from the last 30 days">Eng. rate · 30d</div>
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
                className={`grid grid-cols-1 items-center gap-2 border-b border-[var(--line2)] px-4 py-3 last:border-0 hover:bg-[var(--panel2)] ${GRID} md:gap-4`}
              >
                <div className="flex items-center gap-3">
                  <Avatar name={r.displayName} creatorId={r.id} size={36} />
                  <span className="truncate text-sm font-medium">{r.displayName}</span>
                </div>
                <div className="flex flex-wrap gap-1"><StatusBadge status={r.cadence.status} /><ShadowBanBadge flags={r.shadowBans} compact /></div>
                {/* right-aligned so a narrow window clips the oldest days, never the latest;
                    padded so today's outline ring (drawn outside its dot) isn't clipped */}
                <div className="flex min-w-0 justify-end overflow-hidden p-1">
                  <PostActivity calendar={r.cadence.calendar} days={30} dot={9} gap={2} showWeekdays={false} />
                </div>
                <div className="mono flex flex-wrap gap-x-2 text-[12.5px]">
                  {r.tiktokHandle && <span>TT @{r.tiktokHandle}</span>}
                  {r.instagramHandle && <span>IG @{r.instagramHandle}</span>}
                  {r.youtubeHandle && <span>YT @{r.youtubeHandle}</span>}
                  {r.threadsHandle && <span>TH @{r.threadsHandle}</span>}
                  {r.facebookHandle && <span>FB {r.facebookHandle}</span>}
                  {!r.tiktokHandle && !r.instagramHandle && !r.youtubeHandle && !r.threadsHandle && !r.facebookHandle && <span className="text-[var(--faint)]">—</span>}
                </div>
                <div className="mono text-[14px] font-medium">{r.views30d > 0 ? fmtNum(r.views30d) : <span className="text-[var(--faint)]">—</span>}</div>
                <div className="mono text-[14px] font-medium">{r.engagement30d != null ? fmtPct(r.engagement30d) : <span className="text-[var(--faint)]">—</span>}</div>
                <div className="text-[14px]">{SOURCE_LABEL[r.source] ?? r.source}</div>
                <div className="mono text-[14px]">{daysLabel(r.cadence.daysSinceLastPost)}</div>
                <div className="text-[13px] text-[var(--muted)]">{timeAgo(r.lastSyncedAt)}</div>
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
