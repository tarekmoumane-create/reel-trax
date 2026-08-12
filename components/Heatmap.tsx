"use client";

interface Cell {
  date: string;
  count: number;
}

function weekdayOf(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun
}

function shade(count: number): string {
  if (count <= 0) return "var(--panel2)";
  if (count === 1) return "color-mix(in srgb, var(--accent) 45%, transparent)";
  if (count === 2) return "color-mix(in srgb, var(--accent) 70%, transparent)";
  return "var(--accent)";
}

export function Heatmap({
  calendar,
  cell = 12,
  gap = 3,
  showLegend = false,
  showMonths = false,
}: {
  calendar: Cell[];
  cell?: number;
  gap?: number;
  showLegend?: boolean;
  showMonths?: boolean;
}) {
  if (!calendar.length) return null;

  // Build weeks (columns). Pad leading days so first column starts on Sunday.
  const weeks: (Cell | null)[][] = [];
  let current: (Cell | null)[] = [];
  const firstWd = weekdayOf(calendar[0].date);
  for (let i = 0; i < firstWd; i++) current.push(null);
  for (const c of calendar) {
    current.push(c);
    if (current.length === 7) {
      weeks.push(current);
      current = [];
    }
  }
  if (current.length) {
    while (current.length < 7) current.push(null);
    weeks.push(current);
  }

  // Month labels above columns.
  const monthLabels: { col: number; label: string }[] = [];
  if (showMonths) {
    let lastMonth = -1;
    weeks.forEach((w, col) => {
      const first = w.find(Boolean) as Cell | undefined;
      if (!first) return;
      const mo = Number(first.date.split("-")[1]) - 1;
      if (mo !== lastMonth) {
        monthLabels.push({
          col,
          label: new Date(2000, mo, 1).toLocaleString("en", { month: "short" }),
        });
        lastMonth = mo;
      }
    });
  }

  const colW = cell + gap;

  return (
    <div className="inline-block">
      {showMonths && (
        <div className="relative mb-1 h-3 text-[10px] text-[var(--muted)]">
          {monthLabels.map((m) => (
            <span
              key={m.col}
              className="absolute"
              style={{ left: m.col * colW }}
            >
              {m.label}
            </span>
          ))}
        </div>
      )}
      <div className="flex" style={{ gap }}>
        {weeks.map((w, ci) => (
          <div key={ci} className="flex flex-col" style={{ gap }}>
            {w.map((c, ri) => (
              <div
                key={ri}
                title={c ? `${c.date}: ${c.count} post${c.count === 1 ? "" : "s"}` : ""}
                style={{
                  width: cell,
                  height: cell,
                  borderRadius: Math.max(2, cell / 4),
                  background: c ? shade(c.count) : "transparent",
                }}
              />
            ))}
          </div>
        ))}
      </div>
      {showLegend && (
        <div className="mt-2 flex items-center gap-1.5 text-[10px] text-[var(--muted)]">
          <span>Less</span>
          {[0, 1, 2, 3].map((n) => (
            <span
              key={n}
              style={{
                width: cell,
                height: cell,
                borderRadius: Math.max(2, cell / 4),
                background: shade(n),
                display: "inline-block",
              }}
            />
          ))}
          <span>More</span>
        </div>
      )}
    </div>
  );
}
