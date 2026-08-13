import type { CadenceStatus } from "./cadence";

// Built from theme tokens so badges stay legible in both palettes — the fixed
// hex values these replaced went dark-on-dark at night.
export const STATUS_STYLE: Record<
  CadenceStatus,
  { label: string; text: string; bg: string; dot: string }
> = {
  on_track: {
    label: "On track",
    text: "var(--ok)",
    bg: "color-mix(in srgb, var(--ok) 15%, transparent)",
    dot: "var(--ok)",
  },
  behind: {
    label: "Behind",
    text: "var(--warn)",
    bg: "color-mix(in srgb, var(--warn) 16%, transparent)",
    dot: "var(--warn)",
  },
  quiet: {
    label: "Gone quiet",
    text: "var(--bad)",
    bg: "color-mix(in srgb, var(--bad) 15%, transparent)",
    dot: "var(--bad)",
  },
  no_data: {
    label: "No posts yet",
    text: "var(--muted)",
    bg: "color-mix(in srgb, var(--muted) 12%, transparent)",
    dot: "var(--faint)",
  },
};

export const SOURCE_LABEL: Record<string, string> = {
  sideshift: "Sideshift",
  referral: "Referral",
  outreach: "Outreach",
  agency: "Agency",
  other: "Other",
};

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (isNaN(then)) return "never";
  const s = Math.floor((Date.now() - then) / 1000);
  if (s < 45) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

export function daysLabel(n: number | null): string {
  if (n === null) return "—";
  if (n === 0) return "today";
  if (n === 1) return "yesterday";
  return `${n}d ago`;
}

export function fmtNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}
