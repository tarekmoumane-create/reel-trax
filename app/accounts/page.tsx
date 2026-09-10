"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useClients } from "../providers";
import { TopBar, PageTitle } from "@/components/PageHeader";
import { PostActivity } from "@/components/PostActivity";
import { StatusBadge } from "@/components/StatusBadge";
import type { CadenceStatus, CadenceResult } from "@/lib/cadence";
import { daysLabel, fmtNum } from "@/lib/ui";

interface AccountRow {
  creatorId: string;
  creatorName: string;
  platform: "tiktok" | "instagram" | "youtube" | "threads" | "facebook";
  handle: string;
  url: string | null;
  postsCount: number;
  viewsSum: number;
  daysSinceLastPost: number | null;
  status: CadenceStatus;
  calendar: CadenceResult["calendar"];
}

const PLATFORM_CHIP: Record<AccountRow["platform"], { label: string; bg: string; color: string }> = {
  tiktok: { label: "TT", bg: "var(--chip-tt)", color: "var(--ink)" },
  instagram: { label: "IG", bg: "rgba(214,67,143,0.12)", color: "var(--ig)" },
  youtube: { label: "YT", bg: "rgba(224,60,60,0.12)", color: "var(--yt)" },
  threads: { label: "TH", bg: "var(--chip-tt)", color: "var(--ink)" },
  facebook: { label: "FB", bg: "rgba(24,119,242,0.12)", color: "var(--fb)" },
};

export default function AccountsPage() {
  const { currentClientId, currentClient } = useClients();
  const [rows, setRows] = useState<AccountRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!currentClientId) return;
    setLoading(true);
    const res = await fetch(`/api/accounts?clientId=${currentClientId}`);
    if (res.ok) setRows((await res.json()).rows);
    setLoading(false);
  }, [currentClientId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <TopBar crumbs={["Analytics", "Accounts"]} />
      <div className="px-6 py-6">
        <PageTitle title="Accounts" sub={`Every tracked social account across ${currentClient?.name ?? "this client"}'s creators.`} />

        <div className="card overflow-hidden">
          <div className="hidden grid-cols-[52px_minmax(200px,1.4fr)_auto_90px_90px_100px_104px] items-center gap-4 border-b border-[var(--line)] px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--faint)] lg:grid">
            <div>Type</div><div>Account</div><div>Post activity · 30d</div><div>Posts</div><div>Views</div><div>Last post</div><div>Status</div>
          </div>
          {loading ? (
            <div className="py-16 text-center text-sm text-[var(--muted)]">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="py-16 text-center text-sm text-[var(--muted)]">No accounts tracked yet. Add a creator with a TikTok, Instagram, YouTube, Threads or Facebook URL.</div>
          ) : (
            rows.map((a) => (
              <div key={`${a.creatorId}-${a.platform}`} className="grid grid-cols-1 items-center gap-3 border-b border-[var(--line2)] px-4 py-3 last:border-0 lg:grid-cols-[52px_minmax(200px,1.4fr)_auto_90px_90px_100px_104px] lg:gap-4">
                <span className="mono w-fit rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: PLATFORM_CHIP[a.platform].bg, color: PLATFORM_CHIP[a.platform].color }}>
                  {PLATFORM_CHIP[a.platform].label}
                </span>
                <div className="min-w-0">
                  <a href={a.url ?? "#"} target="_blank" rel="noreferrer" className="mono block truncate text-sm hover:text-[var(--signal)]">@{a.handle}</a>
                  <Link href={`/creators/${a.creatorId}`} className="truncate text-[11px] text-[var(--faint)] hover:text-[var(--signal)]">{a.creatorName}</Link>
                </div>
                <div className="overflow-x-auto"><PostActivity calendar={a.calendar} days={30} dot={12} gap={4} showWeekdays={false} /></div>
                <div className="mono text-[13px]">{a.postsCount}</div>
                <div className="mono text-[13px]">{fmtNum(a.viewsSum)}</div>
                <div className="mono text-[13px]">{daysLabel(a.daysSinceLastPost)}</div>
                <div><StatusBadge status={a.status} /></div>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
