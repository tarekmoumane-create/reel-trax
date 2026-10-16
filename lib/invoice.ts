// Shared shapes + helpers for the client statement / invoice export.

export interface InvoiceVideo {
  platform: string; url: string | null; caption: string | null; postedAt: string; views: number; pay: string;
}
/** A recorded payment (or skip) overlapping the statement period. */
export interface PayRecord {
  id: string; campaign: string; from: string; to: string;
  /** What was recorded, and what that same period is worth today. */
  amount: number; live: number;
  status: string; paidAt: string | null;
}
export interface InvoiceLine {
  creatorId: string; creatorName: string; handles: string[];
  campaigns: string[]; posts: number; views: number;
  /** Everything earned for videos posted in the period, paid or not. */
  amount: number;
  /** Still to pay: unrecorded parts of the period plus late earnings. */
  owed: number;
  /** Recorded as paid for the period. */
  paid: number;
  /** Earned after a payment was recorded (included in owed). */
  late: number;
  breakdown: { label: string; amount: number }[];
  records: PayRecord[];
  pay: { sideshiftUrl: string | null; paymentMethod: string | null; paymentHandle: string | null };
  videos: InvoiceVideo[];
}
export interface InvoiceFee {
  /** YYYY-MM */
  month: string;
  label: string;
  amount: number;
}
/** A line typed by hand onto an invoice (a bonus, a credit as a negative, …). */
export interface InvoiceCustomLine {
  id: string;
  label: string;
  amount: number;
}
export interface InvoiceData {
  client: {
    id: string; name: string; website: string | null; logoUrl: string | null;
    managementFee: number | null; managementFeeStart: string | null;
  };
  from: string; to: string; days: number; currency: string;
  /** How the period was chosen: "last" = since last payment, "all" = whole history. */
  since: "last" | "all" | null;
  historyFrom: string;
  lines: InvoiceLine[];
  /** Monthly management fees this period bills (the agency's, not creators'). */
  fees: InvoiceFee[];
  /** amount = creator earnings only; fees = management fees. */
  totals: { amount: number; owed: number; paid: number; fees: number; creators: number; posts: number; views: number; videos: number };
  /** Still owed for videos before this period, if the period doesn't start at the beginning. */
  earlier: { amount: number; creators: number; from: string; to: string } | null;
  profile: { fromName: string; fromDetails: string; paymentInstructions: string };
}

const csvCell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Creator totals, management fees, then every video in the range. `skipFees` = months left off this invoice.
 *  `d.lines` is what's billed (hidden lines dropped, edited amounts in place); `custom` = hand-typed lines. */
export function invoiceCsv(d: InvoiceData, skipFees: string[] = [], custom: InvoiceCustomLine[] = []): string {
  const fees = (d.fees ?? []).filter((f) => !skipFees.includes(f.month));
  const feeTotal = fees.reduce((s, f) => s + f.amount, 0);
  const creatorTotal = d.lines.reduce((s, l) => s + l.amount, 0) + custom.reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const rows: unknown[][] = [
    ["Client", d.client.name], ["From", d.from], ["To", d.to], ["Currency", d.currency], [],
    ["Creator", "Accounts", "Campaigns", "Qualifying posts", "Views", "Breakdown", "Amount"],
    ...d.lines.map((l) => [
      l.creatorName, l.handles.join(" | "), l.campaigns.join(" | "), l.posts, l.views,
      l.breakdown.map((b) => `${b.label}: ${b.amount.toFixed(2)}`).join(" + "), l.amount.toFixed(2),
    ]),
    ...custom.map((c) => [c.label || "Adjustment", "", "", "", "", "", (Number(c.amount) || 0).toFixed(2)]),
    ["Total", "", "", d.lines.reduce((s, l) => s + l.posts, 0), d.lines.reduce((s, l) => s + l.views, 0), "", creatorTotal.toFixed(2)],
    ...(fees.length
      ? [[], ["Management fee"], ...fees.map((f) => [f.label, "", "", "", "", "", f.amount.toFixed(2)]), ["Total due", "", "", "", "", "", (creatorTotal + feeTotal).toFixed(2)]]
      : []),
    [],
    ["Creator", "Platform", "Posted", "Title", "Views", "Pay status", "URL"],
    ...d.lines.flatMap((l) => l.videos.map((v) => [l.creatorName, v.platform, v.postedAt.slice(0, 10), v.caption ?? "", v.views, v.pay, v.url ?? ""])),
  ];
  return rows.map((r) => r.map(csvCell).join(",")).join("\n");
}

export const PLATFORM_SHORT: Record<string, string> = { tiktok: "TikTok", instagram: "Instagram", youtube: "YouTube", threads: "Threads", facebook: "Facebook", snapchat: "Snapchat" };
