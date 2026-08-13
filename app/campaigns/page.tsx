"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useClients } from "../providers";
import { TopBar, PageTitle } from "@/components/PageHeader";
import { money, parsePayRules, parseViewTiers } from "@/lib/payouts";
import { PayStructureEditor, payFormFromRules, payFormToRules } from "@/components/PayStructureEditor";

interface CampaignRow {
  id: string;
  name: string;
  status: string;
  period: string;
  targetVideos: number | null;
  baseFee: number;
  perPost: number;
  cpmRate: number;
  cpmBasis: string;
  viewTiers: string | null;
  currency: string;
  _count?: { assignments: number };
}

export default function CampaignsPage() {
  const { currentClientId, currentClient } = useClients();
  const [rows, setRows] = useState<CampaignRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    if (!currentClientId) return;
    setLoading(true);
    const res = await fetch(`/api/campaigns?clientId=${currentClientId}`);
    if (res.ok) setRows(await res.json());
    setLoading(false);
  }, [currentClientId]);

  useEffect(() => {
    load();
  }, [load]);

  function ruleSummary(c: CampaignRow) {
    const parts: string[] = [];
    if (c.baseFee) parts.push(`${money(c.baseFee, c.currency)} base`);
    if (c.perPost) parts.push(`${money(c.perPost, c.currency)}/post`);
    if (c.cpmRate) parts.push(`${money(c.cpmRate, c.currency)} CPM${c.cpmBasis === "perVideo" ? "/video" : ""}`);
    const tiers = parseViewTiers(c.viewTiers);
    if (tiers.length) parts.push(`${tiers.length} view tier${tiers.length > 1 ? "s" : ""}`);
    return parts.join(" · ") || "No payout rules";
  }

  return (
    <>
      <TopBar
        crumbs={["Creator Hub", "Campaigns"]}
        right={<button onClick={() => setShowCreate(true)} className="btn btn-primary">+ New campaign</button>}
      />
      <div className="px-6 py-6">
        <PageTitle title="Campaigns" sub="Group creators, set targets and payout rules per client." />

        <div className="card overflow-hidden">
          <div className="hidden grid-cols-[minmax(220px,2fr)_90px_90px_1fr_110px_90px] items-center gap-4 border-b border-[var(--line)] px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--faint)] md:grid">
            <div>Campaign</div><div>Period</div><div>Target</div><div>Payout rules</div><div>Creators</div><div>Status</div>
          </div>
          {loading ? (
            <div className="py-16 text-center text-sm text-[var(--muted)]">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="py-16 text-center text-sm text-[var(--muted)]">No campaigns yet. Create one to group creators and set payout rules.</div>
          ) : (
            rows.map((c) => (
              <Link key={c.id} href={`/campaigns/${c.id}`} className="grid grid-cols-1 items-center gap-2 border-b border-[var(--line2)] px-4 py-3 last:border-0 hover:bg-[var(--panel2)] md:grid-cols-[minmax(220px,2fr)_90px_90px_1fr_110px_90px] md:gap-4">
                <div className="font-medium">{c.name}</div>
                <div className="text-[13px] capitalize text-[var(--muted)]">{c.period}</div>
                <div className="mono text-[13px]">{c.targetVideos ? `${c.targetVideos}` : "—"}</div>
                <div className="mono truncate text-[12px] text-[var(--muted)]">{ruleSummary(c)}</div>
                <div className="mono text-[13px]">{c._count?.assignments ?? 0} assigned</div>
                <div>
                  <span className={`rounded-full px-2 py-1 text-[11px] font-medium ${c.status === "active" ? "bg-[color:rgba(87,201,138,0.12)] text-[var(--ok)]" : "bg-[var(--panel2)] text-[var(--muted)]"}`}>
                    {c.status}
                  </span>
                </div>
              </Link>
            ))
          )}
        </div>
      </div>

      {showCreate && currentClientId && (
        <CreateCampaign
          clientId={currentClientId}
          clientName={currentClient?.name ?? ""}
          defaultPayRules={currentClient?.defaultPayRules ?? null}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            load();
          }}
        />
      )}
    </>
  );
}

function CreateCampaign({ clientId, clientName, defaultPayRules, onClose, onCreated }: { clientId: string; clientName: string; defaultPayRules: string | null; onClose: () => void; onCreated: () => void }) {
  const clientDefault = parsePayRules(defaultPayRules);
  const [name, setName] = useState("");
  const [targetVideos, setTargetVideos] = useState("");
  const [currency, setCurrency] = useState(clientDefault?.currency ?? "USD");
  // Payout rules prefill from the client's default structure.
  const [payForm, setPayForm] = useState(() => payFormFromRules(clientDefault));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!name.trim()) { setError("Campaign name is required"); return; }
    setSaving(true);
    const rules = payFormToRules(payForm);
    const res = await fetch("/api/campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, name, targetVideos, currency, ...rules, period: payForm.period }),
    });
    setSaving(false);
    if (!res.ok) { setError((await res.json()).error || "Failed"); return; }
    onCreated();
  }

  const field = "w-full px-3 py-2 text-sm";
  const label = "mb-1 block text-xs font-medium text-[var(--muted)]";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[var(--scrim)] p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div className="card my-8 w-full max-w-lg p-5" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-4">
          <h2 className="font-display text-lg font-bold">New campaign</h2>
          <p className="text-xs text-[var(--muted)]">for {clientName}{clientDefault ? " · payout rules prefilled from the client's payment structure" : ""}</p>
        </div>
        <div className="space-y-3">
          <div><label className={label}>Campaign name *</label><input autoFocus className={field} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Summer UGC push" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={label}>Target posts / period</label><input type="number" className={field} value={targetVideos} onChange={(e) => setTargetVideos(e.target.value)} placeholder="e.g. 20" /></div>
            <div><label className={label}>Currency</label><select className={field} value={currency} onChange={(e) => setCurrency(e.target.value)}>{["USD", "EUR", "GBP", "CAD", "AUD"].map((c) => <option key={c}>{c}</option>)}</select></div>
          </div>
          <div className="rounded-xl border border-[var(--line)] p-3">
            <div className="mb-2 text-xs font-semibold text-[var(--muted)]">Payout rules (per creator, per period)</div>
            <PayStructureEditor value={payForm} onChange={setPayForm} />
          </div>
          {error && <p className="rounded-lg bg-[color:rgba(242,104,95,0.1)] px-3 py-2 text-sm text-[var(--bad)]">{error}</p>}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="btn">Cancel</button>
          <button onClick={submit} disabled={saving} className="btn btn-primary disabled:opacity-60">{saving ? "Creating…" : "Create campaign"}</button>
        </div>
      </div>
    </div>
  );
}
