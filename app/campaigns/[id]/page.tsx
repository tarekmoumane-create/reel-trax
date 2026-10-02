"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { TopBar } from "@/components/PageHeader";
import { money, parseViewTiers, type ViewTier } from "@/lib/payouts";
import { fmtNum } from "@/lib/ui";
import { PayStructureEditor, TierEditor, payFormFromRules, payFormToRules } from "@/components/PayStructureEditor";
import { Select } from "@/components/Select";

interface Earnings {
  amount: number; qualifyingPosts: number; qualifyingViews: number; targetMet: boolean;
  breakdown: { label: string; amount: number }[]; capped: boolean;
}
interface Detail {
  campaign: {
    id: string; clientId: string; name: string; status: string; period: string; isAuto: boolean; targetVideos: number | null;
    baseFee: number; perPost: number; cpmRate: number; cpmBasis: string; cpmCapPerVideo: number | null;
    viewTiers: string | null; bonus: number; minViews: number; viewWindowDays: number | null;
    payoutCap: number | null; starterDays: number | null; starterPerPost: number | null;
    payPerOriginal: boolean; currency: string;
  };
  period: { label: string; total: number; start: string; end: string };
  creators: {
    creatorId: string;
    displayName: string;
    earnings: Earnings;
    overridden: boolean;
    override: {
      baseFee: number | null; perPost: number | null; cpmRate: number | null;
      cpmBasis: string | null; cpmCapPerVideo: number | null; viewTiers: ViewTier[];
      bonus: number | null; minViews: number | null; viewWindowDays: number | null;
      payoutCap: number | null; flatDeal: number | null; note: string | null;
    };
  }[];
}

export default function CampaignDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [d, setD] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAssign, setShowAssign] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [editRates, setEditRates] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/campaigns/${id}`);
    if (res.ok) setD(await res.json());
    setLoading(false);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  async function del() {
    if (!confirm("Delete this campaign?")) return;
    await fetch(`/api/campaigns/${id}`, { method: "DELETE" });
    router.push("/campaigns");
  }

  if (loading) return <><TopBar crumbs={["Creator Hub", "Campaigns", "…"]} /><div className="py-16 text-center text-sm text-[var(--muted)]">Loading…</div></>;
  if (!d) return <><TopBar crumbs={["Creator Hub", "Campaigns"]} /><div className="py-16 text-center text-sm text-[var(--muted)]">Not found. <Link href="/campaigns" className="text-[var(--signal)]">Back</Link></div></>;

  const c = d.campaign;
  const cur = c.currency;
  const campaignTiers = parseViewTiers(c.viewTiers);
  const rules = [
    c.baseFee && `${money(c.baseFee, cur)} base`,
    c.perPost && `${money(c.perPost, cur)}/post`,
    c.cpmRate && `${money(c.cpmRate, cur)} CPM${c.cpmBasis === "perVideo" ? `/video${c.cpmCapPerVideo ? ` (cap ${money(c.cpmCapPerVideo, cur)})` : ""}` : ""}`,
    campaignTiers.length > 0 && campaignTiers.map((t) => `${fmtNum(t.views)}→${money(t.bonus, cur)}`).join(", "),
    c.bonus && `${money(c.bonus, cur)} bonus @ target`,
    c.minViews && `min ${fmtNum(c.minViews)} views`,
    c.viewWindowDays && `${c.viewWindowDays}d view window`,
    c.payoutCap && `cap ${money(c.payoutCap, cur)}`,
  ].filter(Boolean).join(" · ") || "No payout rules set";

  return (
    <>
      <TopBar
        crumbs={["Creator Hub", "Campaigns", c.name]}
        right={c.isAuto ? undefined : <>
          <button onClick={() => setShowAssign(true)} className="btn">Assign creators</button>
          <button onClick={() => setShowEdit(true)} className="btn">Edit</button>
        </>}
      />
      <div className="px-6 py-6">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="font-display text-2xl font-bold">{c.name}</h1>
              {c.isAuto && <span className="rounded bg-[color:rgba(124,92,255,0.15)] px-2 py-0.5 text-[11.5px] font-medium text-[var(--signal)]">auto</span>}
              <span className={`rounded-full px-2 py-1 text-[12.5px] font-medium ${c.status === "active" ? "bg-[color:rgba(87,201,138,0.12)] text-[var(--ok)]" : "bg-[var(--panel2)] text-[var(--muted)]"}`}>{c.status}</span>
            </div>
            <p className="mono mt-1 text-[13px] text-[var(--muted)]">{c.period} · target {c.targetVideos ?? "—"} posts · {rules}</p>
            {c.isAuto && (
              <p className="mt-1 text-[13px] text-[var(--muted)]">
                Mirrors the client&apos;s payment structure (edit it in Settings → Clients → Pay). Creators join automatically
                unless they&apos;re in a manual campaign. Per-creator rates can still be customized below.
              </p>
            )}
          </div>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Kpi label="Current period" value={d.period.label} />
          <Kpi label="Projected payout" value={money(d.period.total, cur)} tone="var(--signal)" />
          <Kpi label="Creators" value={`${d.creators.length}`} />
          <Kpi label="Target / period" value={c.targetVideos ? `${c.targetVideos} posts` : "—"} />
        </div>

        <div className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
            <h2 className="text-sm font-semibold">Assigned creators <span className="text-[var(--muted)]">· {d.period.label}</span></h2>
            <Link href="/payouts" className="text-xs text-[var(--signal)]">View payouts →</Link>
          </div>
          <div className="hidden grid-cols-[minmax(200px,2fr)_100px_110px_1fr_110px_80px] items-center gap-4 border-b border-[var(--line)] px-4 py-2.5 text-[11.5px] font-semibold uppercase tracking-wide text-[var(--faint)] md:grid">
            <div>Creator</div><div>Posts</div><div>Views</div><div>Breakdown</div><div>Earned</div><div className="text-right">Pay</div>
          </div>
          {d.creators.length === 0 ? (
            <div className="py-14 text-center text-sm text-[var(--muted)]">No creators assigned yet. Use “Assign creators”.</div>
          ) : (
            d.creators.map((cr) => (
              <div key={cr.creatorId} className="grid grid-cols-1 items-center gap-2 border-b border-[var(--line2)] px-4 py-3 last:border-0 md:grid-cols-[minmax(200px,2fr)_100px_110px_1fr_110px_80px] md:gap-4">
                <div className="flex items-center gap-2">
                  <Link href={`/creators/${cr.creatorId}`} className="font-medium hover:text-[var(--signal)]">{cr.displayName}</Link>
                  {cr.overridden && <span className="rounded bg-[color:rgba(124,92,255,0.15)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--signal)]">custom</span>}
                </div>
                <div className="mono text-[14px]">{cr.earnings.qualifyingPosts}{c.targetVideos ? `/${c.targetVideos}` : ""}{cr.earnings.targetMet ? " ✓" : ""}</div>
                <div className="mono text-[14px]">{fmtNum(cr.earnings.qualifyingViews)}</div>
                <div className="mono truncate text-[12.5px] text-[var(--muted)]">{cr.earnings.breakdown.map((b) => `${b.label} ${money(b.amount, cur)}`).join(" + ") || "—"}{cr.earnings.capped ? " (capped)" : ""}</div>
                <div className="mono text-[15px] font-bold text-[var(--signal)]">{money(cr.earnings.amount, cur)}</div>
                <div className="text-right">
                  <button onClick={() => setEditRates(cr.creatorId)} className="btn px-2.5 py-1.5 text-xs">Rates</button>
                </div>
              </div>
            ))
          )}
        </div>

        {!c.isAuto && (
          <div className="mt-5">
            <button onClick={del} className="rounded-lg border border-[color:rgba(242,104,95,0.4)] px-3 py-2 text-sm text-[var(--bad)] hover:bg-[color:rgba(242,104,95,0.1)]">Delete campaign</button>
          </div>
        )}
      </div>

      {showAssign && <AssignModal campaignId={c.id} clientId={c.clientId} assigned={d.creators.map((x) => x.creatorId)} onClose={() => setShowAssign(false)} onSaved={() => { setShowAssign(false); load(); }} />}
      {showEdit && <EditModal campaign={c} onClose={() => setShowEdit(false)} onSaved={() => { setShowEdit(false); load(); }} />}
      {editRates && (() => {
        const cr = d.creators.find((x) => x.creatorId === editRates);
        if (!cr) return null;
        return <RatesModal campaignId={c.id} creatorId={cr.creatorId} name={cr.displayName} currency={cur} override={cr.override} onClose={() => setEditRates(null)} onSaved={() => { setEditRates(null); load(); }} />;
      })()}
    </>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="card px-4 py-3">
      <div className="text-[12.5px] uppercase tracking-wide text-[var(--muted)]">{label}</div>
      <div className="mono mt-1.5 text-[15px] font-bold" style={{ color: tone }}>{value}</div>
    </div>
  );
}

function AssignModal({ campaignId, clientId, assigned, onClose, onSaved }: { campaignId: string; clientId: string; assigned: string[]; onClose: () => void; onSaved: () => void }) {
  const [creators, setCreators] = useState<{ id: string; displayName: string }[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set(assigned));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`/api/creators?clientId=${clientId}`).then((r) => r.json()).then(setCreators);
  }, [clientId]);

  async function save() {
    setSaving(true);
    await fetch(`/api/campaigns/${campaignId}/assign`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ creatorIds: [...sel] }) });
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[var(--scrim)] p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div className="card my-8 w-full max-w-md p-5" onMouseDown={(e) => e.stopPropagation()}>
        <h2 className="mb-3 font-display text-lg font-bold">Assign creators</h2>
        <div className="max-h-80 space-y-1 overflow-y-auto">
          {creators.length === 0 && <p className="text-sm text-[var(--muted)]">No creators in this client yet.</p>}
          {creators.map((c) => {
            const on = sel.has(c.id);
            return (
              <button key={c.id} onClick={() => setSel((s) => { const n = new Set(s); on ? n.delete(c.id) : n.add(c.id); return n; })}
                className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm ${on ? "border-[var(--signal)] bg-[var(--panel2)]" : "border-[var(--line)] hover:bg-[var(--panel2)]"}`}>
                <span className={`grid h-4 w-4 place-items-center rounded ${on ? "bg-[var(--signal)] text-white" : "border border-[var(--line)]"}`}>{on ? "✓" : ""}</span>
                {c.displayName}
              </button>
            );
          })}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="btn">Cancel</button>
          <button onClick={save} disabled={saving} className="btn btn-primary disabled:opacity-60">{saving ? "Saving…" : `Assign ${sel.size}`}</button>
        </div>
      </div>
    </div>
  );
}

function EditModal({ campaign, onClose, onSaved }: { campaign: Detail["campaign"]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(campaign.name);
  const [status, setStatus] = useState(campaign.status);
  const [targetVideos, setTargetVideos] = useState(campaign.targetVideos?.toString() ?? "");
  const [payForm, setPayForm] = useState(() =>
    payFormFromRules({
      period: campaign.period, baseFee: campaign.baseFee, perPost: campaign.perPost,
      cpmRate: campaign.cpmRate, cpmBasis: campaign.cpmBasis, cpmCapPerVideo: campaign.cpmCapPerVideo,
      viewTiers: parseViewTiers(campaign.viewTiers), bonus: campaign.bonus,
      minViews: campaign.minViews, viewWindowDays: campaign.viewWindowDays, payoutCap: campaign.payoutCap,
      starterDays: campaign.starterDays, starterPerPost: campaign.starterPerPost,
      payPerOriginal: campaign.payPerOriginal,
    })
  );
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    const rules = payFormToRules(payForm);
    // Send every rule field explicitly so cleared values reset to 0/null.
    await fetch(`/api/campaigns/${campaign.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name, status, period: payForm.period, targetVideos,
        baseFee: rules.baseFee ?? 0, perPost: rules.perPost ?? 0, cpmRate: rules.cpmRate ?? 0,
        cpmBasis: rules.cpmBasis ?? "aggregate", cpmCapPerVideo: rules.cpmCapPerVideo ?? "",
        viewTiers: rules.viewTiers ?? [], bonus: rules.bonus ?? 0, minViews: rules.minViews ?? 0,
        viewWindowDays: rules.viewWindowDays ?? "", payoutCap: rules.payoutCap ?? "",
        starterDays: rules.starterDays ?? "", starterPerPost: rules.starterPerPost ?? "",
        payPerOriginal: rules.payPerOriginal === true,
      }),
    });
    onSaved();
  }
  const field = "w-full px-3 py-2 text-sm";
  const label = "mb-1 block text-xs font-medium text-[var(--muted)]";
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[var(--scrim)] p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div className="card my-8 w-full max-w-lg p-5" onMouseDown={(e) => e.stopPropagation()}>
        <h2 className="mb-3 font-display text-lg font-bold">Edit campaign</h2>
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div><label className={label}>Name</label><input className={field} value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div><label className={label}>Status</label><Select className="w-full" value={status} onChange={setStatus} options={["active", "paused", "ended"].map((s) => [s, s] as [string, string])} /></div>
            <div><label className={label}>Target posts</label><input type="number" className={field} value={targetVideos} onChange={(e) => setTargetVideos(e.target.value)} /></div>
          </div>
          <div className="rounded-xl border border-[var(--line)] p-3">
            <div className="mb-2 text-xs font-semibold text-[var(--muted)]">Payout rules (per creator, per period)</div>
            <PayStructureEditor value={payForm} onChange={setPayForm} />
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="btn">Cancel</button>
          <button onClick={save} disabled={saving} className="btn btn-primary disabled:opacity-60">{saving ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}

function RatesModal({ campaignId, creatorId, name, currency, override, onClose, onSaved }: {
  campaignId: string; creatorId: string; name: string; currency: string;
  override: Detail["creators"][number]["override"]; onClose: () => void; onSaved: () => void;
}) {
  const s = (v: number | null) => (v == null ? "" : String(v));
  const [f, setF] = useState({
    baseFee: s(override.baseFee), perPost: s(override.perPost), cpmRate: s(override.cpmRate),
    cpmBasis: override.cpmBasis ?? "", cpmCapPerVideo: s(override.cpmCapPerVideo),
    bonus: s(override.bonus), minViews: s(override.minViews), viewWindowDays: s(override.viewWindowDays),
    payoutCap: s(override.payoutCap), flatDeal: s(override.flatDeal), note: override.note ?? "",
  });
  const [tiersOn, setTiersOn] = useState(override.viewTiers.length > 0);
  const [tiers, setTiers] = useState<{ views: string; bonus: string }[]>(
    override.viewTiers.length
      ? override.viewTiers.map((t) => ({ views: String(t.views), bonus: String(t.bonus) }))
      : [{ views: "", bonus: "" }]
  );
  const [saving, setSaving] = useState(false);
  function set<K extends keyof typeof f>(k: K, v: (typeof f)[K]) { setF((p) => ({ ...p, [k]: v })); }
  async function save() {
    setSaving(true);
    const viewTiers = tiersOn
      ? tiers.map((t) => ({ views: Number(t.views), bonus: Number(t.bonus) })).filter((t) => t.views > 0 && t.bonus > 0)
      : [];
    await fetch(`/api/campaigns/${campaignId}/creator/${creatorId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...f, viewTiers }),
    });
    onSaved();
  }
  async function clearAll() {
    setSaving(true);
    await fetch(`/api/campaigns/${campaignId}/creator/${creatorId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
    onSaved();
  }
  const field = "w-full px-3 py-2 text-sm";
  const label = "mb-1 block text-xs font-medium text-[var(--muted)]";
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[var(--scrim)] p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div className="card my-8 w-full max-w-lg p-5" onMouseDown={(e) => e.stopPropagation()}>
        <h2 className="font-display text-lg font-bold">Custom pay · {name}</h2>
        <p className="mt-1 text-xs text-[var(--muted)]">Leave a field blank to inherit the campaign rule. Set a <span className="text-[var(--ink)]">flat deal</span> to pay a fixed total and ignore everything else. Currency: {currency}.</p>
        <div className="mt-4 rounded-xl border border-[var(--line)] p-3">
          <div className="mb-2 text-xs font-semibold text-[var(--muted)]">Flat deal (overrides all rules)</div>
          <input type="number" className={field} value={f.flatDeal} onChange={(e) => set("flatDeal", e.target.value)} placeholder="e.g. 500 total for the period" />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div><label className={label}>Base fee</label><input type="number" className={field} value={f.baseFee} onChange={(e) => set("baseFee", e.target.value)} placeholder="inherit" /></div>
          <div><label className={label}>Per post</label><input type="number" className={field} value={f.perPost} onChange={(e) => set("perPost", e.target.value)} placeholder="inherit" /></div>
          <div><label className={label}>CPM</label><input type="number" className={field} value={f.cpmRate} onChange={(e) => set("cpmRate", e.target.value)} placeholder="inherit" /></div>
          <div>
            <label className={label}>CPM counted</label>
            <Select
              className="w-full"
              value={f.cpmBasis}
              onChange={(v) => set("cpmBasis", v)}
              options={[["", "inherit"], ["aggregate", "Aggregate / period"], ["perVideo", "Per video"]]}
            />
          </div>
          <div><label className={label}>CPM cap / video</label><input type="number" className={field} value={f.cpmCapPerVideo} onChange={(e) => set("cpmCapPerVideo", e.target.value)} placeholder="inherit" /></div>
          <div><label className={label}>Bonus</label><input type="number" className={field} value={f.bonus} onChange={(e) => set("bonus", e.target.value)} placeholder="inherit" /></div>
          <div><label className={label}>Min views</label><input type="number" className={field} value={f.minViews} onChange={(e) => set("minViews", e.target.value)} placeholder="inherit" /></div>
          <div><label className={label}>View window (days)</label><input type="number" className={field} value={f.viewWindowDays} onChange={(e) => set("viewWindowDays", e.target.value)} placeholder="inherit" /></div>
          <div><label className={label}>Cap</label><input type="number" className={field} value={f.payoutCap} onChange={(e) => set("payoutCap", e.target.value)} placeholder="inherit" /></div>
        </div>
        <div className="mt-3 rounded-xl border border-[var(--line)] p-3">
          <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-[var(--muted)]">
            <input type="checkbox" checked={tiersOn} onChange={(e) => setTiersOn(e.target.checked)} />
            Override view bonus tiers
          </label>
          {tiersOn && (
            <div className="mt-3">
              <TierEditor tiers={tiers} onChange={setTiers} />
            </div>
          )}
        </div>
        <div className="mt-3">
          <label className={label}>Note</label>
          <input className={field} value={f.note} onChange={(e) => set("note", e.target.value)} placeholder="e.g. hybrid: $200 + rev share" />
        </div>
        <div className="mt-5 flex items-center justify-between">
          <button onClick={clearAll} disabled={saving} className="btn text-xs">Reset to campaign</button>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn">Cancel</button>
            <button onClick={save} disabled={saving} className="btn btn-primary disabled:opacity-60">{saving ? "Saving…" : "Save"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
