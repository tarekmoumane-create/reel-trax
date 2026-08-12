"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Chart } from "./Chart";
import { VideoThumb } from "./VideoThumb";
import { fmtNum } from "@/lib/ui";

interface Analytics {
  days: number;
  series: { date: string; posts: number; views: number }[];
  followers: { date: string; followers: number | null }[];
  topVideos: { platform: string; url: string | null; caption: string | null; thumbnailUrl: string | null; views: number; likes: number; creatorId: string; creatorName: string }[];
  topCreators: { creatorId: string; name: string; views: number; posts: number }[];
  totals: { posts: number; views: number; followers: number | null; creators: number };
}

const fmtDate = (d: string) => {
  const [, m, day] = d.split("-").map(Number);
  return new Date(2000, m - 1, day).toLocaleDateString("en", { month: "short", day: "numeric" });
};

export function AnalyticsPanel({ clientId }: { clientId: string }) {
  const [data, setData] = useState<Analytics | null>(null);
  const [days, setDays] = useState(30);
  const [metric, setMetric] = useState<"views" | "posts" | "followers">("views");

  const load = useCallback(async () => {
    const res = await fetch(`/api/analytics?clientId=${clientId}&days=${days}`);
    if (res.ok) setData(await res.json());
  }, [clientId, days]);

  useEffect(() => { load(); }, [load]);

  const hasFollowers = (data?.followers?.length ?? 0) > 0;
  useEffect(() => {
    if (metric === "followers" && !hasFollowers) setMetric("views");
  }, [hasFollowers, metric]);

  const chart = useMemo(() => {
    if (!data) return null;
    const labels = data.series.map((s) => s.date);
    if (metric === "views") return { labels, values: data.series.map((s) => s.views), color: "#ec5a35", fmt: fmtNum };
    if (metric === "posts") return { labels, values: data.series.map((s) => s.posts), color: "#2f9464", fmt: (n: number) => `${Math.round(n)}` };
    return { labels: data.followers.map((f) => f.date), values: data.followers.map((f) => f.followers), color: "#c98419", fmt: fmtNum };
  }, [data, metric]);

  if (!data) return <div className="card mb-5 p-5 text-sm text-[var(--muted)]">Loading analytics…</div>;

  const metrics: [typeof metric, string, string][] = [
    ["views", "Views", fmtNum(data.totals.views)],
    ["posts", "Posts", `${data.totals.posts}`],
    ...(hasFollowers ? ([["followers", "Followers", data.totals.followers != null ? fmtNum(data.totals.followers) : "—"]] as [typeof metric, string, string][]) : []),
  ];

  return (
    <div className="mb-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
      {/* chart */}
      <div className="card p-4 lg:col-span-2">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            {metrics.map(([m, label, total]) => (
              <button key={m} onClick={() => setMetric(m)} className={`rounded-lg border px-3 py-1.5 text-left ${metric === m ? "border-[var(--signal)] bg-[var(--panel2)]" : "border-[var(--line)] hover:bg-[var(--panel2)]"}`}>
                <div className="mono text-sm font-bold leading-none">{total}</div>
                <div className="text-[10px] uppercase tracking-wide text-[var(--muted)]">{label}</div>
              </button>
            ))}
          </div>
          <div className="inline-flex rounded-lg border border-[var(--line)] bg-[var(--panel)] p-0.5">
            {[30, 90].map((d) => (
              <button key={d} onClick={() => setDays(d)} className={`rounded-md px-2.5 py-1 text-xs font-medium ${days === d ? "bg-[var(--panel2)] text-[var(--ink)]" : "text-[var(--muted)] hover:text-[var(--ink)]"}`}>{d}d</button>
            ))}
          </div>
        </div>
        {chart && (chart.values.some((v) => v != null && v > 0) ? (
          <Chart labels={chart.labels} series={[{ name: metric[0].toUpperCase() + metric.slice(1), color: chart.color, values: chart.values, area: true }]} format={chart.fmt} formatX={fmtDate} height={210} />
        ) : (
          <div className="grid h-[210px] place-items-center text-sm text-[var(--muted)]">No {metric} data in this range yet.</div>
        ))}
      </div>

      {/* leaderboards */}
      <div className="card flex flex-col p-4 lg:col-span-1">
        <h3 className="mb-2 text-sm font-semibold">Top videos <span className="text-[var(--muted)]">· {days}d</span></h3>
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
        <h3 className="mb-2 mt-4 text-sm font-semibold">Top creators <span className="text-[var(--muted)]">· {days}d</span></h3>
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
