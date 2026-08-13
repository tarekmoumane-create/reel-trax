"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chart, type Series } from "./Chart";
import { VideoThumb } from "./VideoThumb";
import { fmtNum } from "@/lib/ui";

// ---------- metrics ----------

type MetricKey = "views" | "posts" | "likes" | "comments" | "shares" | "followers";

const METRICS: Record<MetricKey, { label: string; color: string; bars?: boolean; stock?: boolean }> = {
  views: { label: "Views", color: "var(--signal)" },
  posts: { label: "Posts", color: "var(--warn)", bars: true },
  likes: { label: "Likes", color: "var(--ig)" },
  comments: { label: "Comments", color: "var(--accent)" },
  shares: { label: "Shares", color: "var(--ok)" },
  // followers is a level, not a flow — never summed, never accumulated
  followers: { label: "Followers", color: "#14b8a6", stock: true },
};
const METRIC_KEYS = Object.keys(METRICS) as MetricKey[];

// ---------- time ranges (viral-style presets + custom) ----------

interface Range { from: string; to: string; label: string }

function dstr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

const PRESETS: { key: string; label: string; range: () => Range }[] = [
  { key: "today", label: "Today", range: () => ({ from: dstr(new Date()), to: dstr(new Date()), label: "Today" }) },
  { key: "yesterday", label: "Yesterday", range: () => ({ from: dstr(daysAgo(1)), to: dstr(daysAgo(1)), label: "Yesterday" }) },
  { key: "7d", label: "Last 7 days", range: () => ({ from: dstr(daysAgo(6)), to: dstr(new Date()), label: "Last 7 days" }) },
  { key: "14d", label: "Last 14 days", range: () => ({ from: dstr(daysAgo(13)), to: dstr(new Date()), label: "Last 14 days" }) },
  { key: "30d", label: "Last 30 days", range: () => ({ from: dstr(daysAgo(29)), to: dstr(new Date()), label: "Last 30 days" }) },
  { key: "90d", label: "Last 90 days", range: () => ({ from: dstr(daysAgo(89)), to: dstr(new Date()), label: "Last 90 days" }) },
  {
    key: "mtd", label: "Month to date",
    range: () => { const n = new Date(); return { from: dstr(new Date(n.getFullYear(), n.getMonth(), 1)), to: dstr(n), label: "Month to date" }; },
  },
  {
    key: "lastmonth", label: "Last month",
    range: () => { const n = new Date(); return { from: dstr(new Date(n.getFullYear(), n.getMonth() - 1, 1)), to: dstr(new Date(n.getFullYear(), n.getMonth(), 0)), label: "Last month" }; },
  },
  {
    key: "ytd", label: "Year to date",
    range: () => { const n = new Date(); return { from: dstr(new Date(n.getFullYear(), 0, 1)), to: dstr(n), label: "Year to date" }; },
  },
];

const fmtDate = (d: string) => {
  const [, m, day] = d.split("-").map(Number);
  return new Date(2000, m - 1, day).toLocaleDateString("en", { month: "short", day: "numeric" });
};
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
  followers: { date: string; followers: number | null }[];
  topVideos: { platform: string; url: string | null; caption: string | null; thumbnailUrl: string | null; views: number; likes: number; creatorId: string; creatorName: string }[];
  topCreators: { creatorId: string; name: string; views: number; posts: number }[];
  totals: { posts: number; views: number; likes: number; comments: number; shares: number; followers: number | null; creators: number };
}

const LS_KEY = "rt-analytics-prefs";

export function AnalyticsPanel({ clientId }: { clientId: string }) {
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

  const hasFollowers = (data?.followers?.length ?? 0) > 0;

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
    const series: Series[] = metrics
      .filter((m) => m !== "followers" || hasFollowers)
      .map((m) => {
        const def = METRICS[m];
        const vals: (number | null)[] = new Array(buckets.length).fill(def.stock ? null : 0);
        for (const row of data.series) {
          const i = idx.get(bucketKey(row.date, agg))!;
          if (def.stock) {
            const f = followersByDate.get(row.date);
            if (f != null) vals[i] = f; // last non-null day wins the bucket
          } else {
            vals[i] = (vals[i] ?? 0) + row[m as Exclude<MetricKey, "followers">];
          }
        }
        if (mode === "cumulative" && !def.stock) {
          let run = 0;
          for (let i = 0; i < vals.length; i++) { run += vals[i] ?? 0; vals[i] = run; }
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
  }, [data, metrics, agg, mode, hasFollowers]);

  if (!data || !chart) return <div className="card mb-5 p-5 text-sm text-[var(--muted)]">Loading analytics…</div>;

  const totalFor = (m: MetricKey): string => {
    if (m === "followers") return data.totals.followers != null ? fmtNum(data.totals.followers) : "—";
    return m === "posts" ? `${data.totals.posts}` : fmtNum(data.totals[m]);
  };
  const hasAny = chart.series.some((s) => s.values.some((v) => v != null && v > 0));

  return (
    <div className="mb-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
      {/* chart */}
      <div className="card p-4 lg:col-span-2">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {/* metric chips + add */}
          <div className="flex flex-wrap items-center gap-1.5">
            {metrics.map((m) => (
              <span key={m} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--panel2)] py-1 pl-2.5 pr-1 text-xs font-medium">
                <span className="h-2 w-2 rounded-[3px]" style={{ background: METRICS[m].color }} />
                {METRICS[m].label}
                <span className="mono text-[var(--muted)]">{totalFor(m)}</span>
                <button
                  onClick={() => { const next = metrics.filter((x) => x !== m); if (next.length) { setMetrics(next); persist({ metrics: next }); } }}
                  disabled={metrics.length === 1}
                  className="grid h-4 w-4 place-items-center rounded text-[var(--faint)] hover:bg-[var(--line)] hover:text-[var(--ink)] disabled:opacity-30"
                  aria-label={`Remove ${METRICS[m].label}`}
                >✕</button>
              </span>
            ))}
            <AddMetricMenu
              available={METRIC_KEYS.filter((m) => !metrics.includes(m) && (m !== "followers" || hasFollowers))}
              onAdd={(m) => { const next = [...metrics, m]; setMetrics(next); persist({ metrics: next }); }}
            />
          </div>

          <div className="flex items-center gap-1.5">
            {/* aggregation */}
            <Segmented
              options={[["day", "D"], ["week", "W"], ["month", "M"]]}
              value={agg}
              onChange={(v) => { setAgg(v as Agg); persist({ agg: v }); }}
              title="Aggregation"
            />
            {/* mode */}
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
            height={210}
          />
        ) : (
          <div className="grid h-[210px] place-items-center text-sm text-[var(--muted)]">No data in this range yet.</div>
        )}
      </div>

      {/* leaderboards */}
      <div className="card flex flex-col p-4 lg:col-span-1">
        <h3 className="mb-2 text-sm font-semibold">Top videos <span className="text-[var(--muted)]">· {range.label}</span></h3>
        <div className="space-y-1">
          {data.topVideos.length === 0 && <p className="py-3 text-xs text-[var(--muted)]">No posts yet.</p>}
          {data.topVideos.slice(0, 4).map((v, i) => (
            <a key={i} href={v.url ?? "#"} target="_blank" rel="noreferrer" className="flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 hover:bg-[var(--panel2)]">
              <VideoThumb url={v.url} thumbnailUrl={v.thumbnailUrl} platform={v.platform} w={28} h={38} asLink={false} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs">{v.caption || <span className="text-[var(--faint)]">(no caption)</span>}</span>
                <span className="block truncate text-[10px] text-[var(--faint)]">{v.creatorName}</span>
              </span>
              <span className="mono shrink-0 text-xs font-semibold">{fmtNum(v.views)}</span>
            </a>
          ))}
        </div>
        <h3 className="mb-2 mt-4 text-sm font-semibold">Top creators <span className="text-[var(--muted)]">· {range.label}</span></h3>
        <div className="space-y-1">
          {data.topCreators.length === 0 && <p className="py-3 text-xs text-[var(--muted)]">No data yet.</p>}
          {data.topCreators.slice(0, 4).map((c, i) => (
            <Link key={c.creatorId} href={`/creators/${c.creatorId}`} className="flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 hover:bg-[var(--panel2)]">
              <span className="mono w-4 text-center text-xs text-[var(--faint)]">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate text-sm">{c.name}</span>
              <span className="mono shrink-0 text-xs text-[var(--muted)]">{c.posts}p</span>
              <span className="mono w-14 shrink-0 text-right text-xs font-semibold">{fmtNum(c.views)}</span>
            </Link>
          ))}
        </div>
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

function RangePicker({ range, onChange }: { range: Range; onChange: (r: Range, presetKey?: string) => void }) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onDoc(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  useEffect(() => { setFrom(range.from); setTo(range.to); }, [range.from, range.to]);

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="btn px-2.5 py-1 text-xs">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
        {range.label}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-1.5 flex w-[290px] overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--panel)] shadow-2xl">
          {/* presets */}
          <div className="max-h-72 w-1/2 overflow-y-auto border-r border-[var(--line2)] py-1">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                onClick={() => { onChange(p.range(), p.key); setOpen(false); }}
                className={`block w-full px-3 py-1.5 text-left text-xs hover:bg-[var(--panel2)] ${range.label === p.label ? "bg-[var(--panel2)] font-semibold" : ""}`}
              >{p.label}</button>
            ))}
          </div>
          {/* custom */}
          <div className="w-1/2 space-y-2 p-2.5">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--faint)]">Custom</div>
            <label className="block text-[10px] text-[var(--muted)]">From
              <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="mt-0.5 w-full px-2 py-1 text-xs" />
            </label>
            <label className="block text-[10px] text-[var(--muted)]">To
              <input type="date" value={to} min={from} max={dstr(new Date())} onChange={(e) => setTo(e.target.value)} className="mt-0.5 w-full px-2 py-1 text-xs" />
            </label>
            <button
              onClick={() => {
                if (!from || !to || from > to) return;
                onChange({ from, to, label: `${fmtDate(from)} – ${fmtDate(to)}` });
                setOpen(false);
              }}
              className="btn btn-primary w-full justify-center py-1 text-xs"
            >Apply</button>
          </div>
        </div>
      )}
    </div>
  );
}
