"use client";

import { useState } from "react";
import { PAYMENT_METHODS } from "@/lib/pay";

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
  const [form, setForm] = useState({
    displayName: "",
    tiktokUrl: "",
    instagramUrl: "",
    source: "sideshift",
    sourceDetail: "",
    sideshiftUrl: "",
    paymentMethod: "sideshift",
    paymentHandle: "",
    expectedPerWeek: 7,
    preferredChannel: "",
    phone: "",
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
    if (!form.tiktokUrl.trim() && !form.instagramUrl.trim()) {
      setError("Add at least a TikTok or Instagram profile URL to track");
      return;
    }
    setSaving(true);
    const res = await fetch("/api/creators", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, clientId }),
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
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={label}>Source</label>
              <select
                className={field}
                value={form.source}
                onChange={(e) => set("source", e.target.value)}
              >
                {SOURCES.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
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
              <select className={field} value={form.paymentMethod} onChange={(e) => set("paymentMethod", e.target.value)}>
                {PAYMENT_METHODS.map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
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

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className={label}>Preferred channel</label>
              <select
                className={field}
                value={form.preferredChannel}
                onChange={(e) => set("preferredChannel", e.target.value)}
              >
                {CHANNELS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
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
              <label className={label}>Contact handle</label>
              <input
                className={field}
                value={form.contactHandle}
                onChange={(e) => set("contactHandle", e.target.value)}
                placeholder="@dm / email"
              />
            </div>
          </div>

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
