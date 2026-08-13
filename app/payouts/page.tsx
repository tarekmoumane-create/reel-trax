"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useClients } from "../providers";
import { TopBar, PageTitle } from "@/components/PageHeader";
import { money } from "@/lib/payouts";
import { payLink } from "@/lib/pay";
import { fmtNum } from "@/lib/ui";

interface PayoutRow {
  key: string; campaignId: string; campaignName: string; creatorId: string; creatorName: string;
  periodStart: string; periodEnd: string; periodLabel: string; amount: number; currency: string; status: string;
  postsCount: number; viewsCount: number; sideshiftUrl: string | null; paymentMethod: string; paymentHandle: string | null;
}
interface PayoutData {
  rows: PayoutRow[];
  summary: { due: number; accruing: number; paid: number; counts: Record<string, number> };
}

const TABS = ["accruing", "due", "paid", "cancelled"] as const;

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
  const [tab, setTab] = useState<(typeof TABS)[number]>("accruing");
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

        <div className="mb-3 inline-flex rounded-lg border border-[var(--line)] bg-[var(--panel)] p-0.5">
          {TABS.map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize ${tab === t ? "bg-[var(--panel2)] text-[var(--ink)]" : "text-[var(--muted)] hover:text-[var(--ink)]"}`}>
              {t}{s ? ` (${s.counts[t] ?? 0})` : ""}
            </button>
          ))}
        </div>

        <div className="card overflow-hidden">
          <div className="hidden grid-cols-[minmax(160px,1.4fr)_minmax(140px,1fr)_130px_80px_90px_110px_210px] items-center gap-4 border-b border-[var(--line)] px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--faint)] lg:grid">
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
              <div key={r.key} className="grid grid-cols-1 items-center gap-2 border-b border-[var(--line2)] px-4 py-3 last:border-0 lg:grid-cols-[minmax(160px,1.4fr)_minmax(140px,1fr)_130px_80px_90px_110px_210px] lg:gap-4">
                <Link href={`/creators/${r.creatorId}`} className="font-medium hover:text-[var(--signal)]">{r.creatorName}</Link>
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
                <div className="flex items-center justify-end gap-1.5">
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
      </div>
    </>
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
