"use client";

// Compact posting-cadence strip: one dot per day for a trailing window, with
// weekday letters underneath — the sizing pattern from viral.app's "Post
// Activity". Hover a dot for the exact date + post count.

interface Cell {
  date: string;
  count: number;
}

const WD = ["S", "M", "T", "W", "T", "F", "S"];

function weekday(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function fmt(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en", {
    month: "short",
    day: "numeric",
  });
}

function shade(count: number): string {
  if (count <= 0) return "var(--panel2)";
  if (count === 1) return "color-mix(in srgb, var(--signal) 55%, transparent)";
  if (count === 2) return "color-mix(in srgb, var(--signal) 78%, transparent)";
  return "var(--signal)";
}

export function PostActivity({
  calendar,
  days = 30,
  dot = 13,
  gap = 4,
  showWeekdays = true,
  todayIndex,
}: {
  calendar: Cell[];
  days?: number;
  dot?: number;
  gap?: number;
  showWeekdays?: boolean;
  /** index within the sliced window that is "today" (defaults to last) */
  todayIndex?: number;
}) {
  const cells = calendar.slice(-days);
  const todayI = todayIndex ?? cells.length - 1;

  return (
    <div className="inline-flex flex-col" style={{ gap: 3 }}>
      <div className="flex" style={{ gap }}>
        {cells.map((c, i) => (
          <span
            key={c.date}
            title={`${fmt(c.date)} · ${c.count} post${c.count === 1 ? "" : "s"}`}
            style={{
              width: dot,
              height: dot,
              borderRadius: "50%",
              background: shade(c.count),
              outline: i === todayI ? "1.5px solid var(--signal)" : "none",
              outlineOffset: 1,
            }}
          />
        ))}
      </div>
      {showWeekdays && (
        <div className="flex" style={{ gap }}>
          {cells.map((c, i) => (
            <span
              key={i}
              className="mono text-center text-[var(--faint)]"
              style={{ width: dot, fontSize: 9, lineHeight: "11px" }}
            >
              {WD[weekday(c.date)]}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
