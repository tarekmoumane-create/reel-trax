"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export interface Series {
  name: string;
  color: string;
  values: (number | null)[];
  area?: boolean;
  /** render as bar columns instead of a line (viral-style "posted videos") */
  bars?: boolean;
  /** per-series value formatter for the tooltip (falls back to chart format) */
  format?: (n: number) => string;
}

const M = { top: 14, right: 14, bottom: 22, left: 46 };

// Mixed-metric chart in the viral.app mold: every series is scaled to its own
// max so views (100K) and posts (5) can share one plot; the y-axis labels
// belong to the first series; hovering shows a floating tooltip with the exact
// value of every series at that x.
export function Chart({
  labels,
  series,
  height = 200,
  format = (n) => `${n}`,
  formatX = (s) => s,
  formatHeader,
}: {
  labels: string[];
  series: Series[];
  height?: number;
  format?: (n: number) => string;
  formatX?: (s: string) => string;
  /** tooltip title for a label (defaults to formatX) */
  formatHeader?: (s: string) => string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(600);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((e) => setW(e[0].contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

  const { maxes, plotW, plotH, xAt, yAt } = useMemo(() => {
    // independent scale per series — the whole point of a mixed chart
    const maxes = series.map((s) => {
      const vals = s.values.filter((v): v is number => v != null);
      return niceMax(vals.length ? Math.max(...vals) : 1);
    });
    const plotW = Math.max(1, w - M.left - M.right);
    const plotH = Math.max(1, height - M.top - M.bottom);
    const n = labels.length;
    const xAt = (i: number) => M.left + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
    const yAt = (v: number, si: number) => M.top + plotH - (v / maxes[si]) * plotH;
    return { maxes, plotW, plotH, xAt, yAt };
  }, [series, labels.length, w, height]);

  function linePath(vals: (number | null)[], si: number) {
    let d = "";
    let pen = false;
    vals.forEach((v, i) => {
      if (v == null) { pen = false; return; }
      d += `${pen ? "L" : "M"}${xAt(i).toFixed(1)} ${yAt(v, si).toFixed(1)} `;
      pen = true;
    });
    return d.trim();
  }
  function areaPath(vals: (number | null)[], si: number) {
    const pts: [number, number][] = [];
    vals.forEach((v, i) => { if (v != null) pts.push([xAt(i), yAt(v, si)]); });
    if (pts.length < 2) return "";
    const base = M.top + plotH;
    let d = `M${pts[0][0].toFixed(1)} ${base}`;
    for (const [x, y] of pts) d += ` L${x.toFixed(1)} ${y.toFixed(1)}`;
    d += ` L${pts[pts.length - 1][0].toFixed(1)} ${base} Z`;
    return d;
  }

  const gridVals = [0, 0.25, 0.5, 0.75, 1];
  const xTickIdx = tickIndexes(labels.length, Math.min(7, Math.max(2, Math.floor(w / 110))));
  const barW = Math.max(3, Math.min(26, (plotW / Math.max(1, labels.length)) * 0.55));
  const base = M.top + plotH;

  // tooltip placement — flips to the left of the guide near the right edge
  const TIP_W = 200;
  const tipLeft =
    hover == null ? 0 : xAt(hover) + 14 + TIP_W > w ? xAt(hover) - 14 - TIP_W : xAt(hover) + 14;

  return (
    <div ref={ref} className="relative w-full">
      <svg
        width={w}
        height={height}
        onMouseMove={(e) => {
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const x = e.clientX - rect.left - M.left;
          const i = Math.round((x / plotW) * (labels.length - 1));
          setHover(Math.max(0, Math.min(labels.length - 1, i)));
        }}
        onMouseLeave={() => setHover(null)}
      >
        {/* gridlines + y labels (labels read on the first series' scale) */}
        {gridVals.map((f, i) => {
          const y = M.top + plotH - f * plotH;
          return (
            <g key={i}>
              <line x1={M.left} x2={w - M.right} y1={y} y2={y} stroke="var(--line)" strokeWidth={1} />
              <text x={M.left - 8} y={y + 3} textAnchor="end" fontSize={10} fill="var(--faint)" className="mono">
                {shortNum(f * (maxes[0] ?? 1))}
              </text>
            </g>
          );
        })}
        {/* x labels */}
        {xTickIdx.map((i) => (
          <text key={i} x={xAt(i)} y={height - 6} textAnchor="middle" fontSize={10} fill="var(--faint)" className="mono">{formatX(labels[i])}</text>
        ))}
        {/* bars first (behind), then areas, then lines */}
        {series.map((s, si) =>
          s.bars
            ? s.values.map((v, i) =>
                v != null && v > 0 ? (
                  <rect
                    key={`b${si}-${i}`}
                    x={xAt(i) - barW / 2}
                    y={yAt(v, si)}
                    width={barW}
                    height={Math.max(1, base - yAt(v, si))}
                    rx={Math.min(3, barW / 2)}
                    fill={s.color}
                    opacity={hover === i ? 0.95 : 0.65}
                  />
                ) : null
              )
            : null
        )}
        {series.map((s, si) => (s.area && !s.bars ? (
          <path key={`a${si}`} d={areaPath(s.values, si)} fill={s.color} opacity={0.12} />
        ) : null))}
        {series.map((s, si) => (!s.bars ? (
          <path key={`l${si}`} d={linePath(s.values, si)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        ) : null))}
        {/* hover guide + markers */}
        {hover != null && (
          <g>
            <line x1={xAt(hover)} x2={xAt(hover)} y1={M.top} y2={base} stroke="var(--faint)" strokeWidth={1} strokeDasharray="3 3" />
            {series.map((s, si) =>
              !s.bars && s.values[hover] != null ? (
                <circle key={si} cx={xAt(hover)} cy={yAt(s.values[hover]!, si)} r={3.5} fill="var(--panel)" stroke={s.color} strokeWidth={2} />
              ) : null
            )}
          </g>
        )}
      </svg>

      {/* floating tooltip — date header + a row per series with its exact value */}
      {hover != null && (
        <div
          className="pointer-events-none absolute z-30 rounded-xl border border-[var(--line)] bg-[var(--panel)] px-3 py-2.5 shadow-xl"
          style={{ left: tipLeft, top: M.top, width: TIP_W }}
        >
          <div className="mb-1.5 text-xs font-semibold">{(formatHeader ?? formatX)(labels[hover])}</div>
          {series.map((s, si) => (
            <div key={si} className="flex items-center gap-2 py-0.5 text-xs">
              <span className="inline-block h-2 w-2 shrink-0 rounded-[3px]" style={{ background: s.color }} />
              <span className="min-w-0 flex-1 truncate text-[var(--muted)]">{s.name}</span>
              <span className="mono font-semibold">
                {s.values[hover] != null ? (s.format ?? format)(s.values[hover]!) : "—"}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* legend */}
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[11px]">
        {series.map((s) => (
          <span key={s.name} className="flex items-center gap-1.5 text-[var(--muted)]">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
      </div>
    </div>
  );
}

function niceMax(n: number): number {
  if (n <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(n)));
  const f = n / p;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nice * p;
}
function shortNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(n % 1_000 ? 1 : 0) + "K";
  return `${Math.round(n)}`;
}
function tickIndexes(n: number, count: number): number[] {
  if (n <= count) return Array.from({ length: n }, (_, i) => i);
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(Math.round((i / (count - 1)) * (n - 1)));
  return [...new Set(out)];
}
