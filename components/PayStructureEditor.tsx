"use client";

import { type PayRulesJson, type ViewTier } from "@/lib/payouts";

// Form state for building a pay structure. All numerics are strings so inputs
// can be blank; payFormToRules converts to the stored PayRulesJson shape.
export interface PayForm {
  period: string; // monthly | weekly
  baseFee: string; // retainer per period
  perPost: string; // flat per video
  viewComp: string; // none | tiers | cpm — how views are rewarded
  cpmRate: string;
  cpmBasis: string; // aggregate | perVideo
  cpmCapPerVideo: string;
  tiers: { views: string; bonus: string }[];
  bonus: string; // bonus when the period post target is met
  minViews: string; // min views for a post to qualify
  payoutCap: string; // max per period
}

export function emptyPayForm(): PayForm {
  return {
    period: "monthly",
    baseFee: "",
    perPost: "",
    viewComp: "none",
    cpmRate: "",
    cpmBasis: "aggregate",
    cpmCapPerVideo: "",
    tiers: [{ views: "", bonus: "" }],
    bonus: "",
    minViews: "",
    payoutCap: "",
  };
}

export function payFormFromRules(r: PayRulesJson | null | undefined): PayForm {
  const f = emptyPayForm();
  if (!r) return f;
  const s = (v: number | null | undefined) => (v == null || v === 0 ? "" : String(v));
  f.period = r.period === "weekly" ? "weekly" : "monthly";
  f.baseFee = s(r.baseFee);
  f.perPost = s(r.perPost);
  f.cpmRate = s(r.cpmRate);
  f.cpmBasis = r.cpmBasis === "perVideo" ? "perVideo" : "aggregate";
  f.cpmCapPerVideo = s(r.cpmCapPerVideo);
  if (r.viewTiers?.length) f.tiers = r.viewTiers.map((t) => ({ views: String(t.views), bonus: String(t.bonus) }));
  f.viewComp = r.viewTiers?.length ? "tiers" : r.cpmRate ? "cpm" : "none";
  f.bonus = s(r.bonus);
  f.minViews = s(r.minViews);
  f.payoutCap = s(r.payoutCap);
  return f;
}

export function payFormToRules(f: PayForm): PayRulesJson {
  const num = (v: string) => {
    const n = Number(v);
    return v.trim() !== "" && Number.isFinite(n) && n > 0 ? n : undefined;
  };
  const rules: PayRulesJson = { period: f.period === "weekly" ? "weekly" : "monthly" };
  if (num(f.baseFee)) rules.baseFee = num(f.baseFee);
  if (num(f.perPost)) rules.perPost = num(f.perPost);
  if (f.viewComp === "cpm" && num(f.cpmRate)) {
    rules.cpmRate = num(f.cpmRate);
    if (f.cpmBasis === "perVideo") {
      rules.cpmBasis = "perVideo";
      if (num(f.cpmCapPerVideo)) rules.cpmCapPerVideo = num(f.cpmCapPerVideo);
    }
  }
  if (f.viewComp === "tiers") {
    const tiers: ViewTier[] = f.tiers
      .map((t) => ({ views: Number(t.views), bonus: Number(t.bonus) }))
      .filter((t) => Number.isFinite(t.views) && t.views > 0 && Number.isFinite(t.bonus) && t.bonus > 0)
      .sort((a, b) => a.views - b.views);
    if (tiers.length) rules.viewTiers = tiers;
  }
  if (num(f.bonus)) rules.bonus = num(f.bonus);
  if (num(f.minViews)) rules.minViews = num(f.minViews);
  if (num(f.payoutCap)) rules.payoutCap = num(f.payoutCap);
  return rules;
}

/** One-line human summary, e.g. "$500/mo + $20/video + tiers (3)". */
export function payFormSummary(f: PayForm): string {
  const parts: string[] = [];
  const per = f.period === "weekly" ? "wk" : "mo";
  if (Number(f.baseFee) > 0) parts.push(`$${f.baseFee}/${per}`);
  if (Number(f.perPost) > 0) parts.push(`$${f.perPost}/video`);
  if (f.viewComp === "cpm" && Number(f.cpmRate) > 0)
    parts.push(`$${f.cpmRate} CPM ${f.cpmBasis === "perVideo" ? "per video" : `(${per} total)`}`);
  if (f.viewComp === "tiers") {
    const n = f.tiers.filter((t) => Number(t.views) > 0 && Number(t.bonus) > 0).length;
    if (n) parts.push(`${n} view bonus tier${n > 1 ? "s" : ""}`);
  }
  return parts.join(" + ") || "No pay set";
}

const field = "w-full px-3 py-2 text-sm";
const label = "mb-1 block text-xs font-medium text-[var(--muted)]";

export function TierEditor({
  tiers,
  onChange,
}: {
  tiers: { views: string; bonus: string }[];
  onChange: (tiers: { views: string; bonus: string }[]) => void;
}) {
  return (
    <div className="space-y-2">
      {tiers.map((t, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="text-[11px] text-[var(--faint)]">at</span>
          <input
            type="number"
            className={`${field} flex-1`}
            value={t.views}
            onChange={(e) => onChange(tiers.map((x, j) => (j === i ? { ...x, views: e.target.value } : x)))}
            placeholder="100000"
          />
          <span className="text-[11px] text-[var(--faint)]">views →</span>
          <input
            type="number"
            className={`${field} w-24 flex-none`}
            value={t.bonus}
            onChange={(e) => onChange(tiers.map((x, j) => (j === i ? { ...x, bonus: e.target.value } : x)))}
            placeholder="$"
          />
          <button
            onClick={() => onChange(tiers.filter((_, j) => j !== i))}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-[var(--faint)] hover:bg-[var(--panel2)] hover:text-[var(--bad)]"
            title="Remove tier"
          >
            ✕
          </button>
        </div>
      ))}
      <button
        onClick={() => onChange([...tiers, { views: "", bonus: "" }])}
        className="text-xs text-[var(--signal)] hover:underline"
      >
        + Add tier
      </button>
      <p className="text-[11px] text-[var(--faint)]">A video pays the highest tier it reaches.</p>
    </div>
  );
}

// The pay structure builder used everywhere a deal is defined: client default,
// per-creator deal, campaign rules. Keep the mental model identical in all three.
export function PayStructureEditor({
  value,
  onChange,
  showPeriod = true,
}: {
  value: PayForm;
  onChange: (f: PayForm) => void;
  showPeriod?: boolean;
}) {
  const set = <K extends keyof PayForm>(k: K, v: PayForm[K]) => onChange({ ...value, [k]: v });

  return (
    <div className="space-y-3">
      <div className={`grid gap-3 ${showPeriod ? "grid-cols-3" : "grid-cols-2"}`}>
        {showPeriod && (
          <div>
            <label className={label}>Billing period</label>
            <select className={field} value={value.period} onChange={(e) => set("period", e.target.value)}>
              <option value="monthly">Monthly</option>
              <option value="weekly">Weekly</option>
            </select>
          </div>
        )}
        <div>
          <label className={label}>Retainer / {value.period === "weekly" ? "week" : "month"}</label>
          <input type="number" className={field} value={value.baseFee} onChange={(e) => set("baseFee", e.target.value)} placeholder="0" />
        </div>
        <div>
          <label className={label}>Per video</label>
          <input type="number" className={field} value={value.perPost} onChange={(e) => set("perPost", e.target.value)} placeholder="0" />
        </div>
      </div>

      <div>
        <label className={label}>View bonuses</label>
        <div className="flex gap-1.5">
          {[
            ["none", "None"],
            ["tiers", "View tiers"],
            ["cpm", "CPM"],
          ].map(([v, l]) => (
            <button
              key={v}
              onClick={() => set("viewComp", v)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
                value.viewComp === v
                  ? "border-[var(--signal)] bg-[var(--panel2)] text-[var(--ink)]"
                  : "border-[var(--line)] text-[var(--muted)] hover:bg-[var(--panel2)]"
              }`}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      {value.viewComp === "tiers" && (
        <div className="rounded-xl border border-[var(--line)] p-3">
          <TierEditor tiers={value.tiers} onChange={(tiers) => set("tiers", tiers)} />
        </div>
      )}

      {value.viewComp === "cpm" && (
        <div className="rounded-xl border border-[var(--line)] p-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div>
              <label className={label}>CPM ($ / 1k views)</label>
              <input type="number" className={field} value={value.cpmRate} onChange={(e) => set("cpmRate", e.target.value)} placeholder="1.00" />
            </div>
            <div>
              <label className={label}>Counted</label>
              <select className={field} value={value.cpmBasis} onChange={(e) => set("cpmBasis", e.target.value)}>
                <option value="aggregate">All views, {value.period === "weekly" ? "weekly" : "monthly"} total</option>
                <option value="perVideo">Per video</option>
              </select>
            </div>
            {value.cpmBasis === "perVideo" && (
              <div>
                <label className={label}>Cap / video <span className="text-[var(--faint)]">(optional)</span></label>
                <input type="number" className={field} value={value.cpmCapPerVideo} onChange={(e) => set("cpmCapPerVideo", e.target.value)} placeholder="none" />
              </div>
            )}
          </div>
        </div>
      )}

      <details className="rounded-xl border border-[var(--line)] p-3">
        <summary className="cursor-pointer text-xs font-semibold text-[var(--muted)]">More rules</summary>
        <div className="mt-3 grid grid-cols-3 gap-3">
          <div>
            <label className={label}>Target-met bonus</label>
            <input type="number" className={field} value={value.bonus} onChange={(e) => set("bonus", e.target.value)} placeholder="0" />
          </div>
          <div>
            <label className={label}>Min views / video</label>
            <input type="number" className={field} value={value.minViews} onChange={(e) => set("minViews", e.target.value)} placeholder="0" />
          </div>
          <div>
            <label className={label}>Payout cap / period</label>
            <input type="number" className={field} value={value.payoutCap} onChange={(e) => set("payoutCap", e.target.value)} placeholder="none" />
          </div>
        </div>
      </details>
    </div>
  );
}
