"use client";

import { useEffect, useState } from "react";
import { useClients } from "../providers";
import { ClientLogo } from "@/components/ClientLogo";
import { parsePayRules } from "@/lib/payouts";
import { PayStructureEditor, payFormFromRules, payFormToRules, payFormSummary } from "@/components/PayStructureEditor";
import { Select } from "@/components/Select";

const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "UTC",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Australia/Sydney",
];

interface SettingsData {
  hasApiKey: boolean;
  apiKeyMasked: string | null;
  apiKeyFromEnv: boolean;
  hasAnthropicKey: boolean;
  anthropicKeyMasked: string | null;
  anthropicKeyFromEnv: boolean;
  hasLightReelKey: boolean;
  lightReelKeyMasked: string | null;
  lightReelKeyFromEnv: boolean;
  timeZone: string;
  invoice: { fromName: string; fromDetails: string; paymentInstructions: string };
}

export default function SettingsPage() {
  const { clients, reloadClients } = useClients();
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [tz, setTz] = useState("America/New_York");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [lightReelKey, setLightReelKey] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const [savingAnthropic, setSavingAnthropic] = useState(false);
  const [savingLightReel, setSavingLightReel] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");
  const [invoice, setInvoice] = useState({ fromName: "", fromDetails: "", paymentInstructions: "" });
  const [savingInvoice, setSavingInvoice] = useState(false);
  const [invoiceSaved, setInvoiceSaved] = useState(false);

  async function loadSettings() {
    const res = await fetch("/api/settings");
    const d: SettingsData = await res.json();
    setSettings(d);
    setTz(d.timeZone);
    if (d.invoice) setInvoice(d.invoice);
  }

  async function saveInvoice() {
    setSavingInvoice(true);
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invoice }),
    });
    setSavingInvoice(false);
    setInvoiceSaved(true);
    setTimeout(() => setInvoiceSaved(false), 1800);
  }

  useEffect(() => {
    loadSettings();
  }, []);

  async function saveKey() {
    setSavingKey(true);
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scrapeCreatorsApiKey: apiKey, timeZone: tz }),
    });
    setApiKey("");
    setSavingKey(false);
    setSavedMsg("Saved");
    setTimeout(() => setSavedMsg(""), 1800);
    await loadSettings();
  }

  async function saveAnthropic() {
    setSavingAnthropic(true);
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ anthropicApiKey: anthropicKey }),
    });
    setAnthropicKey("");
    setSavingAnthropic(false);
    await loadSettings();
  }

  async function saveLightReel() {
    setSavingLightReel(true);
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lightReelApiKey: lightReelKey }),
    });
    setLightReelKey("");
    setSavingLightReel(false);
    await loadSettings();
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:px-6">
      <h1 className="mb-5 text-xl font-semibold">Settings</h1>

      {/* API key */}
      <section className="card mb-4 p-5">
        <h2 className="text-sm font-semibold">ScrapeCreators API key</h2>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Powers automatic posting-cadence tracking. Get one at{" "}
          <a href="https://scrapecreators.com" target="_blank" rel="noreferrer" className="text-[var(--signal)]">
            scrapecreators.com
          </a>
          . Stored server-side and never shown in full.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full px-2.5 py-1 text-xs ${
              settings?.hasApiKey
                ? "bg-green-500/12 text-green-400"
                : "bg-red-500/12 text-red-400"
            }`}
          >
            {settings?.hasApiKey ? `Connected · ${settings.apiKeyMasked}` : "Not set"}
          </span>
          {settings?.apiKeyFromEnv && (
            <span className="text-xs text-[var(--muted)]">(from environment variable)</span>
          )}
        </div>
        <div className="mt-3 flex gap-2">
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Paste new API key…"
            className="flex-1 px-3 py-2 text-sm"
          />
          <button
            onClick={saveKey}
            disabled={savingKey || !apiKey.trim()}
            className="rounded-lg bg-[var(--signal)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {savingKey ? "Saving…" : "Save"}
          </button>
        </div>
        {savedMsg && <p className="mt-2 text-xs text-green-400">{savedMsg}</p>}
      </section>

      {/* Anthropic key (copilot) */}
      <section className="card mb-4 p-5">
        <h2 className="text-sm font-semibold">Anthropic API key <span className="font-normal text-[var(--muted)]">· powers the Copilot</span></h2>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Lets the Copilot answer questions about your creators and payouts. Get one at{" "}
          <a href="https://console.anthropic.com" target="_blank" rel="noreferrer" className="text-[var(--signal)]">console.anthropic.com</a>. Stored server-side, never shown in full.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2.5 py-1 text-xs ${settings?.hasAnthropicKey ? "bg-green-500/12 text-green-400" : "bg-red-500/12 text-red-400"}`}>
            {settings?.hasAnthropicKey ? `Connected · ${settings.anthropicKeyMasked}` : "Not set"}
          </span>
          {settings?.anthropicKeyFromEnv && <span className="text-xs text-[var(--muted)]">(from environment variable)</span>}
        </div>
        <div className="mt-3 flex gap-2">
          <input type="password" value={anthropicKey} onChange={(e) => setAnthropicKey(e.target.value)} placeholder="sk-ant-…" className="flex-1 px-3 py-2 text-sm" />
          <button onClick={saveAnthropic} disabled={savingAnthropic || !anthropicKey.trim()} className="btn btn-primary disabled:opacity-50">
            {savingAnthropic ? "Saving…" : "Save"}
          </button>
        </div>
      </section>

      {/* LightReel key (discover) */}
      <section className="card mb-4 p-5">
        <h2 className="text-sm font-semibold">LightReel API key <span className="font-normal text-[var(--muted)]">· powers Discover</span></h2>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Powers the Discover research console (competitor hooks, trends, creator finding). Get one at{" "}
          <a href="https://lightreel.ai/docs" target="_blank" rel="noreferrer" className="text-[var(--signal)]">lightreel.ai</a>. Stored server-side, never shown in full.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2.5 py-1 text-xs ${settings?.hasLightReelKey ? "bg-green-500/12 text-green-400" : "bg-red-500/12 text-red-400"}`}>
            {settings?.hasLightReelKey ? `Connected · ${settings.lightReelKeyMasked}` : "Not set"}
          </span>
          {settings?.lightReelKeyFromEnv && <span className="text-xs text-[var(--muted)]">(from environment variable)</span>}
        </div>
        <div className="mt-3 flex gap-2">
          <input type="password" value={lightReelKey} onChange={(e) => setLightReelKey(e.target.value)} placeholder="lr_live_…" className="flex-1 px-3 py-2 text-sm" />
          <button onClick={saveLightReel} disabled={savingLightReel || !lightReelKey.trim()} className="btn btn-primary disabled:opacity-50">
            {savingLightReel ? "Saving…" : "Save"}
          </button>
        </div>
      </section>

      {/* timezone */}
      <section className="card mb-4 p-5">
        <h2 className="text-sm font-semibold">Timezone</h2>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Posting days, streaks and calendars are bucketed in this timezone.
        </p>
        <div className="mt-3 flex gap-2">
          <Select className="flex-1" value={tz} onChange={setTz} options={TIMEZONES.map((z) => [z, z] as [string, string])} />
          <button
            onClick={saveKey}
            className="rounded-lg border px-4 py-2 text-sm hover:bg-[var(--panel2)]"
          >
            Save
          </button>
        </div>
      </section>

      {/* invoice details */}
      <section className="card mb-4 p-5">
        <h2 className="text-sm font-semibold">Invoice details <span className="font-normal text-[var(--muted)]">· the &quot;from&quot; block on exported invoices</span></h2>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Shown at the top of every invoice you export from Payouts → Invoice. Payment instructions print at the bottom.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--muted)]">Your agency / business name</label>
            <input value={invoice.fromName} onChange={(e) => setInvoice({ ...invoice, fromName: e.target.value })} placeholder="The Reel Work" className="w-full px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--muted)]">Address, email, phone <span className="text-[var(--faint)]">(one per line)</span></label>
            <textarea rows={3} value={invoice.fromDetails} onChange={(e) => setInvoice({ ...invoice, fromDetails: e.target.value })} placeholder={"123 Main St\nyou@agency.com"} className="w-full px-3 py-2 text-sm" />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium text-[var(--muted)]">Payment instructions</label>
            <textarea rows={2} value={invoice.paymentInstructions} onChange={(e) => setInvoice({ ...invoice, paymentInstructions: e.target.value })} placeholder="Wire / ACH details, PayPal, net terms…" className="w-full px-3 py-2 text-sm" />
          </div>
        </div>
        <div className="mt-3 flex items-center justify-end gap-2">
          {invoiceSaved && <span className="text-xs text-green-400">Saved</span>}
          <button onClick={saveInvoice} disabled={savingInvoice} className="btn btn-primary disabled:opacity-50">{savingInvoice ? "Saving…" : "Save"}</button>
        </div>
      </section>

      {/* clients */}
      <section className="card mb-4 p-5">
        <h2 className="text-sm font-semibold">Clients</h2>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Toggle between these in the top-left switcher. {clients.length} total.
        </p>
        <div className="mt-3 space-y-2">
          {clients.map((c) => (
            <ClientRow key={c.id} client={c} onChange={reloadClients} />
          ))}
          {clients.length === 0 && (
            <p className="text-sm text-[var(--muted)]">
              No clients yet — create one from the switcher.
            </p>
          )}
        </div>
      </section>

      {/* how tracking works */}
      <section className="card p-5">
        <h2 className="text-sm font-semibold">How automatic tracking works</h2>
        <ul className="mt-2 space-y-1.5 text-xs text-[var(--muted)]">
          <li>• Add a creator with their TikTok, Instagram or YouTube (Shorts) profile URL.</li>
          <li>• A scheduled job checks each active creator&apos;s public posts and updates their cadence — no action needed from you.</li>
          <li>• Set the schedule in <code className="rounded bg-[var(--panel2)] px-1">vercel.json</code> (default: every 6 hours). &quot;Sync now&quot; forces an immediate refresh.</li>
          <li>• &quot;Gone quiet&quot; / &quot;Behind&quot; flags are driven by each creator&apos;s target posts-per-week.</li>
        </ul>
      </section>
    </div>
  );
}

function ClientRow({
  client,
  onChange,
}: {
  client: { id: string; name: string; color: string; website?: string | null; logoUrl?: string | null; payMode?: string; defaultPayRules?: string | null; _count?: { creators: number } };
  onChange: () => Promise<unknown>;
}) {
  const [name, setName] = useState(client.name);
  const [website, setWebsite] = useState(client.website ?? "");
  const [color, setColor] = useState(client.color);
  const [payOpen, setPayOpen] = useState(false);
  const [payMode, setPayMode] = useState(client.payMode ?? "uniform");
  const [payForm, setPayForm] = useState(() => payFormFromRules(parsePayRules(client.defaultPayRules)));
  const [savingPay, setSavingPay] = useState(false);
  const [paySaved, setPaySaved] = useState(false);

  async function save() {
    await fetch(`/api/clients/${client.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, color, website }),
    });
    await onChange();
  }
  async function savePay() {
    setSavingPay(true);
    await fetch(`/api/clients/${client.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payMode, defaultPayRules: payFormToRules(payForm) }),
    });
    await onChange();
    setSavingPay(false);
    setPaySaved(true);
    setTimeout(() => setPaySaved(false), 1800);
  }
  async function del() {
    if (!confirm(`Delete client "${client.name}" and all its creators?`)) return;
    await fetch(`/api/clients/${client.id}`, { method: "DELETE" });
    await onChange();
  }

  const dirty = name !== client.name || color !== client.color || website !== (client.website ?? "");

  return (
    <div className="rounded-xl border p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <ClientLogo name={name || "?"} logoUrl={client.logoUrl} color={color} size={32} radius={9} />
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Client name" className="min-w-[120px] flex-1 px-2.5 py-1.5 text-sm" />
        <input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="website.com" className="min-w-[120px] flex-1 px-2.5 py-1.5 text-sm" />
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          className="h-8 w-10 cursor-pointer rounded-md border-0 bg-transparent p-0"
          title="Fallback color"
        />
        <span className="w-16 text-right text-xs text-[var(--muted)]">
          {client._count?.creators ?? 0} creators
        </span>
        <button
          onClick={() => setPayOpen((o) => !o)}
          className={`rounded-lg border px-2.5 py-1.5 text-xs ${payOpen ? "border-[var(--signal)] text-[var(--signal)]" : "hover:bg-[var(--panel2)]"}`}
        >
          Pay {payOpen ? "▴" : "▾"}
        </button>
        {dirty && (
          <button onClick={save} className="btn btn-primary px-3 py-1.5 text-xs">Save</button>
        )}
        <button onClick={del} className="rounded-lg border border-[color:rgba(208,71,58,0.4)] px-2.5 py-1.5 text-xs text-[var(--bad)] hover:bg-[color:rgba(208,71,58,0.1)]">
          Delete
        </button>
      </div>

      {payOpen && (
        <div className="mt-2.5 rounded-xl border border-[var(--line)] p-3">
          <div className="mb-1 text-xs font-semibold text-[var(--muted)]">Payment structure</div>
          <p className="mb-2.5 text-[11px] text-[var(--faint)]">
            Currently: <span className="text-[var(--ink)]">{payFormSummary(payFormFromRules(parsePayRules(client.defaultPayRules)))}</span> ·{" "}
            {(client.payMode ?? "uniform") === "individual" ? "individualized per creator" : "same for all creators"}.
            The client&apos;s automatic campaign mirrors this structure, so saving here updates payout tracking directly;
            manual campaigns and custom creator deals keep their own rules.
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
                  payMode === v ? "border-[var(--signal)] bg-[var(--panel2)]" : "border-[var(--line)] hover:bg-[var(--panel2)]"
                }`}
              >
                <div className="text-xs font-semibold">{l}</div>
                <div className="mt-0.5 text-[11px] leading-snug text-[var(--faint)]">{d}</div>
              </button>
            ))}
          </div>
          <PayStructureEditor value={payForm} onChange={setPayForm} />
          <div className="mt-3 flex items-center justify-end gap-2">
            {paySaved && <span className="text-xs text-green-400">Saved</span>}
            <button onClick={savePay} disabled={savingPay} className="btn btn-primary px-3 py-1.5 text-xs disabled:opacity-60">
              {savingPay ? "Saving…" : "Save pay structure"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
