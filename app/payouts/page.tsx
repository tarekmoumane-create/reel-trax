"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useClients } from "../providers";
import { TopBar, PageTitle } from "@/components/PageHeader";
import { RangePicker, type Range } from "@/components/RangePicker";
import { money } from "@/lib/payouts";
import { payLink } from "@/lib/pay";
import { fmtNum } from "@/lib/ui";
import { invoiceCsv, type InvoiceData } from "@/lib/invoice";

interface PayoutRow {
  key: string; campaignId: string; campaignName: string; creatorId: string; creatorName: string;
  periodStart: string; periodEnd: string; periodLabel: string; amount: number; currency: string; status: string;
  postsCount: number; viewsCount: number; sideshiftUrl: string | null; paymentMethod: string; paymentHandle: string | null;
}
interface PayoutData {
  rows: PayoutRow[];
  summary: { due: number; accruing: number; paid: number; counts: Record<string, number> };
}

const STATUS_TABS = ["accruing", "due", "paid", "cancelled"] as const;
type Tab = (typeof STATUS_TABS)[number] | "invoice";

/** How far through the billing period we are, 0–100. */
function periodProgress(r: PayoutRow): number {
  const start = new Date(r.periodStart).getTime();
  const end = new Date(r.periodEnd).getTime();
  if (!(end > start)) return 0;
  return Math.max(0, Math.min(100, Math.round(((Date.now() - start) / (end - start)) * 100)));
}

export default function PayoutsPage() {
  const { currentClientId, currentClient } = useClients();
  const [data, setData] = useState<PayoutData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("accruing");
  const [autoPicked, setAutoPicked] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!currentClientId) return;
    setLoading(true);
    const res = await fetch(`/api/payouts?clientId=${currentClientId}`);
    if (res.ok) setData(await res.json());
    setLoading(false);
  }, [currentClientId]);
  useEffect(() => { load(); }, [load]);

  // First load: land on "due" only when something actually needs paying;
  // otherwise stay on the live accruing view.
  useEffect(() => {
    if (data && !autoPicked) {
      setAutoPicked(true);
      if ((data.summary.counts.due ?? 0) > 0) setTab("due");
    }
  }, [data, autoPicked]);

  async function mark(r: PayoutRow, status: string) {
    setBusy(r.key);
    await fetch("/api/payouts/mark", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ campaignId: r.campaignId, creatorId: r.creatorId, periodStart: r.periodStart, status }) });
    await load();
    setBusy(null);
  }

  const rows = useMemo(() => (data?.rows ?? []).filter((r) => r.status === tab), [data, tab]);
  const s = data?.summary;
  const tabBtn = (t: Tab, label: string) => (
    <button key={t} onClick={() => setTab(t)} className={`rounded-md px-3 py-1.5 text-xs font-medium ${tab === t ? "bg-[var(--panel2)] text-[var(--ink)]" : "text-[var(--muted)] hover:text-[var(--ink)]"}`}>
      {label}
    </button>
  );

  return (
    <>
      <TopBar crumbs={["Creator Hub", "Payouts"]} />
      <div className="px-6 py-6">
        <PageTitle title="Payouts" sub={`What each creator is owed across ${currentClient?.name ?? "this client"}'s campaigns — accruing live through each period. Tracking only — no money moves.`} />

        {s && (
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi label="Due now" value={money(s.due)} tone="var(--signal)" />
            <Kpi label="Accruing this period" value={money(s.accruing)} />
            <Kpi label="Paid (recorded)" value={money(s.paid)} tone="var(--ok)" />
            <Kpi label="Creators owed" value={`${s.counts.due + s.counts.accruing}`} />
          </div>
        )}

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-[var(--line)] bg-[var(--panel)] p-0.5">
            {STATUS_TABS.map((t) => tabBtn(t, `${t[0].toUpperCase()}${t.slice(1)}${s ? ` (${s.counts[t] ?? 0})` : ""}`))}
          </div>
          <div className="inline-flex rounded-lg border border-[var(--line)] bg-[var(--panel)] p-0.5">
            {tabBtn("invoice", "Invoice")}
          </div>
        </div>

        {tab === "invoice" ? (
          currentClientId ? <InvoiceTab clientId={currentClientId} /> : null
        ) : (
          <div className="card overflow-hidden">
            <div className="hidden grid-cols-[minmax(140px,1.4fr)_minmax(110px,1fr)_130px_70px_84px_104px_248px] items-center gap-3 border-b border-[var(--line)] px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--faint)] lg:grid">
              <div>Creator</div><div>Campaign</div><div>Period</div><div>Posts</div><div>Views</div><div>Amount</div><div className="text-right">Action</div>
            </div>
            {loading ? (
              <div className="py-16 text-center text-sm text-[var(--muted)]">Loading…</div>
            ) : rows.length === 0 ? (
              <div className="py-16 text-center text-sm text-[var(--muted)]">
                {tab === "due"
                  ? "Nothing due. Periods that finish unpaid stay here until you mark them."
                  : tab === "accruing"
                    ? "Nothing accruing — assign creators to an active campaign and this period's earnings build up here live."
                    : `No ${tab} payouts.`}
              </div>
            ) : (
              rows.map((r) => (
                <div key={r.key} className="grid grid-cols-1 items-center gap-2 border-b border-[var(--line2)] px-4 py-3 last:border-0 lg:grid-cols-[minmax(140px,1.4fr)_minmax(110px,1fr)_130px_70px_84px_104px_248px] lg:gap-3">
                  <Link href={`/creators/${r.creatorId}`} className="truncate font-medium hover:text-[var(--signal)]">{r.creatorName}</Link>
                  <Link href={`/campaigns/${r.campaignId}`} className="truncate text-[13px] text-[var(--muted)] hover:text-[var(--signal)]">{r.campaignName}</Link>
                  <div>
                    <div className="mono text-[12px] text-[var(--muted)]">{r.periodLabel}</div>
                    {r.status === "accruing" && (
                      <div className="mt-1 flex items-center gap-1.5">
                        <div className="h-1 w-16 overflow-hidden rounded-full bg-[var(--panel2)]">
                          <div className="h-full rounded-full bg-[var(--signal)]" style={{ width: `${periodProgress(r)}%` }} />
                        </div>
                        <span className="text-[10px] text-[var(--faint)]">{periodProgress(r)}%</span>
                      </div>
                    )}
                  </div>
                  <div className="mono text-[13px]">{r.postsCount}</div>
                  <div className="mono text-[13px]">{fmtNum(r.viewsCount)}</div>
                  <div className="mono text-[15px] font-bold">{money(r.amount, r.currency)}</div>
                  {/* flex-wrap: the 3-button Sideshift rows drop to a second line
                      instead of overlapping the amount when space runs out */}
                  <div className="flex flex-wrap items-center justify-end gap-1.5">
                    {payLink(r) && (
                      <a href={payLink(r)!.href} target="_blank" rel="noreferrer" title={`Pay via ${payLink(r)!.label}`} className="btn whitespace-nowrap px-2.5 py-1.5 text-xs">Pay · {payLink(r)!.label}</a>
                    )}
                    {(r.status === "due" || r.status === "accruing") && (
                      <>
                        <button onClick={() => mark(r, "paid")} disabled={busy === r.key} className="btn btn-primary px-2.5 py-1.5 text-xs disabled:opacity-60">Mark paid</button>
                        <button onClick={() => mark(r, "cancelled")} disabled={busy === r.key} className="btn px-2.5 py-1.5 text-xs disabled:opacity-60">Skip</button>
                      </>
                    )}
                    {(r.status === "paid" || r.status === "cancelled") && (
                      <button onClick={() => mark(r, "due")} disabled={busy === r.key} className="btn px-2.5 py-1.5 text-xs disabled:opacity-60">Undo</button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </>
  );
}

/**
 * Invoice tab: pick any date range, see what every creator earned in it
 * (across all campaigns), then open the print-ready invoice or grab a CSV.
 */
function InvoiceTab({ clientId }: { clientId: string }) {
  // null = "everything up to today" — the server works out the start date from
  // the client's own history, so a statement bills the whole engagement by
  // default instead of only the current month.
  const [range, setRange] = useState<Range | null>(null);
  const [data, setData] = useState<InvoiceData | null>(null);
  const [loading, setLoading] = useState(true);
  // Guards the extra round-trip when an all-time fetch resolves into a real
  // from/to and re-runs this effect with the range it just returned.
  const fetched = useRef("");

  useEffect(() => {
    const key = range ? `${range.from}|${range.to}` : "all";
    if (fetched.current === key) return;
    fetched.current = key;
    let alive = true;
    setLoading(true);
    const qs = range ? `from=${range.from}&to=${range.to}` : "all=1";
    fetch(`/api/invoice?clientId=${clientId}&${qs}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: InvoiceData | null) => {
        if (!alive) return;
        setData(d);
        setLoading(false);
        if (d && !range) {
          fetched.current = `${d.from}|${d.to}`;
          setRange({ from: d.from, to: d.to, label: "All time" });
        }
      });
    return () => { alive = false; };
  }, [clientId, range]);

  // Reset to all-time when the client changes — the previous client's history
  // says nothing about this one's.
  useEffect(() => {
    fetched.current = "";
    setRange(null);
  }, [clientId]);

  const allTime = range?.label === "All time";
  const rangeLabel = range?.label ?? "All time";
  const invoiceHref = range
    ? `/payouts/invoice?clientId=${clientId}&from=${range.from}&to=${range.to}`
    : `/payouts/invoice?clientId=${clientId}&all=1`;

  function downloadCsv() {
    if (!data) return;
    const blob = new Blob([invoiceCsv(data)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${data.client.name.replace(/[^\w-]+/g, "_")}_${data.from}_to_${data.to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const cur = data?.currency ?? "USD";
  const grid = "lg:grid-cols-[minmax(160px,1.5fr)_minmax(110px,1fr)_64px_84px_minmax(160px,1.6fr)_110px]";

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-xs text-[var(--muted)]">Statement period</span>
        {range && (
          <RangePicker
            range={range}
            onChange={setRange}
            onAllTime={() => { fetched.current = ""; setRange(null); }}
            allTimeActive={allTime}
          />
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <button onClick={downloadCsv} disabled={!data || data.lines.length === 0} className="btn px-3 py-1.5 text-xs disabled:opacity-50">CSV</button>
          <a href={invoiceHref} target="_blank" rel="noreferrer" className={`btn btn-primary px-3 py-1.5 text-xs ${!data || data.lines.length === 0 ? "pointer-events-none opacity-50" : ""}`}>
            Open invoice ↗
          </a>
        </div>
      </div>

      {data && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Kpi label={`Total · ${rangeLabel}`} value={money(data.totals.amount, cur)} tone="var(--signal)" />
          <Kpi label="Creators" value={`${data.totals.creators}`} />
          <Kpi label="Qualifying posts" value={`${data.totals.posts}`} />
          <Kpi label="Views" value={fmtNum(data.totals.views)} />
        </div>
      )}

      <div className="card overflow-hidden">
        <div className={`hidden grid-cols-1 items-center gap-3 border-b border-[var(--line)] px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--faint)] lg:grid ${grid}`}>
          <div>Creator</div><div>Campaign</div><div>Posts</div><div>Views</div><div>Breakdown</div><div className="text-right">Amount</div>
        </div>
        {loading ? (
          <div className="py-16 text-center text-sm text-[var(--muted)]">Calculating…</div>
        ) : !data || data.lines.length === 0 ? (
          <div className="py-16 text-center text-sm text-[var(--muted)]">Nothing earned in this range. Widen the dates or check the client&apos;s pay structure.</div>
        ) : (
          <>
            {data.lines.map((l) => (
              <div key={l.creatorId} className={`grid grid-cols-1 items-center gap-2 border-b border-[var(--line2)] px-4 py-3 lg:gap-3 ${grid}`}>
                <div className="min-w-0">
                  <Link href={`/creators/${l.creatorId}`} className="block truncate font-medium hover:text-[var(--signal)]">{l.creatorName}</Link>
                  <div className="mono truncate text-[11px] text-[var(--faint)]">{l.handles.join(" · ") || "—"}</div>
                </div>
                <div className="truncate text-[13px] text-[var(--muted)]">{l.campaigns.join(", ")}</div>
                <div className="mono text-[13px]">{l.posts}</div>
                <div className="mono text-[13px]">{fmtNum(l.views)}</div>
                <div className="mono truncate text-[11px] text-[var(--muted)]">{l.breakdown.map((b) => `${b.label} ${money(b.amount, cur)}`).join(" + ") || "—"}</div>
                <div className="mono text-right text-[15px] font-bold">{money(l.amount, cur)}</div>
              </div>
            ))}
            <div className="flex items-center justify-between px-4 py-3 text-sm">
              <span className="text-[var(--muted)]">Total for {rangeLabel.toLowerCase()}</span>
              <span className="mono text-base font-bold text-[var(--signal)]">{money(data.totals.amount, cur)}</span>
            </div>
          </>
        )}
      </div>
      <p className="mt-3 text-xs text-[var(--faint)]">
        Per-video pay counts videos posted inside the range. Per-period amounts (base fees, flat deals, target bonuses) are charged once for each billing period the range touches.
        Warm-up and excluded videos are left out automatically.
      </p>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="card px-4 py-3.5">
      <div className="mono text-[22px] font-bold leading-none" style={{ color: tone }}>{value}</div>
      <div className="mt-2 text-[11px] uppercase tracking-wide text-[var(--muted)]">{label}</div>
    </div>
  );
}
