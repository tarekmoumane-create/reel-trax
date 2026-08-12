import type { CadenceStatus } from "./cadence";

export const STATUS_STYLE: Record<
  CadenceStatus,
  { label: string; text: string; bg: string; dot: string }
> = {
  on_track: {
    label: "On track",
    text: "#1f7a4d",
    bg: "rgba(47,148,100,0.13)",
    dot: "#2f9464",
  },
  behind: {
    label: "Behind",
    text: "#a86a10",
    bg: "rgba(201,132,25,0.15)",
    dot: "#c98419",
  },
  quiet: {
    label: "Gone quiet",
    text: "#b83a2e",
    bg: "rgba(208,71,58,0.13)",
    dot: "#d0473a",
  },
  no_data: {
    label: "No posts yet",
    text: "#8a8074",
    bg: "rgba(42,35,28,0.06)",
    dot: "#b3a897",
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
