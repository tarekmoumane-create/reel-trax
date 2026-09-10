"use client";

import { useState } from "react";
import { PAYMENT_METHODS } from "@/lib/pay";
import { parsePayRules } from "@/lib/payouts";
import { useClients } from "@/app/providers";
import { PayStructureEditor, payFormFromRules, payFormToRules, payFormSummary } from "./PayStructureEditor";
import { Select } from "./Select";

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const SOURCES = [
  ["sideshift", "Sideshift"],
  ["referral", "Referral"],
  ["outreach", "Outreach"],
  ["agency", "Agency"],
  ["other", "Other"],
];

const CHANNELS = [
  ["", "—"],
  ["sms", "SMS"],
  ["imessage", "iMessage"],
  ["instagram", "Instagram DM"],
  ["whatsapp", "WhatsApp"],
  ["discord", "Discord"],
  ["email", "Email"],
  ["other", "Other"],
];

export function AddCreatorModal({
  clientId,
  clientName,
  onClose,
  onCreated,
}: {
  clientId: string;
  clientName: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { clients } = useClients();
  const client = clients.find((c) => c.id === clientId);
  const individualized = client?.payMode === "individual";
  const clientDefault = parsePayRules(client?.defaultPayRules);

  // Individualized clients: the creator's deal starts from the client default
  // and can be customized right here. Uniform clients skip this entirely.
  const [customPay, setCustomPay] = useState(false);
  const [payForm, setPayForm] = useState(() => payFormFromRules(clientDefault));
  const [form, setForm] = useState({
    displayName: "",
    tiktokUrl: "",
    instagramUrl: "",
    youtubeUrl: "",
    threadsUrl: "",
    facebookUrl: "",
    source: "sideshift",
    sourceDetail: "",
    onboardedAt: todayStr(),
    sideshiftUrl: "",
    paymentMethod: "sideshift",
    paymentHandle: "",
    expectedPerWeek: 7,
    preferredChannel: "",
    phone: "",
    discord: "",
    discordChannel: "",
    contactHandle: "",
    email: "",
    notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function submit() {
    setError(null);
    if (!form.displayName.trim()) {
      setError("Creator name is required");
      return;
    }
    if (!form.tiktokUrl.trim() && !form.instagramUrl.trim() && !form.youtubeUrl.trim() && !form.threadsUrl.trim() && !form.facebookUrl.trim()) {
      setError("Add at least one profile URL (TikTok, Instagram, YouTube, Threads or Facebook) to track");
      return;
    }
    setSaving(true);
    // Store a personal deal only when it deviates from the client default —
    // creators on the default keep inheriting future changes to it.
    const payRules = individualized && customPay ? payFormToRules(payForm) : null;
    const res = await fetch("/api/creators", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, clientId, payRules }),
    });
    setSaving(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error || "Failed to add creator");
      return;
    }
    onCreated();
  }

  const field = "w-full px-3 py-2 text-sm";
  const label = "mb-1 block text-xs font-medium text-[var(--muted)]";

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[var(--scrim)] p-4 backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <div
        className="card my-8 w-full max-w-lg p-5"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Add creator</h2>
            <p className="text-xs text-[var(--muted)]">
              to <span className="text-[var(--text)]">{clientName}</span> · paste
              a profile URL and tracking starts automatically
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-[var(--muted)] hover:bg-[var(--panel2)]"
          >
            ✕
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className={label}>Creator name *</label>
            <input
              className={field}
              autoFocus
              value={form.displayName}
              onChange={(e) => set("displayName", e.target.value)}
              placeholder="e.g. Jane Doe"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={label}>TikTok profile URL</label>
              <input
                className={field}
                value={form.tiktokUrl}
                onChange={(e) => set("tiktokUrl", e.target.value)}
                placeholder="tiktok.com/@handle"
              />
            </div>
            <div>
              <label className={label}>Instagram profile URL</label>
              <input
                className={field}
                value={form.instagramUrl}
                onChange={(e) => set("instagramUrl", e.target.value)}
                placeholder="instagram.com/handle"
              />
            </div>
            <div>
              <label className={label}>YouTube channel URL <span className="text-[var(--faint)]">(Shorts)</span></label>
              <input
                className={field}
                value={form.youtubeUrl}
                onChange={(e) => set("youtubeUrl", e.target.value)}
                placeholder="youtube.com/@handle"
              />
            </div>
            <div>
              <label className={label}>Threads profile URL</label>
              <input
                className={field}
                value={form.threadsUrl}
                onChange={(e) => set("threadsUrl", e.target.value)}
                placeholder="threads.com/@handle"
              />
            </div>
            <div>
              <label className={label}>Facebook page URL <span className="text-[var(--faint)]">(Reels)</span></label>
              <input
                className={field}
                value={form.facebookUrl}
                onChange={(e) => set("facebookUrl", e.target.value)}
                placeholder="facebook.com/pagename"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className={label}>Source</label>
              <Select
                className="w-full"
                value={form.source}
                onChange={(v) => set("source", v)}
                options={SOURCES as [string, string][]}
              />
            </div>
            <div>
              <label className={label}>Onboarded on</label>
              <input
                type="date"
                className={field}
                max={todayStr()}
                value={form.onboardedAt}
                onChange={(e) => set("onboardedAt", e.target.value)}
              />
            </div>
            <div>
              <label className={label}>Target posts / week</label>
              <input
                type="number"
                min={1}
                max={21}
                className={field}
                value={form.expectedPerWeek}
                onChange={(e) =>
                  set("expectedPerWeek", Number(e.target.value) || 7)
                }
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={label}>Payment method</label>
              <Select
                className="w-full"
                value={form.paymentMethod}
                onChange={(v) => set("paymentMethod", v)}
                options={PAYMENT_METHODS as [string, string][]}
              />
            </div>
            {form.paymentMethod === "sideshift" ? (
              <div>
                <label className={label}>Sideshift chat URL <span className="text-[var(--faint)]">(pay here)</span></label>
                <input className={field} value={form.sideshiftUrl} onChange={(e) => set("sideshiftUrl", e.target.value)} placeholder="link to their Sideshift chat" />
              </div>
            ) : (form.paymentMethod === "venmo" || form.paymentMethod === "paypal") ? (
              <div>
                <label className={label}>{form.paymentMethod === "venmo" ? "Venmo" : "PayPal"} username</label>
                <input className={field} value={form.paymentHandle} onChange={(e) => set("paymentHandle", e.target.value)} placeholder="@username" />
              </div>
            ) : null}
          </div>

          <div className="rounded-xl border border-[var(--line)] p-3">
            <div className="mb-2 text-xs font-semibold text-[var(--muted)]">Contact info</div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className={label}>Preferred channel</label>
                <Select
                  className="w-full"
                  value={form.preferredChannel}
                  onChange={(v) => set("preferredChannel", v)}
                  options={CHANNELS as [string, string][]}
                />
              </div>
              <div>
                <label className={label}>Phone</label>
                <input
                  className={field}
                  value={form.phone}
                  onChange={(e) => set("phone", e.target.value)}
                  placeholder="+1…"
                />
              </div>
              <div>
                <label className={label}>Discord handle</label>
                <input
                  className={field}
                  value={form.discord}
                  onChange={(e) => set("discord", e.target.value)}
                  placeholder="username"
                />
              </div>
              <div>
                <label className={label}>Discord channel <span className="text-[var(--faint)]">(link)</span></label>
                <input
                  className={field}
                  value={form.discordChannel}
                  onChange={(e) => set("discordChannel", e.target.value)}
                  placeholder="https://discord.com/channels/…"
                />
              </div>
              <div>
                <label className={label}>Email</label>
                <input
                  className={field}
                  value={form.email}
                  onChange={(e) => set("email", e.target.value)}
                  placeholder="name@email.com"
                />
              </div>
              <div>
                <label className={label}>Other handle</label>
                <input
                  className={field}
                  value={form.contactHandle}
                  onChange={(e) => set("contactHandle", e.target.value)}
                  placeholder="@dm handle"
                />
              </div>
            </div>
          </div>

          {individualized && (
            <div className="rounded-xl border border-[var(--line)] p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-semibold text-[var(--muted)]">Pay structure</div>
                  <p className="mt-0.5 text-[11px] text-[var(--faint)]">
                    {clientName} pays creators individually.{" "}
                    {customPay
                      ? "This creator gets the custom deal below."
                      : `Currently on the client default: ${payFormSummary(payFormFromRules(clientDefault))}.`}
                  </p>
                </div>
                <button
                  onClick={() => {
                    if (customPay) setPayForm(payFormFromRules(clientDefault));
                    setCustomPay(!customPay);
                  }}
                  className={`shrink-0 rounded-lg border px-2.5 py-1.5 text-xs font-medium ${
                    customPay
                      ? "border-[var(--line)] text-[var(--muted)] hover:bg-[var(--panel2)]"
                      : "border-[var(--signal)] text-[var(--signal)] hover:bg-[var(--panel2)]"
                  }`}
                >
                  {customPay ? "Use client default" : "Customize deal"}
                </button>
              </div>
              {customPay && (
                <div className="mt-3">
                  <PayStructureEditor value={payForm} onChange={setPayForm} showPeriod={false} />
                </div>
              )}
            </div>
          )}

          <div>
            <label className={label}>Notes</label>
            <textarea
              className={field}
              rows={2}
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              placeholder="Anything to remember about this creator…"
            />
          </div>

          {error && (
            <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">
              {error}
            </p>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border px-4 py-2 text-sm hover:bg-[var(--panel2)]"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving}
            className="rounded-lg bg-[var(--signal)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {saving ? "Adding…" : "Add creator"}
          </button>
        </div>
      </div>
    </div>
  );
}
