"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chart, type Series } from "./Chart";
import { VideoThumb } from "./VideoThumb";
import { Avatar } from "./Avatar";
import { Select, CountPicker } from "./Select";
import { RangePicker, PRESETS, fmtRangeDate, type Range } from "./RangePicker";
import { fmtNum } from "@/lib/ui";
import { engagementRate, fmtPct } from "@/lib/engagement";

// ---------- metrics ----------

type MetricKey = "views" | "viewsGained" | "posts" | "likes" | "comments" | "shares" | "followers";

const METRICS: Record<MetricKey, { label: string; color: string; bars?: boolean; stock?: boolean; sparse?: boolean }> = {
  views: { label: "Views", color: "var(--signal)" },
  // day-over-day deltas from sync snapshots — null before tracking began
  viewsGained: { label: "Views gained", color: "#22d3ee", sparse: true },
  posts: { label: "Posts", color: "var(--warn)", bars: true },
  likes: { label: "Likes", color: "var(--ig)" },
  comments: { label: "Comments", color: "var(--accent)" },
  shares: { label: "Shares", color: "var(--ok)" },
  // followers is a level, not a flow — never summed, never accumulated
  followers: { label: "Followers", color: "#14b8a6", stock: true },
};
const METRIC_KEYS = Object.keys(METRICS) as MetricKey[];

const fmtDate = fmtRangeDate;
const fmtDateFull = (d: string) => {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString("en", { month: "long", day: "numeric", year: "numeric" });
};
const fmtMonth = (d: string) => {
  const [y, m] = d.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en", { month: "short", year: "2-digit" });
};

// ---------- aggregation ----------

type Agg = "day" | "week" | "month";
type Mode = "discrete" | "cumulative";

function bucketKey(date: string, agg: Agg): string {
  if (agg === "day") return date;
  const [y, m, d] = date.split("-").map(Number);
  if (agg === "month") return `${y}-${String(m).padStart(2, "0")}-01`;
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7)); // back to Monday
  return dt.toISOString().slice(0, 10);
}

interface Analytics {
  from: string;
  to: string;
  timeZone: string;
  series: { date: string; posts: number; views: number; likes: number; comments: number; shares: number }[];
  viewsGained: { date: string; viewsGained: number | null }[];
  followers: { date: string; followers: number | null }[];
  topVideos: { platform: string; url: string | null; caption: string | null; thumbnailUrl: string | null; views: number; likes: number; comments: number; shares: number; creatorId: string; creatorName: string }[];
  topCreators: { creatorId: string; name: string; views: number; posts: number; engagement: number | null }[];
  totals: { posts: number; views: number; likes: number; comments: number; shares: number; engagement: number | null; viewsGained: number | null; followers: number | null; creators: number };
}

const LS_KEY = "rt-analytics-prefs";

export function AnalyticsPanel({ clientId, onTotals }: { clientId: string; onTotals?: (t: { views: number; engagement: number | null; rangeLabel: string } | null) => void }) {
  const [data, setData] = useState<Analytics | null>(null);
  const [range, setRange] = useState<Range>(() => PRESETS[4].range()); // last 30 days
  const [metrics, setMetrics] = useState<MetricKey[]>(["views", "posts"]);
  const [agg, setAgg] = useState<Agg>("day");
  const [mode, setMode] = useState<Mode>("discrete");

  // restore prefs
  useEffect(() => {
    try {
      const p = JSON.parse(localStorage.getItem(LS_KEY) ?? "");
      if (Array.isArray(p.metrics) && p.metrics.every((m: string) => m in METRICS) && p.metrics.length) setMetrics(p.metrics);
      if (p.agg === "week" || p.agg === "month") setAgg(p.agg);
      if (p.mode === "cumulative") setMode(p.mode);
      const preset = PRESETS.find((x) => x.key === p.preset);
      if (preset) setRange(preset.range());
    } catch {}
  }, []);
  const persist = (patch: Record<string, unknown>) => {
    try {
      const cur = JSON.parse(localStorage.getItem(LS_KEY) ?? "{}");
      localStorage.setItem(LS_KEY, JSON.stringify({ ...cur, ...patch }));
    } catch {}
  };

  const load = useCallback(async () => {
    const res = await fetch(`/api/analytics?clientId=${clientId}&from=${range.from}&to=${range.to}`);
    if (res.ok) setData(await res.json());
  }, [clientId, range.from, range.to]);
  useEffect(() => { load(); }, [load]);

  // surface the range's view total so the page can show it as a KPI
  useEffect(() => {
    onTotals?.(data ? { views: data.totals.views, engagement: data.totals.engagement, rangeLabel: range.label } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, range.label]);

  const hasFollowers = (data?.followers?.length ?? 0) > 0;
  const hasGained = (data?.viewsGained?.length ?? 0) > 0;
  const availableOf = (m: MetricKey) =>
    (m !== "followers" || hasFollowers) && (m !== "viewsGained" || hasGained);

  // bucket + accumulate the daily rows into chart series
  const chart = useMemo(() => {
    if (!data) return null;
    const buckets: string[] = [];
    const seen = new Set<string>();
    for (const row of data.series) {
      const k = bucketKey(row.date, agg);
      if (!seen.has(k)) { seen.add(k); buckets.push(k); }
    }
    const idx = new Map(buckets.map((b, i) => [b, i]));

    const followersByDate = new Map(data.followers.map((f) => [f.date, f.followers]));
    const gainedByDate = new Map(data.viewsGained.map((g) => [g.date, g.viewsGained]));

    const series: Series[] = metrics.filter(availableOf).map((m) => {
      const def = METRICS[m];
      // sparse flows (views gained) start null so untracked days show as gaps
      const vals: (number | null)[] = new Array(buckets.length).fill(def.stock || def.sparse ? null : 0);
      for (const row of data.series) {
        const i = idx.get(bucketKey(row.date, agg))!;
        if (def.stock) {
          const f = followersByDate.get(row.date);
          if (f != null) vals[i] = f; // last non-null day wins the bucket
        } else if (def.sparse) {
          const g = gainedByDate.get(row.date);
          if (g != null) vals[i] = (vals[i] ?? 0) + g;
        } else {
          vals[i] = (vals[i] ?? 0) + row[m as Exclude<MetricKey, "followers" | "viewsGained">];
        }
      }
      if (mode === "cumulative" && !def.stock) {
        let run = 0;
        let started = false;
        for (let i = 0; i < vals.length; i++) {
          if (vals[i] != null) started = true;
          if (started) { run += vals[i] ?? 0; vals[i] = run; }
        }
      }
      return {
        name: def.label,
        color: def.color,
        values: vals,
        bars: def.bars && mode === "discrete",
        area: !def.bars && metrics.length === 1,
        format: m === "posts" ? (n: number) => `${Math.round(n)}` : fmtNum,
      };
    });

    const formatHeader = (label: string) =>
      agg === "month"
        ? new Date(label + "T12:00:00Z").toLocaleDateString("en", { month: "long", year: "numeric" })
        : agg === "week"
          ? `Week of ${fmtDate(label)}`
          : fmtDateFull(label);

    return { labels: buckets, series, formatHeader, formatX: agg === "month" ? fmtMonth : fmtDate };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, metrics, agg, mode, hasFollowers, hasGained]);

  if (!data || !chart) return <div className="card mb-5 p-5 text-sm text-[var(--muted)]">Loading analytics…</div>;

  const totalFor = (m: MetricKey): string => {
    if (m === "followers") return data.totals.followers != null ? fmtNum(data.totals.followers) : "—";
    if (m === "viewsGained") return data.totals.viewsGained != null ? fmtNum(data.totals.viewsGained) : "—";
    return m === "posts" ? `${data.totals.posts}` : fmtNum(data.totals[m]);
  };
  const hasAny = chart.series.some((s) => s.values.some((v) => v != null && v > 0));

  return (
    <div className="mb-5 space-y-4">
      {/* metrics chart — full width, viral-style */}
      <div className="card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {/* metric chips + add */}
          <div className="flex flex-wrap items-center gap-1.5">
            {metrics.filter(availableOf).map((m) => (
              <span key={m} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--panel2)] py-1 pl-2.5 pr-1 text-xs font-medium">
                <span className="h-2 w-2 rounded-[3px]" style={{ background: METRICS[m].color }} />
                {METRICS[m].label}
                <span className="mono font-semibold">{totalFor(m)}</span>
                <button
                  onClick={() => { const next = metrics.filter((x) => x !== m); if (next.length) { setMetrics(next); persist({ metrics: next }); } }}
                  disabled={metrics.length === 1}
                  className="grid h-4 w-4 place-items-center rounded text-[var(--faint)] hover:bg-[var(--line)] hover:text-[var(--ink)] disabled:opacity-30"
                  aria-label={`Remove ${METRICS[m].label}`}
                >✕</button>
              </span>
            ))}
            <AddMetricMenu
              available={METRIC_KEYS.filter((m) => !metrics.includes(m) && availableOf(m))}
              onAdd={(m) => { const next = [...metrics, m]; setMetrics(next); persist({ metrics: next }); }}
            />
          </div>

          <div className="flex items-center gap-1.5">
            <Segmented
              options={[["day", "D"], ["week", "W"], ["month", "M"]]}
              value={agg}
              onChange={(v) => { setAgg(v as Agg); persist({ agg: v }); }}
              title="Aggregation"
            />
            <Segmented
              options={[["discrete", "Discrete"], ["cumulative", "Cumulative"]]}
              value={mode}
              onChange={(v) => { setMode(v as Mode); persist({ mode: v }); }}
              title="Mode"
            />
            <RangePicker range={range} onChange={(r, presetKey) => { setRange(r); persist({ preset: presetKey ?? null }); }} />
          </div>
        </div>

        {hasAny ? (
          <Chart
            labels={chart.labels}
            series={chart.series}
            format={fmtNum}
            formatX={chart.formatX}
            formatHeader={(l) => `${chart.formatHeader(l)}`}
            height={280}
          />
        ) : (
          <div className="grid h-[280px] place-items-center text-sm text-[var(--muted)]">No data in this range yet.</div>
        )}
      </div>

      {/* leaderboards below the chart, viral-style */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TopVideosCard videos={data.topVideos} rangeLabel={range.label} />
        <TopCreatorsCard creators={data.topCreators} rangeLabel={range.label} />
      </div>
    </div>
  );
}

// ---------- leaderboards ----------

const PLATFORM_LABEL: Record<string, string> = { tiktok: "TikTok", instagram: "Instagram", youtube: "YouTube", threads: "Threads", facebook: "Facebook" };
const PLATFORM_ORDER = ["tiktok", "instagram", "youtube", "threads", "facebook"];

type VideoSort = "views" | "likes" | "comments" | "engagement";
type TopVideo = Analytics["topVideos"][number];
// what a video is ranked by; a video with no view count has no engagement rate
const videoRank = (v: TopVideo, by: VideoSort) => (by === "engagement" ? engagementRate(v) ?? -1 : v[by]);

function TopVideosCard({ videos, rangeLabel }: { videos: Analytics["topVideos"]; rangeLabel: string }) {
  const [sortBy, setSortBy] = useState<VideoSort>("views");
  const [platform, setPlatform] = useState("");
  const [count, setCount] = useState(5);
  // Only offer platforms that actually have posts in this range.
  const platforms = useMemo(() => {
    const present = new Set(videos.map((v) => v.platform));
    return PLATFORM_ORDER.filter((p) => present.has(p));
  }, [videos]);
  const pool = useMemo(() => (platform ? videos.filter((v) => v.platform === platform) : videos), [videos, platform]);
  const rows = useMemo(
    () => [...pool].sort((a, b) => videoRank(b, sortBy) - videoRank(a, sortBy)).slice(0, count),
    [pool, sortBy, count]
  );
  const threadsByViews = platform === "threads" && sortBy === "views";
  return (
    <div className="card p-4">
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Top videos <span className="font-normal text-[var(--muted)]">· {rangeLabel}</span></h3>
        <div className="flex items-center gap-1.5">
          {platforms.length > 1 && (
            <Select
              size="sm"
              align="right"
              value={platform}
              onChange={(v) => { setPlatform(v); if (v === "threads" && sortBy === "views") setSortBy("likes"); }}
              options={[["", "All platforms"], ...platforms.map((p) => [p, PLATFORM_LABEL[p] ?? p] as [string, string])]}
            />
          )}
          <Select size="sm" align="right" value={sortBy} onChange={(v) => setSortBy(v as VideoSort)} options={[["views", "Views"], ["likes", "Likes"], ["comments", "Comments"], ["engagement", "Engagement"]]} />
          <CountPicker value={count} onChange={setCount} max={pool.length || 1} />
        </div>
      </div>
      {rows.length === 0 && <p className="py-6 text-center text-xs text-[var(--muted)]">No posts in this range.</p>}
      {threadsByViews && <p className="mb-1.5 text-[12.5px] text-[var(--faint)]">Threads doesn&apos;t report view counts — sort by likes or comments.</p>}
      <div className="space-y-0.5">
        {rows.map((v, i) => (
          <a key={v.url ?? `${v.creatorId}-${i}`} href={v.url ?? "#"} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-lg px-1.5 py-1.5 hover:bg-[var(--panel2)]">
            <span className="mono w-4 shrink-0 text-center text-xs text-[var(--faint)]">{i + 1}</span>
            <VideoThumb url={v.url} thumbnailUrl={v.thumbnailUrl} platform={v.platform} w={30} h={42} asLink={false} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium">{v.caption || <span className="font-normal text-[var(--faint)]">(no caption)</span>}</span>
              <span className="block truncate text-[12.5px] text-[var(--faint)]">{v.creatorName}</span>
            </span>
            <span className="mono shrink-0 text-xs font-semibold">{fmtNum(sortBy === "engagement" ? v.views : v[sortBy])}</span>
            <span className="mono w-14 shrink-0 text-right text-xs font-semibold" title="Engagement rate: likes + comments + shares, divided by views">{fmtPct(engagementRate(v))}</span>
          </a>
        ))}
      </div>
    </div>
  );
}

function TopCreatorsCard({ creators, rangeLabel }: { creators: Analytics["topCreators"]; rangeLabel: string }) {
  const [sortBy, setSortBy] = useState<"views" | "posts" | "engagement">("views");
  const [count, setCount] = useState(5);
  const rows = useMemo(
    () => [...creators].sort((a, b) => (b[sortBy] ?? -1) - (a[sortBy] ?? -1)).slice(0, count),
    [creators, sortBy, count]
  );
  return (
    <div className="card p-4">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Top creators <span className="font-normal text-[var(--muted)]">· {rangeLabel}</span></h3>
        <div className="flex items-center gap-1.5">
          <Select size="sm" align="right" value={sortBy} onChange={(v) => setSortBy(v as "views" | "posts" | "engagement")} options={[["views", "Views"], ["posts", "Posts"], ["engagement", "Engagement"]]} />
          <CountPicker value={count} onChange={setCount} max={creators.length || 1} />
        </div>
      </div>
      {rows.length === 0 && <p className="py-6 text-center text-xs text-[var(--muted)]">No data in this range.</p>}
      <div className="space-y-0.5">
        {rows.map((c, i) => (
          <Link key={c.creatorId} href={`/creators/${c.creatorId}`} className="flex items-center gap-3 rounded-lg px-1.5 py-1.5 hover:bg-[var(--panel2)]">
            <span className="mono w-4 shrink-0 text-center text-xs text-[var(--faint)]">{i + 1}</span>
            <Avatar name={c.name} creatorId={c.creatorId} size={30} />
            <span className="min-w-0 flex-1 truncate text-sm">{c.name}</span>
            <span className="mono shrink-0 text-xs">{c.posts} {c.posts === 1 ? "post" : "posts"}</span>
            <span className="mono w-14 shrink-0 text-right text-xs font-semibold" title="Views">{fmtNum(c.views)}</span>
            <span className="mono w-14 shrink-0 text-right text-xs font-semibold" title="Engagement rate: likes + comments + shares, divided by views">{fmtPct(c.engagement)}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

// ---------- small controls ----------

function Segmented({ options, value, onChange, title }: { options: [string, string][]; value: string; onChange: (v: string) => void; title?: string }) {
  return (
    <div className="inline-flex rounded-lg border border-[var(--line)] bg-[var(--panel)] p-0.5" title={title}>
      {options.map(([v, label]) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={`rounded-md px-2 py-1 text-xs font-medium ${value === v ? "bg-[var(--panel2)] text-[var(--ink)]" : "text-[var(--muted)] hover:text-[var(--ink)]"}`}
        >{label}</button>
      ))}
    </div>
  );
}

function AddMetricMenu({ available, onAdd }: { available: MetricKey[]; onAdd: (m: MetricKey) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onDoc(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  if (available.length === 0) return null;
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="rounded-lg border border-dashed border-[var(--line)] px-2.5 py-1 text-xs font-medium text-[var(--muted)] hover:border-[var(--signal)] hover:text-[var(--ink)]">
        + Add
      </button>
      {open && (
        <div className="absolute left-0 z-40 mt-1.5 w-44 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--panel)] py-1 shadow-2xl">
          {available.map((m) => (
            <button key={m} onClick={() => { onAdd(m); setOpen(false); }} className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm hover:bg-[var(--panel2)]">
              <span className="h-2 w-2 rounded-[3px]" style={{ background: METRICS[m].color }} />
              {METRICS[m].label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

