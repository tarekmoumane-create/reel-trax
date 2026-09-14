"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { money } from "@/lib/payouts";
import { fmtNum } from "@/lib/ui";
import { invoiceCsv, PLATFORM_SHORT, type InvoiceData } from "@/lib/invoice";
import { downloadInvoicePdf } from "@/lib/invoicePdf";

// Client invoice for a date range, downloadable as a PDF that matches what's on
// screen. Renders outside the app shell (no sidebar) so the sheet is the page.
// Invoice-specific fields (number, dates, fee, notes) live in localStorage
// per client; the "bill from" block is a shared app setting.

interface Meta {
  number: string;
  issueDate: string;
  dueDate: string;
  feePct: string;
  notes: string;
  /** The per-video appendix, on screen and in the PDF. Off unless ticked. */
  includeAppendix: boolean;
  /** Management-fee months (YYYY-MM) left off this particular invoice. */
  skipFees: string[];
}

const dstr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fmtLong = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en", { month: "long", day: "numeric", year: "numeric" });
};
const fmtShort = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" });
};

function defaultMeta(clientId: string, to: string): Meta {
  const issue = new Date();
  const due = new Date();
  due.setDate(due.getDate() + 14);
  const seed = /^\d{4}-\d{2}/.test(to) ? to : dstr(issue);
  return {
    number: `INV-${seed.slice(0, 7).replace("-", "")}-${clientId.slice(-4).toUpperCase()}`,
    issueDate: dstr(issue),
    dueDate: dstr(due),
    feePct: "",
    notes: "",
    includeAppendix: false,
    skipFees: [],
  };
}

export default function InvoicePage() {
  return (
    <Suspense fallback={<div className="invoice-root p-10 text-sm">Loading…</div>}>
      <Invoice />
    </Suspense>
  );
}

function Invoice() {
  const sp = useSearchParams();
  const clientId = sp.get("clientId") ?? "";
  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? "";
  // `all=1` lets the statement cover the client's whole history — the server
  // resolves the dates and hands them back on the response.
  const all = sp.get("all") === "1";
  const lsKey = `rt.invoice.${clientId}`;

  const [data, setData] = useState<InvoiceData | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Saved per client in localStorage; this subtree is client-rendered (it
  // hangs off useSearchParams), so reading storage in the initializer is safe.
  const [meta, setMeta] = useState<Meta>(() => {
    const base = defaultMeta(clientId, to);
    if (typeof window === "undefined") return base;
    try {
      const saved = JSON.parse(localStorage.getItem(lsKey) ?? "null");
      if (saved && typeof saved === "object") {
        return {
          ...base, ...saved,
          number: saved.number || base.number,
          skipFees: Array.isArray(saved.skipFees) ? saved.skipFees : [],
          // New key on purpose: older saves carried showVideos: true, the old default.
          includeAppendix: saved.includeAppendix === true,
        };
      }
    } catch {}
    return base;
  });
  const [profile, setProfile] = useState({ fromName: "", fromDetails: "", paymentInstructions: "" });
  const [profileDirty, setProfileDirty] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  // The monthly fee is saved on the client (same on every device); which months
  // this particular invoice bills is per invoice, in meta.skipFees.
  const [feeForm, setFeeForm] = useState({ amount: "", start: "" });
  const [feeDirty, setFeeDirty] = useState(false);
  const [savingFee, setSavingFee] = useState(false);
  const [reload, setReload] = useState(0);
  const [pdfState, setPdfState] = useState<"idle" | "working" | "error">("idle");

  const setM = (patch: Partial<Meta>) => {
    setMeta((m) => {
      const next = { ...m, ...patch };
      try { localStorage.setItem(lsKey, JSON.stringify(next)); } catch {}
      return next;
    });
  };

  useEffect(() => {
    if (!clientId || (!all && (!from || !to))) { setError("Missing clientId / from / to."); return; }
    const qs = all ? "all=1" : `from=${from}&to=${to}`;
    fetch(`/api/invoice?clientId=${clientId}&${qs}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d?.error || "Failed to load");
        setData(d);
        setProfile(d.profile);
        setFeeForm({ amount: d.client.managementFee != null ? String(d.client.managementFee) : "", start: d.client.managementFeeStart ?? "" });
        setFeeDirty(false);
      })
      .catch((e) => setError(e.message));
  }, [clientId, from, to, all, reload]);

  async function saveFee() {
    setSavingFee(true);
    await fetch(`/api/clients/${clientId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ managementFee: feeForm.amount, managementFeeStart: feeForm.start }),
    });
    setSavingFee(false);
    setReload((n) => n + 1);
  }

  async function saveProfile() {
    setSavingProfile(true);
    await fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ invoice: profile }) });
    setSavingProfile(false);
    setProfileDirty(false);
  }

  // With `all=1` the URL carries no dates; the response says what was billed.
  const periodFrom = data?.from ?? from;
  const periodTo = data?.to ?? to;
  const cur = data?.currency ?? "USD";
  const feePct = Number(meta.feePct) || 0;
  const subtotal = data?.totals.amount ?? 0;
  const fee = Math.round(subtotal * feePct) / 100;
  const fees = (data?.fees ?? []).filter((f) => !meta.skipFees.includes(f.month));
  const feesTotal = fees.reduce((s, f) => s + f.amount, 0);
  const total = Math.round((subtotal + fee + feesTotal) * 100) / 100;

  const fromLines = useMemo(() => profile.fromDetails.split("\n").map((l) => l.trim()).filter(Boolean), [profile.fromDetails]);

  async function downloadPdf() {
    const sheet = document.querySelector<HTMLElement>(".invoice-sheet");
    if (!sheet || !data) return;
    setPdfState("working");
    try {
      const name = `${data.client.name} ${meta.number}`.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-");
      await downloadInvoicePdf(sheet, `${name || "invoice"}.pdf`);
      setPdfState("idle");
    } catch (e) {
      console.error("[invoice pdf]", e);
      setPdfState("error");
    }
  }

  function downloadCsv() {
    if (!data) return;
    const blob = new Blob([invoiceCsv(data, meta.skipFees)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${meta.number}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const field = "w-full rounded-md border px-2.5 py-1.5 text-[13px]";
  const label = "mb-1 block text-[11px] font-medium text-[#5c6270]";

  if (error) return <div className="invoice-root p-10 text-sm">{error} <Link href="/payouts" className="underline">Back to payouts</Link></div>;
  if (!data) return <div className="invoice-root p-10 text-sm">Building invoice…</div>;

  return (
    <div className="invoice-root">
      {/* controls — never printed */}
      <div className="no-print sticky top-0 z-10 border-b border-[#d9dce4] bg-[#f6f7fa]/95 backdrop-blur">
        <div className="mx-auto flex max-w-[900px] flex-wrap items-center gap-2 px-6 py-3">
          <Link href="/payouts" className="rounded-md border border-[#d9dce4] bg-white px-3 py-1.5 text-[12.5px] font-medium hover:bg-[#f0f1f6]">← Payouts</Link>
          <span className="text-[13px] text-[#5c6270]">Invoice for <b className="text-[#1a1d27]">{data.client.name}</b> · {fmtShort(periodFrom)} – {fmtShort(periodTo)}</span>
          <div className="ml-auto flex items-center gap-1.5">
            <button onClick={downloadCsv} className="rounded-md border border-[#d9dce4] bg-white px-3 py-1.5 text-[12.5px] font-medium hover:bg-[#f0f1f6]">CSV</button>
            {pdfState === "error" && <span className="text-[12px] text-[#d64545]">Couldn&apos;t build the PDF — try again.</span>}
            <button onClick={downloadPdf} disabled={pdfState === "working"} className="rounded-md bg-[#6553d6] px-3.5 py-1.5 text-[12.5px] font-semibold text-white hover:brightness-110 disabled:opacity-60">
              {pdfState === "working" ? "Preparing PDF…" : "Download PDF"}
            </button>
          </div>
        </div>
        <details className="mx-auto max-w-[900px] px-6 pb-3">
          <summary className="cursor-pointer text-[12px] font-medium text-[#5c6270] hover:text-[#1a1d27]">Invoice details, fees &amp; “bill from”</summary>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div><label className={label}>Invoice #</label><input className={field} value={meta.number} onChange={(e) => setM({ number: e.target.value })} /></div>
            <div><label className={label}>Issue date</label><input type="date" className={field} value={meta.issueDate} onChange={(e) => setM({ issueDate: e.target.value })} /></div>
            <div><label className={label}>Due date</label><input type="date" className={field} value={meta.dueDate} onChange={(e) => setM({ dueDate: e.target.value })} /></div>
            <div><label className={label}>Agency fee % <span className="text-[#979dab]">(optional)</span></label><input type="number" min={0} step="0.5" className={field} value={meta.feePct} onChange={(e) => setM({ feePct: e.target.value })} placeholder="0" /></div>
            <div className="col-span-2 sm:col-span-4"><label className={label}>Notes to client</label><input className={field} value={meta.notes} onChange={(e) => setM({ notes: e.target.value })} placeholder="Thanks for your business — reach out with any questions." /></div>
            <label className="col-span-2 flex items-center gap-2 text-[12px] text-[#5c6270] sm:col-span-4">
              <input type="checkbox" checked={meta.includeAppendix} onChange={(e) => setM({ includeAppendix: e.target.checked })} />
              Include the per-video appendix ({data.totals.videos} videos)
            </label>
          </div>
          <div className="mt-3 rounded-md border border-[#d9dce4] bg-white p-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div><label className={label}>Monthly management fee</label><input type="number" min={0} step="1" className={field} value={feeForm.amount} onChange={(e) => { setFeeForm({ ...feeForm, amount: e.target.value }); setFeeDirty(true); }} placeholder="none" /></div>
              <div><label className={label}>Billed from <span className="text-[#979dab]">(first month)</span></label><input type="date" className={field} value={feeForm.start} onChange={(e) => { setFeeForm({ ...feeForm, start: e.target.value }); setFeeDirty(true); }} /></div>
              <div className="col-span-2 flex items-end">
                {feeDirty && <button onClick={saveFee} disabled={savingFee} className="rounded-md bg-[#6553d6] px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50">{savingFee ? "Saving…" : `Save fee for ${data.client.name}`}</button>}
              </div>
            </div>
            {data.fees.length > 0 ? (
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-[#5c6270]">
                <span>Bill on this invoice:</span>
                {data.fees.map((f) => (
                  <label key={f.month} className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={!meta.skipFees.includes(f.month)}
                      onChange={(e) => setM({ skipFees: e.target.checked ? meta.skipFees.filter((m) => m !== f.month) : [...meta.skipFees, f.month] })}
                    />
                    {f.label} · {money(f.amount, cur)}
                  </label>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-[11.5px] text-[#979dab]">
                {data.client.managementFee ? "No month's fee falls inside this invoice's dates." : "Set a monthly fee to bill it on this client's invoices."}
              </p>
            )}
            <p className="mt-1.5 text-[11px] text-[#979dab]">
              Each month&apos;s fee goes on the invoice that includes the 1st of that month (or the billed-from date, for the first month), so no month is billed twice or skipped. Blank billed-from = the start of the engagement.
            </p>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div><label className={label}>Bill from — name</label><input className={field} value={profile.fromName} onChange={(e) => { setProfile({ ...profile, fromName: e.target.value }); setProfileDirty(true); }} placeholder="Your agency" /></div>
            <div><label className={label}>Address / email / phone (one per line)</label><textarea rows={2} className={field} value={profile.fromDetails} onChange={(e) => { setProfile({ ...profile, fromDetails: e.target.value }); setProfileDirty(true); }} /></div>
            <div><label className={label}>Payment instructions</label><textarea rows={2} className={field} value={profile.paymentInstructions} onChange={(e) => { setProfile({ ...profile, paymentInstructions: e.target.value }); setProfileDirty(true); }} placeholder="Wire / ACH, PayPal, net terms…" /></div>
          </div>
          {profileDirty && (
            <div className="mt-2 flex justify-end">
              <button onClick={saveProfile} disabled={savingProfile} className="rounded-md bg-[#6553d6] px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50">{savingProfile ? "Saving…" : "Save bill-from details"}</button>
            </div>
          )}
        </details>
      </div>

      {/* the document */}
      <div className="invoice-sheet mx-auto my-8 max-w-[900px] px-12 py-12 text-[13px] leading-relaxed">
        <div className="flex items-start justify-between gap-8">
          <div>
            <div className="text-[26px] font-bold leading-none tracking-tight">{profile.fromName || "Your agency"}</div>
            <div className="mt-2 text-[12.5px] text-[#5c6270]">
              {fromLines.length ? fromLines.map((l, i) => <div key={i}>{l}</div>) : <div className="italic text-[#979dab]">Add your address / email in the details above</div>}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#979dab]">Invoice</div>
            <div className="mono mt-1 text-[18px] font-semibold">{meta.number}</div>
            <table className="mt-3 ml-auto text-[12.5px]">
              <tbody>
                <tr><td className="pr-4 text-[#5c6270]">Issued</td><td className="text-right">{fmtLong(meta.issueDate)}</td></tr>
                <tr><td className="pr-4 text-[#5c6270]">Due</td><td className="text-right">{fmtLong(meta.dueDate)}</td></tr>
                <tr><td className="pr-4 text-[#5c6270]">Period</td><td className="text-right">{fmtShort(periodFrom)} – {fmtShort(periodTo)}</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-10 grid grid-cols-2 gap-8">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#979dab]">Bill to</div>
            <div className="mt-1.5 text-[15px] font-semibold">{data.client.name}</div>
            {data.client.website && <div className="text-[12.5px] text-[#5c6270]">{data.client.website.replace(/^https?:\/\//, "")}</div>}
          </div>
          <div className="text-right">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#979dab]">Amount due</div>
            <div className="mono mt-1.5 text-[28px] font-bold leading-none text-[#6553d6]">{money(total, cur)}</div>
            <div className="mt-1 text-[12px] text-[#5c6270]">{data.totals.creators} creators · {data.totals.posts} qualifying posts · {fmtNum(data.totals.views)} views</div>
          </div>
        </div>

        {/* 1 · creator pay */}
        <div className="mt-12 flex items-baseline justify-between border-b border-[#e4e6ee] pb-2">
          <div className="text-[13px] font-semibold uppercase tracking-[0.16em] text-[#1a1d27]">Creator pay</div>
          <div className="text-[12px] text-[#979dab]">Videos posted {fmtShort(periodFrom)} – {fmtShort(periodTo)}</div>
        </div>
        <table className="mt-2 w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b-2 border-[#1a1d27] text-left text-[11px] font-semibold uppercase tracking-wide text-[#5c6270]">
              <th className="py-2 pr-3">Creator</th>
              <th className="py-2 pr-3">Campaign</th>
              <th className="py-2 pr-3 text-right">Posts</th>
              <th className="py-2 pr-3 text-right">Views</th>
              <th className="py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.map((l) => (
              <tr key={l.creatorId} className="invoice-avoid-break border-b border-[#e4e6ee] align-top">
                <td className="py-2.5 pr-3">
                  <div className="font-medium">{l.creatorName}</div>
                  <div className="mono text-[11px] text-[#979dab]">{l.handles.join(" · ")}</div>
                </td>
                <td className="py-2.5 pr-3 text-[#5c6270]">{l.campaigns.join(", ")}</td>
                <td className="mono py-2.5 pr-3 text-right">{l.posts}</td>
                <td className="mono py-2.5 pr-3 text-right">{fmtNum(l.views)}</td>
                <td className="mono py-2.5 text-right font-semibold">{money(l.amount, cur)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold"><td colSpan={4} className="pt-3 text-right">Creator pay subtotal</td><td className="mono pt-3 text-right">{money(subtotal, cur)}</td></tr>
          </tfoot>
        </table>

        {/* 2 · management fee — the agency's own fee, kept apart from creator costs */}
        {fees.length > 0 && (
          <div className="invoice-avoid-break">
            <div className="mt-12 border-b border-[#e4e6ee] pb-2 text-[13px] font-semibold uppercase tracking-[0.16em] text-[#1a1d27]">Management fee</div>
            <table className="mt-2 w-full border-collapse text-[12.5px]">
              <thead>
                <tr className="border-b-2 border-[#1a1d27] text-left text-[11px] font-semibold uppercase tracking-wide text-[#5c6270]">
                  <th className="py-2 pr-3">Description</th>
                  <th className="py-2 pr-3">Period</th>
                  <th className="py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {fees.map((f) => (
                  <tr key={f.month} className="border-b border-[#e4e6ee]">
                    <td className="py-2.5 pr-3 font-medium">{data.client.name} management fee</td>
                    <td className="py-2.5 pr-3 text-[#5c6270]">{f.label}</td>
                    <td className="mono py-2.5 text-right font-semibold">{money(f.amount, cur)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold"><td colSpan={2} className="pt-3 text-right">Management fee subtotal</td><td className="mono pt-3 text-right">{money(feesTotal, cur)}</td></tr>
              </tfoot>
            </table>
          </div>
        )}

        {/* 3 · total */}
        <div className="invoice-avoid-break mt-12 flex justify-end">
          <table className="w-full max-w-[340px] border-collapse rounded-md text-[13px]">
            <tbody>
              <tr><td className="py-1.5 pr-6 text-[#5c6270]">Creator pay</td><td className="mono py-1.5 text-right">{money(subtotal, cur)}</td></tr>
              {feePct > 0 && <tr><td className="py-1.5 pr-6 text-[#5c6270]">Agency fee ({feePct}%)</td><td className="mono py-1.5 text-right">{money(fee, cur)}</td></tr>}
              {fees.length > 0 && <tr><td className="py-1.5 pr-6 text-[#5c6270]">Management fee</td><td className="mono py-1.5 text-right">{money(feesTotal, cur)}</td></tr>}
              <tr className="border-t-2 border-[#1a1d27] text-[16px] font-bold">
                <td className="pr-6 pt-3">Total due</td>
                <td className="mono pt-3 text-right text-[#6553d6]">{money(total, cur)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {(meta.notes || profile.paymentInstructions) && (
          <div className="mt-10 grid grid-cols-2 gap-8 text-[12.5px]">
            {meta.notes && <div><div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#979dab]">Notes</div><p className="mt-1.5 whitespace-pre-line text-[#5c6270]">{meta.notes}</p></div>}
            {profile.paymentInstructions && <div><div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#979dab]">Payment</div><p className="mt-1.5 whitespace-pre-line text-[#5c6270]">{profile.paymentInstructions}</p></div>}
          </div>
        )}

        {/* per-video appendix */}
        {meta.includeAppendix && data.totals.videos > 0 && (
          <div className="mt-12 border-t border-[#e4e6ee] pt-6">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#979dab]">Appendix · videos posted {fmtShort(periodFrom)} – {fmtShort(periodTo)}</div>
            {data.lines.filter((l) => l.videos.length).map((l) => (
              <div key={l.creatorId} className="invoice-avoid-break mt-5">
                <div className="text-[13px] font-semibold">{l.creatorName} <span className="font-normal text-[#979dab]">· {l.videos.length} videos</span></div>
                <table className="mt-1.5 w-full border-collapse text-[11.5px]">
                  <thead>
                    <tr className="border-b border-[#e4e6ee] text-left text-[10px] font-semibold uppercase tracking-wide text-[#979dab]">
                      <th className="py-1 pr-3">Date</th><th className="py-1 pr-3">Platform</th><th className="py-1 pr-3">Title</th><th className="py-1 pr-3 text-right">Views</th><th className="py-1 text-right">Pay</th>
                    </tr>
                  </thead>
                  <tbody>
                    {l.videos.map((v, i) => (
                      <tr key={i} className="border-b border-[#f0f1f6]">
                        <td className="mono py-1 pr-3 whitespace-nowrap text-[#5c6270]">{fmtShort(v.postedAt)}</td>
                        <td className="py-1 pr-3 text-[#5c6270]">{PLATFORM_SHORT[v.platform] ?? v.platform}</td>
                        <td className="max-w-[360px] truncate py-1 pr-3">{v.url ? <a href={v.url} className="text-[#1a1d27] underline decoration-[#d9dce4] underline-offset-2">{v.caption || "(no caption)"}</a> : v.caption || "(no caption)"}</td>
                        <td className="mono py-1 pr-3 text-right">{fmtNum(v.views)}</td>
                        <td className={`py-1 text-right ${v.pay === "Counts" ? "text-[#979dab]" : "font-medium"}`}>{v.pay}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}

        <div className="mt-12 text-center text-[10.5px] text-[#979dab]">Generated by Reel Trax · {fmtLong(dstr(new Date()))}</div>
      </div>
    </div>
  );
}
