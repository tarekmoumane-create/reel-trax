// Shared shapes + helpers for the client statement / invoice export.

export interface InvoiceVideo {
  platform: string; url: string | null; caption: string | null; postedAt: string; views: number; pay: string;
}
export interface InvoiceLine {
  creatorId: string; creatorName: string; handles: string[];
  campaigns: string[]; posts: number; views: number; amount: number;
  breakdown: { label: string; amount: number }[];
  videos: InvoiceVideo[];
}
export interface InvoiceData {
  client: { id: string; name: string; website: string | null; logoUrl: string | null };
  from: string; to: string; days: number; currency: string;
  lines: InvoiceLine[];
  totals: { amount: number; creators: number; posts: number; views: number; videos: number };
  profile: { fromName: string; fromDetails: string; paymentInstructions: string };
}

const csvCell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Two sections: creator totals, then every video in the range. */
export function invoiceCsv(d: InvoiceData): string {
  const rows: unknown[][] = [
    ["Client", d.client.name], ["From", d.from], ["To", d.to], ["Currency", d.currency], [],
    ["Creator", "Accounts", "Campaigns", "Qualifying posts", "Views", "Breakdown", "Amount"],
    ...d.lines.map((l) => [
      l.creatorName, l.handles.join(" | "), l.campaigns.join(" | "), l.posts, l.views,
      l.breakdown.map((b) => `${b.label}: ${b.amount.toFixed(2)}`).join(" + "), l.amount.toFixed(2),
    ]),
    ["Total", "", "", d.totals.posts, d.totals.views, "", d.totals.amount.toFixed(2)],
    [],
    ["Creator", "Platform", "Posted", "Title", "Views", "Pay status", "URL"],
    ...d.lines.flatMap((l) => l.videos.map((v) => [l.creatorName, v.platform, v.postedAt.slice(0, 10), v.caption ?? "", v.views, v.pay, v.url ?? ""])),
  ];
  return rows.map((r) => r.map(csvCell).join(",")).join("\n");
}

export const PLATFORM_SHORT: Record<string, string> = { tiktok: "TikTok", instagram: "Instagram", youtube: "YouTube", threads: "Threads" };
