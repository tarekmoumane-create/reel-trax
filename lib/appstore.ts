// App Store Connect: daily downloads for a client's app, from Apple's Sales
// and Trends reports. One API key (Settings) covers every app on the
// developer account; each client links to its app by Apple ID.
//
// Why sales reports and not the Analytics API: the analytics reports are
// requested asynchronously and land hours later in big multi-file bundles.
// The daily sales report is one GET per day — a gzipped TSV with one row per
// app × country × product type — and it's the number Apple's "Units" column
// has always meant: first-time downloads.

import { createPrivateKey, sign as cryptoSign } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { prisma } from "./db";
import { getSetting, setSetting, SETTING_KEYS } from "./settings";

export interface AppStoreCredentials {
  issuerId: string;
  keyId: string;
  privateKey: string; // the .p8 contents (PEM)
  vendorNumber: string;
}

/** Credentials from Settings, falling back to env vars; null if incomplete. */
export async function getAppStoreCredentials(): Promise<AppStoreCredentials | null> {
  const issuerId = (await getSetting(SETTING_KEYS.ascIssuerId)) || process.env.ASC_ISSUER_ID || "";
  const keyId = (await getSetting(SETTING_KEYS.ascKeyId)) || process.env.ASC_KEY_ID || "";
  const privateKey = (await getSetting(SETTING_KEYS.ascPrivateKey)) || process.env.ASC_PRIVATE_KEY || "";
  const vendorNumber = (await getSetting(SETTING_KEYS.ascVendorNumber)) || process.env.ASC_VENDOR_NUMBER || "";
  if (!issuerId || !keyId || !privateKey || !vendorNumber) return null;
  return { issuerId, keyId, privateKey: normalizePem(privateKey), vendorNumber };
}

/** A .p8 pasted into a single-line field loses its newlines; restore them. */
export function normalizePem(raw: string): string {
  const s = raw.trim().replace(/\\n/g, "\n");
  if (s.includes("\n")) return s;
  const m = s.match(/^(-----BEGIN [A-Z ]+-----)(.*?)(-----END [A-Z ]+-----)$/);
  if (!m) return s;
  const body = m[2].replace(/\s+/g, "");
  return `${m[1]}\n${body.match(/.{1,64}/g)?.join("\n") ?? body}\n${m[3]}\n`;
}

const b64url = (b: Buffer | string) =>
  (typeof b === "string" ? Buffer.from(b) : b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** ES256 JWT, as App Store Connect wants it (≤ 20 minutes). */
export function appStoreToken(creds: AppStoreCredentials): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "ES256", kid: creds.keyId, typ: "JWT" }));
  const payload = b64url(JSON.stringify({ iss: creds.issuerId, iat: now, exp: now + 15 * 60, aud: "appstoreconnect-v1" }));
  const input = `${header}.${payload}`;
  const key = createPrivateKey(creds.privateKey);
  // JWT ES256 signatures are raw r||s, not DER — Node calls that ieee-p1363.
  const sig = cryptoSign("sha256", Buffer.from(input), { key, dsaEncoding: "ieee-p1363" });
  return `${input}.${b64url(sig)}`;
}

export interface DailyUnits {
  /** first-time downloads */
  units: number;
  /** re-downloads of a previously owned copy */
  redownloads: number;
}

export type DailyReport =
  | { status: "ok"; byAppId: Map<string, DailyUnits> }
  /** Apple hasn't produced this day's report yet (reports land ~a day late) */
  | { status: "pending" };

// Product Type Identifier → what the row means (Apple's reference table).
const isDownload = (t: string) => /^1(F|T|E|EP|EU|-B)?$/.test(t) || t === "F1" || t === "F1-B";
const isRedownload = (t: string) => t === "3" || t === "3F" || t === "3T" || t === "F3";

/** Parses a summary sales report TSV into per-app download counts. */
export function parseSalesReport(tsv: string): Map<string, DailyUnits> {
  const lines = tsv.split(/\r?\n/).filter((l) => l.trim());
  const out = new Map<string, DailyUnits>();
  if (!lines.length) return out;
  const header = lines[0].split("\t").map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const iApp = col("apple identifier");
  const iType = col("product type identifier");
  const iUnits = col("units");
  if (iApp < 0 || iType < 0 || iUnits < 0) throw new Error("Unexpected report layout (no Apple Identifier / Product Type / Units columns)");
  for (const line of lines.slice(1)) {
    const cells = line.split("\t");
    const appId = (cells[iApp] ?? "").trim();
    const type = (cells[iType] ?? "").trim();
    const units = Number(cells[iUnits]) || 0;
    if (!appId) continue;
    const row = out.get(appId) ?? { units: 0, redownloads: 0 };
    if (isDownload(type)) row.units += units;
    else if (isRedownload(type)) row.redownloads += units;
    out.set(appId, row);
  }
  return out;
}

/** One day's report, for every app on the vendor. */
export async function fetchDailyReport(creds: AppStoreCredentials, day: string, token = appStoreToken(creds)): Promise<DailyReport> {
  const url = new URL("https://api.appstoreconnect.apple.com/v1/salesReports");
  url.searchParams.set("filter[frequency]", "DAILY");
  url.searchParams.set("filter[reportDate]", day);
  url.searchParams.set("filter[reportSubType]", "SUMMARY");
  url.searchParams.set("filter[reportType]", "SALES");
  url.searchParams.set("filter[vendorNumber]", creds.vendorNumber);
  url.searchParams.set("filter[version]", "1_1");
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/a-gzip, application/json" } });
  if (res.status === 404) {
    // Two different 404s: "no sales" is a real, empty day; "not available
    // yet" means come back tomorrow.
    const body = await res.text();
    const detail = (() => {
      try { return String(JSON.parse(body)?.errors?.[0]?.detail ?? ""); } catch { return body; }
    })();
    if (/no sales/i.test(detail)) return { status: "ok", byAppId: new Map() };
    if (/not available|not yet|try again/i.test(detail)) return { status: "pending" };
    throw new Error(detail || "Report not found");
  }
  if (res.status === 401 || res.status === 403) {
    const body = await res.text();
    let detail = "";
    try { detail = String(JSON.parse(body)?.errors?.[0]?.detail ?? ""); } catch { /* not JSON */ }
    throw new Error(`Apple rejected the API key (${res.status})${detail ? `: ${detail}` : ""}. Check the Issuer ID, Key ID, .p8 key and that the key has Sales and Reports access.`);
  }
  if (!res.ok) throw new Error(`App Store Connect returned ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  // Gzipped unless Apple ever sends it plain (magic bytes 1f 8b).
  const text = buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf).toString("utf8") : buf.toString("utf8");
  return { status: "ok", byAppId: parseSalesReport(text) };
}

// Apple's day boundary is Pacific time; a report for day D shows up during
// D+1. Re-pulling the recent week each run picks up late-arriving days and
// any restatements.
const REFRESH_DAYS = 7;
const BACKFILL_DAYS = 90;

export interface DownloadSyncResult {
  ok: boolean;
  apps: number;
  daysFetched: number;
  daysPending: number;
  /** latest day a report was stored for, if any */
  latestDay: string | null;
  error?: string;
}

function dayUtc(offset: number): string {
  return new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Pulls daily downloads for every client with an Apple app ID (or one
 * client). A client with no stored days yet gets a 90-day backfill; after
 * that only the last week is refreshed. Reports are per vendor, so one
 * fetch per day serves every linked app.
 */
export async function syncAppDownloads(opts: { clientId?: string; days?: number } = {}): Promise<DownloadSyncResult> {
  const clients = await prisma.client.findMany({
    where: { appleAppId: { not: null }, archived: false, ...(opts.clientId ? { id: opts.clientId } : {}) },
    select: { id: true, appleAppId: true },
  });
  const linked = clients.filter((c) => c.appleAppId?.trim());
  const empty: DownloadSyncResult = { ok: true, apps: linked.length, daysFetched: 0, daysPending: 0, latestDay: null };
  if (!linked.length) return empty;

  const creds = await getAppStoreCredentials();
  if (!creds) return { ...empty, ok: false, error: "App Store Connect isn't connected — add the API key in Settings." };

  // How far back: a deep pull for any client that has nothing yet.
  const counts = await prisma.appDownload.groupBy({ by: ["clientId"], where: { clientId: { in: linked.map((c) => c.id) } }, _count: { _all: true } });
  const haveData = new Set(counts.map((c) => c.clientId));
  const anyFresh = linked.some((c) => !haveData.has(c.id));
  const span = Math.min(366, Math.max(1, opts.days ?? (anyFresh ? BACKFILL_DAYS : REFRESH_DAYS)));

  let token: string;
  try {
    token = appStoreToken(creds);
  } catch (e) {
    return { ...empty, ok: false, error: `The .p8 private key couldn't be read: ${(e as Error).message}` };
  }

  let fetched = 0;
  let pending = 0;
  let latestDay: string | null = null;
  try {
    // Yesterday backwards: today's report never exists yet.
    for (let offset = 1; offset <= span; offset++) {
      const day = dayUtc(offset);
      const report = await fetchDailyReport(creds, day, token);
      if (report.status === "pending") { pending++; continue; }
      fetched++;
      if (!latestDay) latestDay = day;
      for (const c of linked) {
        const row = report.byAppId.get(c.appleAppId!.trim()) ?? { units: 0, redownloads: 0 };
        await prisma.appDownload.upsert({
          where: { clientId_day: { clientId: c.id, day } },
          create: { clientId: c.id, day, units: row.units, redownloads: row.redownloads },
          update: { units: row.units, redownloads: row.redownloads, capturedAt: new Date() },
        });
      }
    }
  } catch (e) {
    const result = { ok: false, apps: linked.length, daysFetched: fetched, daysPending: pending, latestDay, error: (e as Error).message };
    await setSetting(SETTING_KEYS.ascLastSync, JSON.stringify({ at: new Date().toISOString(), ...result }));
    return result;
  }
  const result = { ok: true, apps: linked.length, daysFetched: fetched, daysPending: pending, latestDay };
  await setSetting(SETTING_KEYS.ascLastSync, JSON.stringify({ at: new Date().toISOString(), ...result }));
  return result;
}
