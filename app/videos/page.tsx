"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useClients } from "../providers";
import { TopBar, PageTitle } from "@/components/PageHeader";
import { VideoThumb } from "@/components/VideoThumb";
import { fmtNum } from "@/lib/ui";
import { parsePayExclusions } from "@/lib/payouts";
import { VideoPayMenu, type VideoPayPatch } from "@/components/VideoPayMenu";
import { CrossPostMenu } from "@/components/CrossPostMenu";
import { RangePicker, PRESETS, type Range } from "@/components/RangePicker";
import { Select } from "@/components/Select";
import { downloadCsv, openInSheets, type SheetTable } from "@/lib/sheet";

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
  isWarmUp: boolean;
  payOverride: number | null;
  groupKey: string | null;
  groupPinned: boolean;
  groupSize: number;
  creatorId: string;
  creatorName: string;
}

const PLATFORM_LABEL: Record<string, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  youtube: "YouTube",
  threads: "Threads",
  facebook: "Facebook",
};

// The page shows this many; an export re-queries for everything that matches.
const PAGE_LIMIT = 200;
const EXPORT_LIMIT = 5000;
const VIEW_PRESETS: [number, string][] = [[1000, "1K+"], [10000, "10K+"], [100000, "100K+"]];

type ExportState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; table: SheetTable; copied: boolean }
  | { status: "error"; message: string };

export default function VideosPage() {
  const { currentClientId, currentClient } = useClients();
  const [rows, setRows] = useState<VideoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<"recent" | "views">("recent");
  const [platform, setPlatform] = useState<"" | "tiktok" | "instagram" | "youtube" | "threads" | "facebook">("");
  // null = all time (the default); otherwise videos posted inside the window
  const [range, setRange] = useState<Range | null>(null);
  // Typed value vs. the one the query uses — debounced so each keystroke
  // doesn't refetch.
  const [minViewsInput, setMinViewsInput] = useState("");
  const [minViews, setMinViews] = useState(0);
  const [creatorId, setCreatorId] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [creators, setCreators] = useState<{ id: string; displayName: string }[]>([]);
  const [campaigns, setCampaigns] = useState<{ id: string; name: string }[]>([]);
  // Selection and a prepared export both belong to the list they were made
  // from. Stamping them with that list's query means a changed filter drops
  // them on the next render, so nobody exports videos they can no longer see.
  const [selection, setSelection] = useState<{ q: string; ids: Set<string> }>({ q: "", ids: new Set() });
  const [expState, setExpState] = useState<{ q: string; state: ExportState }>({ q: "", state: { status: "idle" } });

  useEffect(() => {
    const t = setTimeout(() => setMinViews(Math.max(0, Math.floor(Number(minViewsInput) || 0))), 400);
    return () => clearTimeout(t);
  }, [minViewsInput]);

  // Filter pickers are per client.
  useEffect(() => {
    if (!currentClientId) return;
    let live = true;
    Promise.all([
      fetch(`/api/creators?clientId=${currentClientId}`).then((r) => (r.ok ? r.json() : [])),
      fetch(`/api/campaigns?clientId=${currentClientId}`).then((r) => (r.ok ? r.json() : [])),
    ]).then(([cr, ca]) => {
      if (!live) return;
      setCreators(Array.isArray(cr) ? cr.map((c: { id: string; displayName: string }) => ({ id: c.id, displayName: c.displayName })) : []);
      setCampaigns(Array.isArray(ca) ? ca.map((c: { id: string; name: string }) => ({ id: c.id, name: c.name })) : []);
    });
    return () => { live = false; };
  }, [currentClientId]);

  const query = useCallback(
    (limit: number) => {
      const qs = new URLSearchParams({ clientId: currentClientId ?? "", sort, limit: String(limit) });
      if (platform) qs.set("platform", platform);
      if (range) { qs.set("from", range.from); qs.set("to", range.to); }
      if (minViews) qs.set("minViews", String(minViews));
      if (creatorId) qs.set("creatorId", creatorId);
      if (campaignId) qs.set("campaignId", campaignId);
      return `/api/videos?${qs}`;
    },
    [currentClientId, sort, platform, range, minViews, creatorId, campaignId]
  );

  const queryKey = query(PAGE_LIMIT);
  const selected = selection.q === queryKey ? selection.ids : new Set<string>();
  const exp: ExportState = expState.q === queryKey ? expState.state : { status: "idle" };
  const setSelected = (ids: Set<string>) => setSelection({ q: queryKey, ids });
  const setExp = (state: ExportState) => setExpState({ q: queryKey, state });

  const load = useCallback(async () => {
    if (!currentClientId) return;
    setLoading(true);
    const res = await fetch(query(PAGE_LIMIT));
    if (res.ok) setRows(await res.json());
    setLoading(false);
  }, [currentClientId, query]);

  useEffect(() => {
    load();
  }, [load]);

  async function savePay(id: string, patch: VideoPayPatch) {
    // optimistic — the menu updates instantly, the PATCH lands behind it
    setRows((rs) => rs.map((r) => {
      if (r.id !== id) return r;
      const next = { ...r };
      if (patch.payExclusions) next.payExclusions = patch.payExclusions.length ? JSON.stringify(patch.payExclusions) : null;
      if ("isWarmUp" in patch) next.isWarmUp = !!patch.isWarmUp;
      if ("payOverride" in patch) next.payOverride = patch.payOverride ?? null;
      return next;
    }));
    await fetch(`/api/videos/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  }

  function toggle(id: string) {
    setExp({ status: "idle" });
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }
  const allVisibleSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  function toggleAll() {
    setExp({ status: "idle" });
    setSelected(allVisibleSelected ? new Set() : new Set(rows.map((r) => r.id)));
  }

  const filtered = Boolean(platform || range || minViews || creatorId || campaignId);
  function clearFilters() {
    setPlatform("");
    setRange(null);
    setMinViewsInput("");
    setMinViews(0);
    setCreatorId("");
    setCampaignId("");
  }

  function sheetTitle(count: number) {
    const bits = [currentClient?.name ?? "Videos"];
    if (campaignId) bits.push(campaigns.find((c) => c.id === campaignId)?.name ?? "");
    if (creatorId) bits.push(creators.find((c) => c.id === creatorId)?.displayName ?? "");
    if (platform) bits.push(PLATFORM_LABEL[platform]);
    if (minViews) bits.push(`${fmtNum(minViews)}+ views`);
    if (range) bits.push(range.label);
    return `${bits.filter(Boolean).join(" · ")} (${count})`;
  }

  // Building the table can need a fetch, and a popup opened after an await is
  // blocked — so preparing and opening are two clicks, like on Discover.
  async function prepareExport() {
    setExp({ status: "loading" });
    try {
      let list: VideoRow[];
      if (selected.size) {
        list = rows.filter((r) => selected.has(r.id));
      } else {
        const res = await fetch(query(EXPORT_LIMIT));
        if (!res.ok) throw new Error("Couldn't load the videos to export.");
        list = await res.json();
      }
      const table: SheetTable = {
        title: sheetTitle(list.length),
        headers: ["Creator", "Platform", "Posted", "Views", "Likes", "Comments", "Caption", "Link"],
        rows: list.map((v) => [
          v.creatorName,
          PLATFORM_LABEL[v.platform] ?? v.platform,
          v.postedAt.slice(0, 10),
          String(v.views),
          String(v.likes),
          String(v.comments),
          v.caption ?? "",
          v.url ?? "",
        ]),
      };
      setExp({ status: "ready", table, copied: false });
    } catch (e) {
      setExp({ status: "error", message: e instanceof Error ? e.message : "Export failed" });
    }
  }

  // the picker always needs a concrete range — on "all time" it only supplies
  // sensible defaults for the custom From/To inputs
  const pickerRange: Range = range ?? { ...PRESETS[4].range(), label: "All time" };

  const grid = "md:grid-cols-[18px_44px_minmax(180px,2fr)_128px_88px_74px_74px_74px_104px_108px]";
  const checkbox = "h-3.5 w-3.5 cursor-pointer accent-[var(--signal)]";
  const exportLabel = selected.size ? `Export ${selected.size} selected` : filtered ? "Export all matching" : "Export all videos";

  return (
    <>
      <TopBar crumbs={["Analytics", "Videos"]} />
      <div className="px-6 py-6">
        <PageTitle title="Videos" sub={`Every tracked post for ${currentClient?.name ?? "this client"}.`} />

        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Seg value={platform} onChange={setPlatform} options={[["", "All"], ["tiktok", "TikTok"], ["instagram", "Instagram"], ["youtube", "YouTube"], ["threads", "Threads"], ["facebook", "Facebook"]]} />
          <div className="ml-auto flex items-center gap-2">
            <RangePicker
              range={pickerRange}
              onChange={(r) => setRange(r)}
              onAllTime={() => setRange(null)}
              allTimeActive={!range}
            />
            <Seg value={sort} onChange={setSort} options={[["recent", "Newest"], ["views", "Top views"]]} />
          </div>
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-1 rounded-lg border border-[var(--line)] bg-[var(--panel)] p-0.5 pl-2.5">
            <span className="text-xs text-[var(--muted)]">Min views</span>
            <input
              type="number"
              min={0}
              value={minViewsInput}
              onChange={(e) => setMinViewsInput(e.target.value)}
              placeholder="any"
              className="mono w-20 border-0 bg-transparent px-1.5 py-1 text-xs"
            />
            {VIEW_PRESETS.map(([n, label]) => (
              <button
                key={n}
                onClick={() => { setMinViewsInput(String(n)); setMinViews(n); }}
                className={`rounded-md px-2 py-1 text-xs font-medium ${minViews === n ? "bg-[var(--panel2)] text-[var(--ink)]" : "text-[var(--muted)] hover:text-[var(--ink)]"}`}
              >
                {label}
              </button>
            ))}
          </div>
          {campaigns.length > 1 && (
            <Select
              size="sm"
              value={campaignId}
              onChange={setCampaignId}
              options={[["", "All campaigns"] as [string, string], ...campaigns.map((c) => [c.id, c.name] as [string, string])]}
            />
          )}
          {creators.length > 1 && (
            <Select
              size="sm"
              value={creatorId}
              onChange={setCreatorId}
              options={[["", "All creators"] as [string, string], ...creators.map((c) => [c.id, c.displayName] as [string, string])]}
            />
          )}
          {filtered && (
            <button onClick={clearFilters} className="text-xs text-[var(--muted)] hover:text-[var(--ink)]">Clear filters</button>
          )}

          <div className="ml-auto flex flex-wrap items-center gap-2">
            {exp.status === "ready" ? (
              <>
                <span className="text-[11px] text-[var(--faint)]">
                  {exp.copied ? "Copied — paste into the new sheet with ⌘V." : `${exp.table.rows.length} videos ready.`}
                </span>
                <button
                  onClick={() => { openInSheets(exp.table); setExp({ ...exp, copied: true }); }}
                  className="btn btn-primary px-2.5 py-1 text-xs"
                >
                  Open in Google Sheets ↗
                </button>
                <button onClick={() => downloadCsv(exp.table, "videos")} className="btn px-2.5 py-1 text-xs">Download CSV</button>
                <button onClick={() => setExp({ status: "idle" })} className="text-xs text-[var(--faint)] hover:text-[var(--ink)]" title="Cancel">✕</button>
              </>
            ) : (
              <>
                {exp.status === "error" && <span className="text-[11px] text-[var(--bad)]">{exp.message}</span>}
                <button
                  onClick={prepareExport}
                  disabled={exp.status === "loading" || rows.length === 0}
                  className="btn px-2.5 py-1 text-xs disabled:opacity-50"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3h18v18H3zM3 9h18M9 9v12M15 9v12" /></svg>
                  {exp.status === "loading" ? "Preparing…" : exportLabel}
                </button>
              </>
            )}
          </div>
        </div>

        {/* no overflow clipping — the per-row pay menu needs to escape the card */}
        <div className="card">
          <div className={`hidden ${grid} items-center gap-3 border-b border-[var(--line)] px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--faint)] md:grid`}>
            <input type="checkbox" className={checkbox} checked={allVisibleSelected} onChange={toggleAll} title="Select all shown" />
            <div>Video</div><div>Caption</div><div>Creator</div><div>Posted</div><div>Views</div><div>Likes</div><div>Comments</div><div>Cross-post</div><div>Pay</div>
          </div>
          {loading ? (
            <div className="py-16 text-center text-sm text-[var(--muted)]">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="py-16 text-center text-sm text-[var(--muted)]">
              {filtered ? "No videos match these filters." : "No posts tracked yet."}
            </div>
          ) : (
            rows.map((p) => {
              const dt = new Date(p.postedAt);
              return (
                <div key={p.id} className={`grid grid-cols-1 items-center gap-2 border-b border-[var(--line2)] px-4 py-2.5 last:border-0 hover:bg-[var(--panel2)] ${grid} md:gap-3 ${selected.has(p.id) ? "bg-[var(--panel2)]" : ""}`}>
                  <input type="checkbox" className={checkbox} checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
                  <VideoThumb url={p.url} thumbnailUrl={p.thumbnailUrl} platform={p.platform} w={40} h={56} />
                  <a href={p.url ?? "#"} target="_blank" rel="noreferrer" className="min-w-0 truncate text-sm hover:text-[var(--signal)]">
                    {p.caption || <span className="text-[var(--faint)]">(no caption)</span>}
                  </a>
                  <Link href={`/creators/${p.creatorId}`} className="truncate text-[13px] text-[var(--muted)] hover:text-[var(--signal)]">{p.creatorName}</Link>
                  <span className="mono text-[12px] text-[var(--muted)]">{dt.toLocaleDateString("en", { month: "short", day: "numeric", year: "2-digit" })}</span>
                  <span className="mono text-[13px]">{fmtNum(p.views)}</span>
                  <span className="mono text-[13px] text-[var(--muted)]">{fmtNum(p.likes)}</span>
                  <span className="mono text-[13px] text-[var(--muted)]">{fmtNum(p.comments)}</span>
                  <CrossPostMenu
                    postId={p.id}
                    platform={p.platform}
                    groupSize={p.groupSize}
                    groupPinned={p.groupPinned}
                    onChanged={load}
                  />
                  <VideoPayMenu
                    value={{ exclusions: parsePayExclusions(p.payExclusions), isWarmUp: p.isWarmUp, payOverride: p.payOverride }}
                    onChange={(patch) => savePay(p.id, patch)}
                  />
                </div>
              );
            })
          )}
        </div>
        {rows.length > 0 && (
          <p className="mt-3 text-xs text-[var(--faint)]">
            Showing {rows.length === PAGE_LIMIT ? `the first ${PAGE_LIMIT}` : rows.length} videos
            {rows.length === PAGE_LIMIT && !selected.size ? " — export includes every match, not just these" : ""}.
            {" "}Tick videos to export only those. The Pay column sets what each video earns; Cross-post shows which posts are the same original.
          </p>
        )}
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
