"use client";

import { useState } from "react";
import { ClientLogo } from "./ClientLogo";
import { logoFromWebsite } from "@/lib/brand";
import { PayStructureEditor, emptyPayForm, payFormToRules } from "./PayStructureEditor";

const COLORS = ["#8b5cf6", "#4d8dff", "#ec5a35", "#2f9464", "#c98419", "#d6438f", "#0f766e", "#b83a2e"];

// Preview resolves through the same endpoint the API stores, so what you see
// here is exactly what the roster will render.
function previewLogo(website: string, logoUrl: string): string | null {
  if (logoUrl.trim()) return logoUrl.trim();
  return website.trim() ? logoFromWebsite(website.trim()) : null;
}

export function AddClientModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (client: { id: string }) => void;
}) {
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [color, setColor] = useState(COLORS[0]);
  const [payMode, setPayMode] = useState("uniform");
  const [payForm, setPayForm] = useState(emptyPayForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!name.trim()) {
      setError("Client name is required");
      return;
    }
    setSaving(true);
    const res = await fetch("/api/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, website, logoUrl, color, payMode, defaultPayRules: payFormToRules(payForm) }),
    });
    setSaving(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || "Failed to add client");
      return;
    }
    onCreated(await res.json());
  }

  const field = "w-full px-3 py-2 text-sm";
  const label = "mb-1 block text-xs font-medium text-[var(--muted)]";
  const preview = previewLogo(website, logoUrl);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[var(--scrim)] p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div className="card my-8 w-full max-w-lg p-5" onMouseDown={(e) => e.stopPropagation()}>
        <h2 className="font-display text-lg font-bold">Add client</h2>
        <p className="text-xs text-[var(--muted)]">Add their website and we&apos;ll pull their logo automatically.</p>

        <div className="mt-4 flex items-center gap-3">
          <ClientLogo name={name || "?"} logoUrl={preview} color={color} size={48} radius={12} />
          <div className="text-xs text-[var(--muted)]">
            {preview ? "Logo preview — falls back to initials if it can't load." : "Preview appears once you add a website or logo."}
          </div>
        </div>

        <div className="mt-4 space-y-3">
          <div>
            <label className={label}>Client name *</label>
            <input autoFocus className={field} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Acme Supplements" />
          </div>
          <div>
            <label className={label}>Website <span className="text-[var(--faint)]">(auto-fetches their logo)</span></label>
            <input className={field} value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="acme.com" />
          </div>
          <div>
            <label className={label}>Logo image URL <span className="text-[var(--faint)]">(optional override)</span></label>
            <input className={field} value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://…/logo.png" />
          </div>
          <div>
            <label className={label}>Fallback color</label>
            <div className="flex flex-wrap gap-1.5">
              {COLORS.map((c) => (
                <button key={c} onClick={() => setColor(c)} className={`h-7 w-7 rounded-lg ${color === c ? "ring-2 ring-offset-2 ring-offset-[var(--panel)]" : ""}`} style={{ background: c, boxShadow: color === c ? `0 0 0 2px ${c}` : "none" }} />
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-[var(--line)] p-3">
            <div className="mb-1 text-xs font-semibold text-[var(--muted)]">Payment structure</div>
            <p className="mb-2.5 text-[12.5px] text-[var(--faint)]">
              This is how payouts get calculated for this client&apos;s creators. An automatic campaign is created from
              it, so payouts start tracking as soon as you add creators — no extra setup.
            </p>
            <div className="mb-3 grid grid-cols-2 gap-1.5">
              {[
                ["uniform", "Same for all creators", "Every creator is paid on the structure below."],
                ["individual", "Individualized per creator", "Each creator gets their own deal — the structure below is the starting point."],
              ].map(([v, l, d]) => (
                <button
                  key={v}
                  onClick={() => setPayMode(v)}
                  className={`rounded-lg border p-2.5 text-left ${
                    payMode === v
                      ? "border-[var(--signal)] bg-[var(--panel2)]"
                      : "border-[var(--line)] hover:bg-[var(--panel2)]"
                  }`}
                >
                  <div className="text-xs font-semibold">{l}</div>
                  <div className="mt-0.5 text-[12.5px] leading-snug text-[var(--faint)]">{d}</div>
                </button>
              ))}
            </div>
            <div className="mb-1.5 text-[12.5px] font-medium text-[var(--muted)]">
              {payMode === "individual" ? "Default structure (starting point for each creator)" : "Structure for every creator"}
            </div>
            <PayStructureEditor value={payForm} onChange={setPayForm} />
          </div>

          {error && <p className="rounded-lg bg-[color:rgba(208,71,58,0.1)] px-3 py-2 text-sm text-[var(--bad)]">{error}</p>}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="btn">Cancel</button>
          <button onClick={submit} disabled={saving} className="btn btn-primary disabled:opacity-60">{saving ? "Adding…" : "Add client"}</button>
        </div>
      </div>
    </div>
  );
}
