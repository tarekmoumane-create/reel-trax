"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useClients } from "../providers";
import { TopBar, PageTitle } from "@/components/PageHeader";
import { VideoThumb } from "@/components/VideoThumb";
import { fmtNum } from "@/lib/ui";

interface VideoRow {
  id: string;
  platform: string;
  url: string | null;
  caption: string | null;
  thumbnailUrl: string | null;
  postedAt: string;
  views: number;
  likes: number;
  comments: number;
  source: string;
  creatorId: string;
  creatorName: string;
}

export default function VideosPage() {
  const { currentClientId, currentClient } = useClients();
  const [rows, setRows] = useState<VideoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<"recent" | "views">("recent");
  const [platform, setPlatform] = useState<"" | "tiktok" | "instagram">("");

  const load = useCallback(async () => {
    if (!currentClientId) return;
    setLoading(true);
    const qs = new URLSearchParams({ clientId: currentClientId, sort });
    if (platform) qs.set("platform", platform);
    const res = await fetch(`/api/videos?${qs}`);
    if (res.ok) setRows(await res.json());
    setLoading(false);
  }, [currentClientId, sort, platform]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <TopBar crumbs={["Analytics", "Videos"]} />
      <div className="px-6 py-6">
        <PageTitle title="Videos" sub={`Every tracked post for ${currentClient?.name ?? "this client"}.`} />

        <div className="mb-3 flex items-center gap-2">
          <Seg value={platform} onChange={setPlatform} options={[["", "All"], ["tiktok", "TikTok"], ["instagram", "Instagram"]]} />
          <div className="ml-auto">
            <Seg value={sort} onChange={setSort} options={[["recent", "Newest"], ["views", "Top views"]]} />
          </div>
        </div>

        <div className="card overflow-hidden">
          <div className="hidden grid-cols-[48px_minmax(240px,2fr)_150px_110px_90px_90px_90px] items-center gap-3 border-b border-[var(--line)] px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--faint)] md:grid">
            <div>Video</div><div>Caption</div><div>Creator</div><div>Posted</div><div>Views</div><div>Likes</div><div>Comments</div>
          </div>
          {loading ? (
            <div className="py-16 text-center text-sm text-[var(--muted)]">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="py-16 text-center text-sm text-[var(--muted)]">No posts tracked yet.</div>
          ) : (
            rows.map((p) => {
              const dt = new Date(p.postedAt);
              return (
                <div key={p.id} className="grid grid-cols-1 items-center gap-2 border-b border-[var(--line2)] px-4 py-2.5 last:border-0 hover:bg-[var(--panel2)] md:grid-cols-[48px_minmax(240px,2fr)_150px_110px_90px_90px_90px] md:gap-3">
                  <VideoThumb url={p.url} thumbnailUrl={p.thumbnailUrl} platform={p.platform} w={40} h={56} />
                  <a href={p.url ?? "#"} target="_blank" rel="noreferrer" className="min-w-0 truncate text-sm hover:text-[var(--signal)]">
                    {p.caption || <span className="text-[var(--faint)]">(no caption)</span>}
                  </a>
                  <Link href={`/creators/${p.creatorId}`} className="truncate text-[13px] text-[var(--muted)] hover:text-[var(--signal)]">{p.creatorName}</Link>
                  <span className="mono text-[12px] text-[var(--muted)]">{dt.toLocaleDateString("en", { month: "short", day: "numeric", year: "2-digit" })}</span>
                  <span className="mono text-[13px]">{fmtNum(p.views)}</span>
                  <span className="mono text-[13px] text-[var(--muted)]">{fmtNum(p.likes)}</span>
                  <span className="mono text-[13px] text-[var(--muted)]">{fmtNum(p.comments)}</span>
                </div>
              );
            })
          )}
        </div>
        {rows.length > 0 && <p className="mt-3 text-xs text-[var(--faint)]">Showing {rows.length} posts.</p>}
      </div>
    </>
  );
}

function Seg<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="inline-flex rounded-lg border border-[var(--line)] bg-[var(--panel)] p-0.5">
      {options.map(([v, label]) => (
        <button key={v} onClick={() => onChange(v)} className={`rounded-md px-3 py-1.5 text-xs font-medium ${value === v ? "bg-[var(--panel2)] text-[var(--ink)]" : "text-[var(--muted)] hover:text-[var(--ink)]"}`}>
          {label}
        </button>
      ))}
    </div>
  );
}
