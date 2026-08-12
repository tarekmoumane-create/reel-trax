"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export interface Series {
  name: string;
  color: string;
  values: (number | null)[];
  area?: boolean;
}

const M = { top: 14, right: 14, bottom: 22, left: 46 };

export function Chart({
  labels,
  series,
  height = 200,
  format = (n) => `${n}`,
  formatX = (s) => s,
}: {
  labels: string[];
  series: Series[];
  height?: number;
  format?: (n: number) => string;
  formatX?: (s: string) => string;
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

  const { max, plotW, plotH, xAt, yAt } = useMemo(() => {
    const all = series.flatMap((s) => s.values).filter((v): v is number => v != null);
    const rawMax = all.length ? Math.max(...all) : 1;
    const max = niceMax(rawMax);
    const plotW = Math.max(1, w - M.left - M.right);
    const plotH = Math.max(1, height - M.top - M.bottom);
    const n = labels.length;
    const xAt = (i: number) => M.left + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
    const yAt = (v: number) => M.top + plotH - (v / max) * plotH;
    return { max, plotW, plotH, xAt, yAt };
  }, [series, labels.length, w, height]);

  function linePath(vals: (number | null)[]) {
    let d = "";
    let pen = false;
    vals.forEach((v, i) => {
      if (v == null) { pen = false; return; }
      d += `${pen ? "L" : "M"}${xAt(i).toFixed(1)} ${yAt(v).toFixed(1)} `;
      pen = true;
    });
    return d.trim();
  }
  function areaPath(vals: (number | null)[]) {
    const pts: [number, number][] = [];
    vals.forEach((v, i) => { if (v != null) pts.push([xAt(i), yAt(v)]); });
    if (pts.length < 2) return "";
    const base = M.top + plotH;
    let d = `M${pts[0][0].toFixed(1)} ${base}`;
    for (const [x, y] of pts) d += ` L${x.toFixed(1)} ${y.toFixed(1)}`;
    d += ` L${pts[pts.length - 1][0].toFixed(1)} ${base} Z`;
    return d;
  }

  const gridVals = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const xTickIdx = tickIndexes(labels.length, 5);

  return (
    <div ref={ref} className="w-full">
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
        {/* gridlines + y labels */}
        {gridVals.map((v, i) => (
          <g key={i}>
            <line x1={M.left} x2={w - M.right} y1={yAt(v)} y2={yAt(v)} stroke="var(--line)" strokeWidth={1} />
            <text x={M.left - 8} y={yAt(v) + 3} textAnchor="end" fontSize={10} fill="var(--faint)" className="mono">{shortNum(v)}</text>
          </g>
        ))}
        {/* x labels */}
        {xTickIdx.map((i) => (
          <text key={i} x={xAt(i)} y={height - 6} textAnchor="middle" fontSize={10} fill="var(--faint)" className="mono">{formatX(labels[i])}</text>
        ))}
        {/* areas then lines */}
        {series.map((s, si) => s.area ? (
          <path key={`a${si}`} d={areaPath(s.values)} fill={s.color} opacity={0.12} />
        ) : null)}
        {series.map((s, si) => (
          <path key={`l${si}`} d={linePath(s.values)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {/* hover */}
        {hover != null && (
          <g>
            <line x1={xAt(hover)} x2={xAt(hover)} y1={M.top} y2={M.top + plotH} stroke="var(--faint)" strokeWidth={1} strokeDasharray="3 3" />
            {series.map((s, si) => s.values[hover] != null ? (
              <circle key={si} cx={xAt(hover)} cy={yAt(s.values[hover]!)} r={3.5} fill="var(--panel)" stroke={s.color} strokeWidth={2} />
            ) : null)}
          </g>
        )}
      </svg>

      {/* legend + hover readout */}
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[11px]">
        {series.map((s) => (
          <span key={s.name} className="flex items-center gap-1.5 text-[var(--muted)]">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />
            {s.name}
            {hover != null && s.values[hover] != null && (
              <span className="mono ml-1 font-semibold text-[var(--ink)]">{format(s.values[hover]!)}</span>
            )}
          </span>
        ))}
        {hover != null && <span className="mono ml-auto text-[var(--faint)]">{formatX(labels[hover])}</span>}
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
