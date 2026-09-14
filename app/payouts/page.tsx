"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useClients } from "../providers";
import { TopBar, PageTitle } from "@/components/PageHeader";
import { RangePicker, fmtRangeDate, type Range } from "@/components/RangePicker";
import { money } from "@/lib/payouts";
import { payLink } from "@/lib/pay";
import { fmtNum } from "@/lib/ui";
import { invoiceCsv, type InvoiceData, type InvoiceLine } from "@/lib/invoice";

// Payouts is a pay run: pick the payment period, see what each creator earned
// for videos posted in it and what's still owed, record payments for exactly
// that period, and bill the client for the same period. One period drives the
// whole page, so the numbers, "Mark paid" and the invoice always agree.

type Mode = { kind: "last" } | { kind: "all" } | { kind: "range"; range: Range };
type View = "unpaid" | "paid" | "all";

const LAST: Mode = { kind: "last" };

export default function PayoutsPage() {
  const { currentClientId, currentClient } = useClients();
  // Stamped with the client it was picked for, so switching clients falls back
  // to "since last payment" without an effect.
  const [modeState, setModeState] = useState<{ client: string | null; mode: Mode }>({ client: null, mode: LAST });
  const mode = modeState.client === currentClientId ? modeState.mode : LAST;
  const setMode = (m: Mode) => setModeState({ client: currentClientId, mode: m });

  const [data, setData] = useState<InvoiceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>("unpaid");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  const qs = mode.kind === "last" ? "since=last" : mode.kind === "all" ? "all=1" : `from=${mode.range.from}&to=${mode.range.to}`;
  const load = useCallback(async () => {
    if (!currentClientId) return;
    setLoading(true);
    const res = await fetch(`/api/invoice?clientId=${currentClientId}&${qs}`);
    setData(res.ok ? await res.json() : null);
    setLoading(false);
  }, [currentClientId, qs]);
  useEffect(() => { load(); }, [load]);

  // A response for the previous client is not this client's pay run.
  const d = data && data.client.id === currentClientId ? data : null;
  const cur = d?.currency ?? "USD";

  const periodLabel =
    mode.kind === "last" ? "Since last payment" : mode.kind === "all" ? "All time" : mode.range.label;
  const datesLabel = d ? `${fmtRangeDate(d.from)} – ${fmtRangeDate(d.to)}` : "";
  const pickerRange: Range = d
    ? { from: d.from, to: d.to, label: mode.kind === "range" ? mode.range.label : `${periodLabel} · ${datesLabel}` }
    : { from: "", to: "", label: periodLabel };

  const unpaid = useMemo(() => (d?.lines ?? []).filter((l) => l.owed > 0), [d]);
  const settled = useMemo(() => (d?.lines ?? []).filter((l) => l.owed === 0 && l.records.length > 0), [d]);
  const rows = view === "unpaid" ? unpaid : view === "paid" ? settled : d?.lines ?? [];

  async function post(body: Record<string, unknown>, key: string) {
    setBusy(key);
    setError("");
    const res = await fetch("/api/payouts/mark", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => null);
      setError(e?.error ?? "Couldn't save that payment.");
    }
    await load();
    setBusy(null);
  }
  const record = (l: InvoiceLine, status: "paid" | "cancelled") =>
    d && post({ clientId: d.client.id, creatorId: l.creatorId, from: d.from, to: d.to, status }, l.creatorId);
  const undo = (id: string) => post({ payoutId: id, status: "due" }, id);
  function payAll() {
    if (!d || unpaid.length === 0) return;
    const total = unpaid.reduce((s, l) => s + l.owed, 0);
    if (!window.confirm(`Record ${money(total, cur)} as paid to ${unpaid.length} creator${unpaid.length === 1 ? "" : "s"} for ${datesLabel}?`)) return;
    post({ clientId: d.client.id, all: true, from: d.from, to: d.to, status: "paid" }, "all");
  }

  function downloadCsv() {
    if (!d) return;
    const blob = new Blob([invoiceCsv(d)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${d.client.name.replace(/[^\w-]+/g, "_")}_${d.from}_to_${d.to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const grid = "lg:grid-cols-[minmax(150px,1.4fr)_minmax(90px,0.8fr)_56px_76px_minmax(150px,1.5fr)_124px_210px]";
  const tabBtn = (v: View, label: string, n: number) => (
    <button key={v} onClick={() => setView(v)} className={`rounded-md px-3 py-1.5 text-xs font-medium ${view === v ? "bg-[var(--panel2)] text-[var(--ink)]" : "text-[var(--muted)] hover:text-[var(--ink)]"}`}>
      {label} ({n})
    </button>
  );

  return (
    <>
      <TopBar crumbs={["Creator Hub", "Payouts"]} />
      <div className="px-6 py-6">
        <PageTitle title="Payouts" sub={`What ${currentClient?.name ?? "this client"}'s creators earned for a payment period, and what's still owed. Tracking only — no money moves.`} />

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-xs text-[var(--muted)]">Payment period</span>
          <RangePicker
            range={pickerRange}
            onChange={(r) => setMode({ kind: "range", range: r })}
            onAllTime={() => setMode({ kind: "all" })}
            allTimeActive={mode.kind === "all"}
            leading={[{ label: "Since last payment", active: mode.kind === "last", onPick: () => setMode(LAST) }]}
          />
          {mode.kind === "range" && d && <span className="mono text-xs text-[var(--faint)]">{datesLabel}</span>}
          <div className="ml-auto flex items-center gap-1.5">
            <button onClick={downloadCsv} disabled={!d || d.lines.length === 0} className="btn px-3 py-1.5 text-xs disabled:opacity-50">CSV</button>
            <a
              href={d ? `/payouts/invoice?clientId=${d.client.id}&from=${d.from}&to=${d.to}` : "#"}
              target="_blank"
              rel="noreferrer"
              className={`btn px-3 py-1.5 text-xs ${!d || d.lines.length === 0 ? "pointer-events-none opacity-50" : ""}`}
            >
              Open invoice ↗
            </a>
            <button onClick={payAll} disabled={!d || unpaid.length === 0 || busy !== null} className="btn btn-primary px-3 py-1.5 text-xs disabled:opacity-50">
              {busy === "all" ? "Recording…" : "Mark all paid"}
            </button>
          </div>
        </div>

        {mode.kind === "last" && d && d.totals.owed > 0 && (
          <p className="mb-3 text-xs text-[var(--faint)]">Starts at the oldest video anyone is still owed for, so nobody&apos;s unpaid work is left out.</p>
        )}
        {d?.earlier && d.earlier.amount > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-[color:rgba(240,176,72,0.35)] bg-[color:rgba(240,176,72,0.08)] px-3 py-2 text-xs">
            <span>
              <span className="font-semibold">{money(d.earlier.amount, cur)}</span> is still owed to {d.earlier.creators} creator{d.earlier.creators === 1 ? "" : "s"} for videos before this period ({fmtRangeDate(d.earlier.from)} – {fmtRangeDate(d.earlier.to)}).
            </span>
            <button onClick={() => setMode({ kind: "all" })} className="font-medium text-[var(--signal)] hover:underline">Show all time</button>
          </div>
        )}
        {error && <p className="mb-3 rounded-lg bg-[color:rgba(242,104,95,0.1)] px-3 py-2 text-xs text-[var(--bad)]">{error}</p>}

        {d && (
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi label="Owed for this period" value={money(d.totals.owed, cur)} tone="var(--signal)" />
            <Kpi label="Earned in period" value={money(d.totals.amount, cur)} />
            <Kpi label="Paid (recorded)" value={money(d.totals.paid, cur)} tone="var(--ok)" />
            <Kpi label="Creators owed" value={`${unpaid.length}`} />
          </div>
        )}

        <div className="mb-3 inline-flex rounded-lg border border-[var(--line)] bg-[var(--panel)] p-0.5">
          {tabBtn("unpaid", "Unpaid", unpaid.length)}
          {tabBtn("paid", "Paid", settled.length)}
          {tabBtn("all", "All", d?.lines.length ?? 0)}
        </div>

        <div className="card overflow-hidden">
          <div className={`hidden items-center gap-3 border-b border-[var(--line)] px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--faint)] lg:grid ${grid}`}>
            <div>Creator</div><div>Campaign</div><div>Posts</div><div>Views</div><div>Breakdown</div><div className="text-right">Amount</div><div className="text-right">Action</div>
          </div>
          {loading && !d ? (
            <div className="py-16 text-center text-sm text-[var(--muted)]">Calculating…</div>
          ) : !d ? (
            <div className="py-16 text-center text-sm text-[var(--muted)]">Couldn&apos;t load payouts for this period.</div>
          ) : rows.length === 0 ? (
            <div className="py-16 text-center text-sm text-[var(--muted)]">
              {view === "unpaid"
                ? d.lines.length ? "Everyone is paid for this period." : "Nothing earned in this period. Widen the dates or check the client's pay structure."
                : view === "paid" ? "No payments recorded for this period yet." : "Nothing earned in this period."}
            </div>
          ) : (
            rows.map((l) => {
              const link = payLink(l.pay);
              return (
                <div key={l.creatorId} className={`border-b border-[var(--line2)] px-4 py-3 last:border-0 ${loading ? "opacity-60" : ""}`}>
                  <div className={`grid grid-cols-1 items-center gap-2 lg:gap-3 ${grid}`}>
                    <div className="min-w-0">
                      <Link href={`/creators/${l.creatorId}`} className="block truncate font-medium hover:text-[var(--signal)]">{l.creatorName}</Link>
                      <div className="mono truncate text-[11px] text-[var(--faint)]">{l.handles.join(" · ") || "—"}</div>
                    </div>
                    <div className="truncate text-[13px] text-[var(--muted)]">{l.campaigns.join(", ")}</div>
                    <div className="mono text-[13px]">{l.posts}</div>
                    <div className="mono text-[13px]">{fmtNum(l.views)}</div>
                    <div className="mono truncate text-[11px] text-[var(--muted)]" title={l.breakdown.map((b) => `${b.label} ${money(b.amount, cur)}`).join(" + ")}>
                      {l.breakdown.map((b) => `${b.label} ${money(b.amount, cur)}`).join(" + ") || "—"}
                    </div>
                    <div className="text-right">
                      {l.owed > 0 ? (
                        <>
                          <div className="mono text-[15px] font-bold">{money(l.owed, cur)}</div>
                          {(l.paid > 0 || l.late > 0) && (
                            <div className="text-[10px] text-[var(--faint)]">
                              {l.late > 0 ? `incl. ${money(l.late, cur)} earned after payment` : `of ${money(l.amount, cur)} · ${money(l.paid, cur)} paid`}
                            </div>
                          )}
                        </>
                      ) : (
                        <>
                          <div className="mono text-[15px] font-bold text-[var(--ok)]">{money(l.paid, cur)}</div>
                          <div className="text-[10px] text-[var(--faint)]">{l.records.length ? "paid" : "nothing owed"}</div>
                        </>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      {link && l.owed > 0 && (
                        <a href={link.href} target="_blank" rel="noreferrer" title={`Pay via ${link.label}`} className="btn whitespace-nowrap px-2.5 py-1.5 text-xs">Pay · {link.label}</a>
                      )}
                      {l.owed > 0 && (
                        <>
                          <button onClick={() => record(l, "paid")} disabled={busy !== null} className="btn btn-primary px-2.5 py-1.5 text-xs disabled:opacity-60">
                            {busy === l.creatorId ? "…" : "Mark paid"}
                          </button>
                          <button onClick={() => record(l, "cancelled")} disabled={busy !== null} className="btn px-2.5 py-1.5 text-xs disabled:opacity-60" title="Settle this period without paying">Skip</button>
                        </>
                      )}
                    </div>
                  </div>
                  {l.records.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5 lg:pl-1">
                      {l.records.map((r) => (
                        <span key={r.id} className="inline-flex items-center gap-1.5 rounded-md bg-[var(--panel2)] px-2 py-1 text-[11px] text-[var(--muted)]">
                          <span className={r.status === "paid" ? "text-[var(--ok)]" : "text-[var(--faint)]"}>{r.status === "paid" ? "Paid" : "Skipped"}</span>
                          <span className="mono">{fmtRangeDate(r.from)} – {fmtRangeDate(r.to)}</span>
                          {r.status === "paid" && <span className="mono">{money(r.amount, cur)}</span>}
                          {l.campaigns.length > 1 && <span className="text-[var(--faint)]">· {r.campaign}</span>}
                          <button onClick={() => undo(r.id)} disabled={busy !== null} className="text-[var(--faint)] hover:text-[var(--ink)] disabled:opacity-50">Undo</button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
        <p className="mt-3 text-xs text-[var(--faint)]">
          Amounts are for videos posted in the payment period. Mark paid records exactly this period; &ldquo;Since last payment&rdquo; always starts at the oldest video still owed.
          A video can still earn after you pay — say it crosses the minimum views — and that shows up as owed again. Monthly retainers count once, in the period that includes the start of the month.
        </p>
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
