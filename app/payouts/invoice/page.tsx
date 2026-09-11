"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { money } from "@/lib/payouts";
import { fmtNum } from "@/lib/ui";
import { invoiceCsv, PLATFORM_SHORT, type InvoiceData } from "@/lib/invoice";

// Print-ready client invoice for a date range. Renders outside the app shell
// (no sidebar) so the browser's "Save as PDF" produces a clean document.
// Invoice-specific fields (number, dates, fee, notes) live in localStorage
// per client; the "bill from" block is a shared app setting.

interface Meta {
  number: string;
  issueDate: string;
  dueDate: string;
  feePct: string;
  notes: string;
  showVideos: boolean;
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
    showVideos: true,
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
      if (saved && typeof saved === "object") return { ...base, ...saved, number: saved.number || base.number };
    } catch {}
    return base;
  });
  const [profile, setProfile] = useState({ fromName: "", fromDetails: "", paymentInstructions: "" });
  const [profileDirty, setProfileDirty] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);

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
      })
      .catch((e) => setError(e.message));
  }, [clientId, from, to, all]);

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
  const total = Math.round((subtotal + fee) * 100) / 100;

  const fromLines = useMemo(() => profile.fromDetails.split("\n").map((l) => l.trim()).filter(Boolean), [profile.fromDetails]);

  function downloadCsv() {
    if (!data) return;
    const blob = new Blob([invoiceCsv(data)], { type: "text/csv;charset=utf-8" });
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
            <button onClick={() => window.print()} className="rounded-md bg-[#6553d6] px-3.5 py-1.5 text-[12.5px] font-semibold text-white hover:brightness-110">Print / Save as PDF</button>
          </div>
        </div>
        <details className="mx-auto max-w-[900px] px-6 pb-3">
          <summary className="cursor-pointer text-[12px] font-medium text-[#5c6270] hover:text-[#1a1d27]">Invoice details, agency fee &amp; “bill from”</summary>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div><label className={label}>Invoice #</label><input className={field} value={meta.number} onChange={(e) => setM({ number: e.target.value })} /></div>
            <div><label className={label}>Issue date</label><input type="date" className={field} value={meta.issueDate} onChange={(e) => setM({ issueDate: e.target.value })} /></div>
            <div><label className={label}>Due date</label><input type="date" className={field} value={meta.dueDate} onChange={(e) => setM({ dueDate: e.target.value })} /></div>
            <div><label className={label}>Agency fee % <span className="text-[#979dab]">(optional)</span></label><input type="number" min={0} step="0.5" className={field} value={meta.feePct} onChange={(e) => setM({ feePct: e.target.value })} placeholder="0" /></div>
            <div className="col-span-2 sm:col-span-4"><label className={label}>Notes to client</label><input className={field} value={meta.notes} onChange={(e) => setM({ notes: e.target.value })} placeholder="Thanks for your business — reach out with any questions." /></div>
            <label className="col-span-2 flex items-center gap-2 text-[12px] text-[#5c6270] sm:col-span-4">
              <input type="checkbox" checked={meta.showVideos} onChange={(e) => setM({ showVideos: e.target.checked })} />
              Include the per-video appendix ({data.totals.videos} videos)
            </label>
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

        {/* line items */}
        <table className="mt-10 w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b-2 border-[#1a1d27] text-left text-[11px] font-semibold uppercase tracking-wide text-[#5c6270]">
              <th className="py-2 pr-3">Creator</th>
              <th className="py-2 pr-3">Campaign</th>
              <th className="py-2 pr-3 text-right">Posts</th>
              <th className="py-2 pr-3 text-right">Views</th>
              <th className="py-2 pr-3">Detail</th>
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
                <td className="py-2.5 pr-3 text-[11.5px] text-[#5c6270]">
                  {l.breakdown.map((b) => <div key={b.label}>{b.label} <span className="mono">{money(b.amount, cur)}</span></div>)}
                </td>
                <td className="mono py-2.5 text-right font-semibold">{money(l.amount, cur)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td colSpan={5} className="pt-4 text-right text-[#5c6270]">Subtotal</td><td className="mono pt-4 text-right">{money(subtotal, cur)}</td></tr>
            {feePct > 0 && <tr><td colSpan={5} className="pt-1 text-right text-[#5c6270]">Agency fee ({feePct}%)</td><td className="mono pt-1 text-right">{money(fee, cur)}</td></tr>}
            <tr className="text-[15px] font-bold"><td colSpan={5} className="pt-2 text-right">Total due</td><td className="mono pt-2 text-right text-[#6553d6]">{money(total, cur)}</td></tr>
          </tfoot>
        </table>

        {(meta.notes || profile.paymentInstructions) && (
          <div className="mt-10 grid grid-cols-2 gap-8 text-[12.5px]">
            {meta.notes && <div><div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#979dab]">Notes</div><p className="mt-1.5 whitespace-pre-line text-[#5c6270]">{meta.notes}</p></div>}
            {profile.paymentInstructions && <div><div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#979dab]">Payment</div><p className="mt-1.5 whitespace-pre-line text-[#5c6270]">{profile.paymentInstructions}</p></div>}
          </div>
        )}

        {/* per-video appendix */}
        {meta.showVideos && data.totals.videos > 0 && (
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
