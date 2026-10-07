"use client";

import { useEffect, useId, useRef, useState } from "react";

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
// The narrowest a zoom can go, in intervals between points.
const MIN_SPAN = 4;
// How far the y-axis can be stretched past "fit the tallest point" — enough
// to bring 500-view days up to readable height under a 500K spike.
const MAX_Y_ZOOM = 2000;
// Stretch per pixel dragged, exponential: a full-height drag is ~400×.
const Y_DRAG_RATE = 0.025;
const SCALE_LS_KEY = "rt.chartScale";

type Scale = "linear" | "log";
// The visible window, stamped with the label count it was made for: new data
// (another range or aggregation) no longer matches and falls back to the full
// view, with no effect needed to reset it.
type View = { n: number; start: number; end: number; yZoom: number };

// Mixed-metric chart in the viral.app mold: every series is scaled to its own
// max so views (100K) and posts (5) can share one plot; the y-axis labels
// belong to the first series; hovering shows a floating tooltip with the exact
// value of every series at that x.
//
// One viral day flattens everything else against the floor, so the chart
// navigates like a trading chart: pinch / ⌘-scroll zooms around the cursor,
// dragging pans, and the y-axis refits to whatever is on screen. Dragging the
// y-axis stretches it further — anything pushed off the top gets a marker —
// and a log scale shows small and huge days side by side. Double-click resets.
export function Chart({
  labels,
  series,
  height = 200,
  format = (n) => `${n}`,
  formatX = (s) => s,
  formatHeader,
  onSelect,
  selected = null,
}: {
  labels: string[];
  series: Series[];
  height?: number;
  format?: (n: number) => string;
  formatX?: (s: string) => string;
  /** tooltip title for a label (defaults to formatX) */
  formatHeader?: (s: string) => string;
  /** a plain click (no drag) on a point — e.g. "show me what was posted that day" */
  onSelect?: (index: number) => void;
  /** index to keep highlighted, e.g. the day whose videos are open below */
  selected?: number | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const clipId = `chart-clip-${useId().replace(/[^\w-]/g, "")}`;
  const [w, setW] = useState(600);
  const [hover, setHover] = useState<number | null>(null);
  const [scale, setScaleState] = useState<Scale>(() => {
    // Charts mount after their data loads, never during SSR — but guard anyway.
    try {
      return typeof window !== "undefined" && localStorage.getItem(SCALE_LS_KEY) === "log" ? "log" : "linear";
    } catch {
      return "linear";
    }
  });
  const [viewState, setViewState] = useState<View | null>(null);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ kind: "pan" | "y"; x: number; y: number; view: View } | null>(null);
  // Sideways scroll arrives in pixels but the window moves in whole days, so
  // leftover pixels carry over — otherwise a slow trackpad swipe never moves.
  const wheelPx = useRef(0);
  const thumbDrag = useRef<{ x: number; view: View } | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((e) => setW(e[0].contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

  function setScale(s: Scale) {
    setScaleState(s);
    try { localStorage.setItem(SCALE_LS_KEY, s); } catch { /* private mode */ }
  }

  const n = labels.length;
  const last = Math.max(0, n - 1);
  const view: View = viewState && viewState.n === n ? viewState : { n, start: 0, end: last, yZoom: 1 };
  const { start, end, yZoom } = view;
  const span = Math.max(1, end - start);
  const zoomedX = start > 0 || end < last;
  const zoomed = zoomedX || yZoom > 1;

  const plotW = Math.max(1, w - M.left - M.right);
  const plotH = Math.max(1, height - M.top - M.bottom);
  const base = M.top + plotH;

  // Log is log10(1 + v) so zero days sit on the floor instead of at -∞.
  const tf = (v: number) => (scale === "log" ? Math.log10(1 + Math.max(0, v)) : v);
  // Each series' top, in transformed units, fitted to the visible window only —
  // that refit is what makes zooming in on a quiet stretch actually reveal it.
  // Stretching only applies to line metrics: bars are small counts (posts a
  // day) that never have the outlier problem, and stretching them just pushes
  // every bar off the top.
  const tops = series.map((s) => {
    let mx = 0;
    for (let i = start; i <= end; i++) {
      const v = s.values[i];
      if (v != null && v > mx) mx = v;
    }
    return Math.max(1e-9, tf(niceMax(mx || 1)) / (s.bars ? 1 : yZoom));
  });
  const xAt = (i: number) => M.left + (n <= 1 ? plotW / 2 : ((i - start) / span) * plotW);
  const yAt = (v: number, si: number) => base - Math.min(1.05, tf(v) / tops[si]) * plotH;
  const offTop = (v: number, si: number) => tf(v) > tops[si] * 1.0001;

  // Draw one point past each edge so lines run to the border; the clip trims them.
  const lo = Math.max(0, start - 1);
  const hi = Math.min(last, end + 1);
  const visible: number[] = [];
  for (let i = lo; i <= hi; i++) visible.push(i);

  function linePath(vals: (number | null)[], si: number) {
    let d = "";
    let pen = false;
    for (const i of visible) {
      const v = vals[i];
      if (v == null) { pen = false; continue; }
      d += `${pen ? "L" : "M"}${xAt(i).toFixed(1)} ${yAt(v, si).toFixed(1)} `;
      pen = true;
    }
    return d.trim();
  }
  function areaPath(vals: (number | null)[], si: number) {
    const pts: [number, number][] = [];
    for (const i of visible) { const v = vals[i]; if (v != null) pts.push([xAt(i), yAt(v, si)]); }
    if (pts.length < 2) return "";
    let d = `M${pts[0][0].toFixed(1)} ${base}`;
    for (const [x, y] of pts) d += ` L${x.toFixed(1)} ${y.toFixed(1)}`;
    d += ` L${pts[pts.length - 1][0].toFixed(1)} ${base} Z`;
    return d;
  }

  // Gridlines on the first series' scale. Log gets powers of ten when it spans
  // enough of them; otherwise evenly spaced fractions of the top.
  const top0 = tops[0] ?? 1;
  const grid: { y: number; label: string }[] =
    scale === "log" && top0 >= 2
      ? (() => {
          const step = Math.ceil(Math.floor(top0) / 5);
          const out = [{ y: base, label: "0" }];
          for (let k = step; k <= top0; k += step) out.push({ y: base - (k / top0) * plotH, label: shortNum(Math.pow(10, k)) });
          return out;
        })()
      : [0, 0.25, 0.5, 0.75, 1].map((f) => ({
          y: base - f * plotH,
          label: shortNum(scale === "log" ? Math.pow(10, f * top0) - 1 : f * top0),
        }));

  const xTickIdx = tickIndexes(span + 1, Math.min(7, Math.max(2, Math.floor(w / 110)))).map((i) => i + start);
  const barW = Math.max(3, Math.min(26, (plotW / (span + 1)) * 0.55));

  /**
   * Zoom the x-window by `factor` (>1 = in). `at` is where the cursor sits as a
   * fraction of the plot width, so the day under it stays put. Works from the
   * latest state, not this render's: a fast wheel delivers several events
   * before React re-renders, and each has to build on the last.
   */
  function zoomAround(at: number, factor: number) {
    if (n < 3) return;
    setViewState((prev) => {
      const from: View = prev && prev.n === n ? prev : { n, start: 0, end: last, yZoom: 1 };
      const cur = from.end - from.start;
      let next = factor > 1 ? Math.floor(cur / factor) : Math.ceil(cur / factor);
      // Integer indexes: a gentle pinch must still move at least one step.
      if (next === cur) next += factor > 1 ? -1 : 1;
      next = Math.max(Math.min(MIN_SPAN, last), Math.min(last, next));
      const anchor = from.start + at * cur;
      const st = Math.max(0, Math.min(last - next, Math.round(anchor - at * next)));
      return { ...from, start: st, end: st + next };
    });
  }

  /** Slide the window by whole points, from the latest state (see zoomAround). */
  function panBy(delta: number) {
    if (!delta) return;
    setViewState((prev) => {
      const from: View = prev && prev.n === n ? prev : { n, start: 0, end: last, yZoom: 1 };
      const w0 = from.end - from.start;
      const st = Math.max(0, Math.min(last - w0, from.start + delta));
      return st === from.start ? from : { ...from, start: st, end: st + w0 };
    });
  }

  // Wheel needs a non-passive listener to stop the page scrolling, which
  // React's onWheel can't provide. Plain scrolling still scrolls the page —
  // only pinch (reported as ctrl+wheel) or ⌘/ctrl+scroll zooms.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      // Firefox can report in lines rather than pixels.
      const unit = e.deltaMode === 1 ? 16 : 1;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const rect = el!.getBoundingClientRect();
        const x = Math.max(0, Math.min(1, (e.clientX - rect.left - M.left) / plotW));
        zoomAround(x, Math.max(0.67, Math.min(1.5, Math.exp(-e.deltaY * unit * 0.01))));
        return;
      }
      // Sideways scrolling moves through time: a trackpad swipe, or shift +
      // wheel on a mouse (some browsers already turn that into deltaX).
      // Mostly-vertical scrolling is left alone so the page still scrolls.
      const dx = e.shiftKey && e.deltaX === 0 ? e.deltaY : e.deltaX;
      if (!zoomedX || Math.abs(dx) <= Math.abs(e.shiftKey ? 0 : e.deltaY)) return;
      // Claiming it also stops a swipe from triggering browser back/forward.
      e.preventDefault();
      const pxPerPoint = plotW / span;
      wheelPx.current += dx * unit;
      const steps = Math.trunc(wheelPx.current / pxPerPoint);
      if (!steps) return;
      wheelPx.current -= steps * pxPerPoint;
      // Pinned against an edge: drop the backlog so reversing responds at once.
      if ((steps < 0 && start === 0) || (steps > 0 && end === last)) wheelPx.current = 0;
      panBy(steps);
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    if (e.button !== 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const onAxis = e.clientX - rect.left < M.left;
    drag.current = { kind: onAxis ? "y" : "pan", x: e.clientX, y: e.clientY, view };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const d = drag.current;
    if (d) {
      const dx = e.clientX - d.x;
      const dy = d.y - e.clientY;
      if (!dragging && Math.abs(dx) + Math.abs(dy) < 3) return; // a click, not a drag
      if (!dragging) setDragging(true);
      setHover(null);
      if (d.kind === "y") {
        const yz = Math.max(1, Math.min(MAX_Y_ZOOM, d.view.yZoom * Math.exp(dy * Y_DRAG_RATE)));
        setViewState({ ...d.view, n, yZoom: yz });
      } else {
        const w0 = d.view.end - d.view.start;
        const shift = Math.round((-dx / plotW) * w0);
        const st = Math.max(0, Math.min(last - w0, d.view.start + shift));
        setViewState({ ...d.view, n, start: st, end: st + w0 });
      }
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left - M.left;
    if (x < 0) { setHover(null); return; }
    const i = Math.round(start + (x / plotW) * span);
    setHover(Math.max(start, Math.min(end, i)));
  }

  function indexAt(e: React.PointerEvent<SVGSVGElement>): number | null {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left - M.left;
    if (x < 0 || x > plotW) return null;
    return Math.max(start, Math.min(end, Math.round(start + (x / plotW) * span)));
  }

  function endDrag() {
    drag.current = null;
    setDragging(false);
  }

  // A press that never turned into a drag is a click on whatever day sits
  // under the pointer.
  function onPointerUp(e: React.PointerEvent<SVGSVGElement>) {
    const wasPress = !!drag.current && drag.current.kind === "pan";
    const wasDrag = dragging;
    endDrag();
    if (!wasPress || wasDrag || !onSelect) return;
    const i = indexAt(e);
    if (i != null) onSelect(i);
  }

  // tooltip placement — flips to the left of the guide near the right edge
  const TIP_W = 200;
  const tipLeft =
    hover == null ? 0 : xAt(hover) + 14 + TIP_W > w ? xAt(hover) - 14 - TIP_W : xAt(hover) + 14;

  const btn = "grid h-6 min-w-6 place-items-center rounded-md px-1.5 text-[12.5px] font-medium text-[var(--muted)] hover:bg-[var(--panel2)] hover:text-[var(--ink)] disabled:opacity-30 disabled:hover:bg-transparent";

  return (
    <div ref={ref} className="relative w-full select-none">
      <svg
        ref={svgRef}
        width={w}
        height={height}
        style={{ touchAction: "pan-y", cursor: dragging ? "grabbing" : zoomedX ? "grab" : onSelect ? "pointer" : "crosshair" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={endDrag}
        onPointerLeave={() => { if (!drag.current) setHover(null); }}
        onDoubleClick={() => setViewState(null)}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={M.left} y={M.top - 4} width={plotW} height={plotH + 4} />
          </clipPath>
        </defs>

        {/* gridlines + y labels (labels read on the first series' scale) */}
        {grid.map((g, i) => (
          <g key={i}>
            <line x1={M.left} x2={w - M.right} y1={g.y} y2={g.y} stroke="var(--line)" strokeWidth={1} />
            <text x={M.left - 8} y={g.y + 3} textAnchor="end" fontSize={11.5} fill="var(--muted)" className="mono">
              {g.label}
            </text>
          </g>
        ))}
        {/* the selected point: a soft column so it stays marked while its
            videos are open below */}
        {selected != null && selected >= start && selected <= end && (
          <rect
            x={xAt(selected) - Math.max(6, barW / 2 + 4)}
            y={M.top}
            width={Math.max(12, barW + 8)}
            height={plotH}
            rx={4}
            fill="var(--signal)"
            opacity={0.12}
          />
        )}
        {/* y-axis grab strip — drag up to stretch the scale, down to relax it */}
        <rect x={0} y={M.top} width={M.left} height={plotH} fill="transparent" style={{ cursor: "ns-resize" }}>
          <title>Drag up or down to stretch the scale</title>
        </rect>
        {/* x labels */}
        {xTickIdx.map((i) => (
          <text key={i} x={xAt(i)} y={height - 6} textAnchor="middle" fontSize={11.5} fill="var(--muted)" className="mono">{formatX(labels[i])}</text>
        ))}

        <g clipPath={`url(#${clipId})`}>
          {/* bars first (behind), then areas, then lines */}
          {series.map((s, si) =>
            s.bars
              ? visible.map((i) => {
                  const v = s.values[i];
                  return v != null && v > 0 ? (
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
                  ) : null;
                })
              : null
          )}
          {series.map((s, si) => (s.area && !s.bars ? (
            <path key={`a${si}`} d={areaPath(s.values, si)} fill={s.color} opacity={0.12} />
          ) : null))}
          {series.map((s, si) => (!s.bars ? (
            <path key={`l${si}`} d={linePath(s.values, si)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          ) : null))}
          {/* always-visible point markers — same styling as the hover marker,
              slightly smaller, shrinking further when the view is dense */}
          {series.map((s, si) =>
            !s.bars
              ? visible.map((i) => {
                  const v = s.values[i];
                  return v != null && !offTop(v, si) ? (
                    <circle
                      key={`p${si}-${i}`}
                      cx={xAt(i)}
                      cy={yAt(v, si)}
                      r={span > 45 ? 2 : 2.8}
                      fill="var(--panel)"
                      stroke={s.color}
                      strokeWidth={1.6}
                    />
                  ) : null;
                })
              : null
          )}
        </g>

        {/* points stretched past the top: a caret on the edge, so a clipped
            spike reads as "keeps going", never as a flat line */}
        {series.map((s, si) =>
          visible.map((i) => {
            const v = s.values[i];
            if (v == null || i < start || i > end || !offTop(v, si)) return null;
            const x = xAt(i);
            return <path key={`o${si}-${i}`} d={`M${x - 4} ${M.top + 2} L${x} ${M.top - 4} L${x + 4} ${M.top + 2} Z`} fill={s.color} />;
          })
        )}

        {/* hover guide + markers */}
        {hover != null && (
          <g>
            <line x1={xAt(hover)} x2={xAt(hover)} y1={M.top} y2={base} stroke="var(--faint)" strokeWidth={1} strokeDasharray="3 3" />
            {series.map((s, si) => {
              const v = s.values[hover];
              return !s.bars && v != null && !offTop(v, si) ? (
                <circle key={si} cx={xAt(hover)} cy={yAt(v, si)} r={3.5} fill="var(--panel)" stroke={s.color} strokeWidth={2} />
              ) : null;
            })}
          </g>
        )}
      </svg>

      {/* scrollbar — where the zoomed window sits in the whole range. Drag the
          thumb, or click the track to jump there. The row is always reserved
          so zooming in doesn't shove the legend down mid-pinch. */}
      <div
        className="relative h-2.5"
        style={{ marginLeft: M.left, width: plotW }}
        onPointerDown={(e) => {
          if (!zoomedX || e.target !== e.currentTarget) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const center = ((e.clientX - rect.left) / rect.width) * last;
          panBy(Math.round(center - (start + end) / 2));
        }}
      >
        {zoomedX && (
          <>
            <div className="pointer-events-none absolute inset-x-0 top-1 h-1 rounded-full bg-[var(--line)]" />
            <div
              className="absolute top-0.5 h-1.5 cursor-grab rounded-full bg-[var(--faint)] hover:bg-[var(--muted)] active:cursor-grabbing"
              style={{
                left: `${(start / last) * 100}%`,
                width: `max(24px, ${(span / last) * 100}%)`,
                touchAction: "none",
              }}
              onPointerDown={(e) => {
                thumbDrag.current = { x: e.clientX, view };
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => {
                const t = thumbDrag.current;
                if (!t) return;
                // The track is the whole range, so a pixel here is worth far
                // more days than a pixel dragged on the chart itself.
                const w0 = t.view.end - t.view.start;
                const st = Math.max(0, Math.min(last - w0, t.view.start + Math.round(((e.clientX - t.x) / plotW) * last)));
                setViewState({ ...t.view, n, start: st, end: st + w0 });
              }}
              onPointerUp={() => { thumbDrag.current = null; }}
              onPointerCancel={() => { thumbDrag.current = null; }}
            />
          </>
        )}
      </div>

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

      {/* legend + view controls */}
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[12.5px]">
        {series.map((s) => (
          <span key={s.name} className="flex items-center gap-1.5 text-[var(--muted)]">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
        <div className="ml-auto flex items-center gap-1">
          <span className="mr-1 hidden text-[11.5px] text-[var(--faint)] md:inline">
            {zoomedX ? "Scroll sideways or drag to move · double-click to reset" : zoomed ? "Double-click to reset" : onSelect ? "Click a day to see its videos · pinch or ⌘-scroll to zoom" : "Pinch or ⌘-scroll to zoom · drag the axis to stretch"}
          </span>
          {zoomed && (
            <button onClick={() => setViewState(null)} className={`${btn} text-[var(--signal)]`}>Reset</button>
          )}
          <button onClick={() => zoomAround(0.5, 0.67)} disabled={!zoomedX} className={btn} title="Zoom out" aria-label="Zoom out">−</button>
          <button onClick={() => zoomAround(0.5, 1.5)} disabled={n < 3 || span <= Math.min(MIN_SPAN, last)} className={btn} title="Zoom in" aria-label="Zoom in">+</button>
          <div className="ml-1 inline-flex rounded-md border border-[var(--line)] p-px">
            {(["linear", "log"] as const).map((sc) => (
              <button
                key={sc}
                onClick={() => setScale(sc)}
                title={sc === "log" ? "Log scale: small and huge days both readable" : "Linear scale"}
                className={`rounded px-1.5 py-0.5 text-[11.5px] font-medium ${scale === sc ? "bg-[var(--panel2)] text-[var(--ink)]" : "text-[var(--faint)] hover:text-[var(--ink)]"}`}
              >
                {sc === "log" ? "Log" : "Linear"}
              </button>
            ))}
          </div>
        </div>
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
