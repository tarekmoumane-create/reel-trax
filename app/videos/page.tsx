"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useClients } from "../providers";
import { TopBar, PageTitle } from "@/components/PageHeader";
import { VideoThumb } from "@/components/VideoThumb";
import { fmtNum } from "@/lib/ui";
import { parsePayExclusions, PAY_COMPONENTS, type PayComponent, type PayExclusion } from "@/lib/payouts";

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
  payExclusions: string | null;
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

  async function saveExclusions(id: string, list: PayExclusion[]) {
    // optimistic — the menu closes instantly, the PATCH lands behind it
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, payExclusions: list.length ? JSON.stringify(list) : null } : r)));
    await fetch(`/api/videos/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payExclusions: list }),
    });
  }

  const grid = "md:grid-cols-[48px_minmax(220px,2fr)_140px_100px_84px_84px_84px_112px]";

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

        {/* no overflow clipping — the per-row pay menu needs to escape the card */}
        <div className="card">
          <div className={`hidden ${grid} items-center gap-3 border-b border-[var(--line)] px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--faint)] md:grid`}>
            <div>Video</div><div>Caption</div><div>Creator</div><div>Posted</div><div>Views</div><div>Likes</div><div>Comments</div><div>Pay</div>
          </div>
          {loading ? (
            <div className="py-16 text-center text-sm text-[var(--muted)]">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="py-16 text-center text-sm text-[var(--muted)]">No posts tracked yet.</div>
          ) : (
            rows.map((p) => {
              const dt = new Date(p.postedAt);
              return (
                <div key={p.id} className={`grid grid-cols-1 items-center gap-2 border-b border-[var(--line2)] px-4 py-2.5 last:border-0 hover:bg-[var(--panel2)] ${grid} md:gap-3`}>
                  <VideoThumb url={p.url} thumbnailUrl={p.thumbnailUrl} platform={p.platform} w={40} h={56} />
                  <a href={p.url ?? "#"} target="_blank" rel="noreferrer" className="min-w-0 truncate text-sm hover:text-[var(--signal)]">
                    {p.caption || <span className="text-[var(--faint)]">(no caption)</span>}
                  </a>
                  <Link href={`/creators/${p.creatorId}`} className="truncate text-[13px] text-[var(--muted)] hover:text-[var(--signal)]">{p.creatorName}</Link>
                  <span className="mono text-[12px] text-[var(--muted)]">{dt.toLocaleDateString("en", { month: "short", day: "numeric", year: "2-digit" })}</span>
                  <span className="mono text-[13px]">{fmtNum(p.views)}</span>
                  <span className="mono text-[13px] text-[var(--muted)]">{fmtNum(p.likes)}</span>
                  <span className="mono text-[13px] text-[var(--muted)]">{fmtNum(p.comments)}</span>
                  <PayFlagsMenu exclusions={parsePayExclusions(p.payExclusions)} onChange={(list) => saveExclusions(p.id, list)} />
                </div>
              );
            })
          )}
        </div>
        {rows.length > 0 && <p className="mt-3 text-xs text-[var(--faint)]">Showing {rows.length} posts. The Pay column controls which pay rules each video counts toward.</p>}
      </div>
    </>
  );
}

const COMPONENT_LABEL: Record<PayComponent, string> = {
  perPost: "Per-post fee",
  cpm: "CPM / view pay",
  tiers: "View bonuses",
};

function paySummary(ex: PayExclusion[]): { label: string; tone: string } {
  if (ex.includes("all")) return { label: "Excluded", tone: "text-[var(--bad)]" };
  if (ex.length === 0) return { label: "Counts", tone: "text-[var(--muted)]" };
  const short: Record<PayComponent, string> = { perPost: "post fee", cpm: "CPM", tiers: "bonuses" };
  return { label: `No ${ex.map((e) => short[e as PayComponent]).join(", ")}`, tone: "text-[var(--warn)]" };
}

function PayFlagsMenu({ exclusions, onChange }: { exclusions: PayExclusion[]; onChange: (list: PayExclusion[]) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onDoc(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const all = exclusions.includes("all");
  const { label, tone } = paySummary(exclusions);

  function toggleComponent(c: PayComponent) {
    const cur = exclusions.filter((e) => e !== "all");
    onChange(cur.includes(c) ? cur.filter((e) => e !== c) : [...cur, c]);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex w-full items-center justify-between gap-1.5 rounded-lg border px-2 py-1 text-[11px] font-medium hover:border-[var(--signal)] ${open ? "border-[var(--signal)]" : "border-[var(--line)]"} ${tone}`}
      >
        <span className="truncate">{label}</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" className="shrink-0 text-[var(--faint)]">
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-1.5 w-52 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--panel)] py-1 shadow-2xl">
          <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--faint)]">Counts toward</div>
          {PAY_COMPONENTS.map((c) => {
            const counts = !all && !exclusions.includes(c);
            return (
              <button
                key={c}
                disabled={all}
                onClick={() => toggleComponent(c)}
                className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs hover:bg-[var(--panel2)] disabled:opacity-40"
              >
                {COMPONENT_LABEL[c]}
                <span className={`grid h-4 w-4 place-items-center rounded border ${counts ? "border-[var(--signal)] bg-[var(--signal)] text-white" : "border-[var(--line)]"}`}>
                  {counts && (
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  )}
                </span>
              </button>
            );
          })}
          <div className="mt-1 border-t border-[var(--line2)] p-1">
            <button
              onClick={() => { onChange(all ? [] : ["all"]); setOpen(false); }}
              className={`w-full rounded-lg px-2 py-1.5 text-left text-xs font-medium ${all ? "text-[var(--ok)] hover:bg-[var(--panel2)]" : "text-[var(--bad)] hover:bg-[color:rgba(242,104,95,0.1)]"}`}
            >
              {all ? "Include in pay again" : "Exclude from all pay"}
            </button>
          </div>
        </div>
      )}
    </div>
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
