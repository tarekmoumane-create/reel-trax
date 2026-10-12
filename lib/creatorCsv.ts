// CSV → creator rows. Pure (no React, no Prisma) so the browser can preview a
// file before anything is created and the server can trust the same shape.
//
// Sheets come in every shape — "Name, TikTok, IG" from one client, a Sideshift
// export with twenty columns from another — so headers are matched loosely
// and any URL in any cell is classified by its domain. A column that holds
// several links ("https://tiktok.com/@a https://instagram.com/a") is split.

import {
  parseFacebook,
  parseInstagramHandle,
  parseSnapchatHandle,
  parseThreadsHandle,
  parseTikTokHandle,
  parseYouTube,
} from "./scrapecreators";

export type ImportField =
  | "displayName"
  | "tiktokUrl"
  | "instagramUrl"
  | "youtubeUrl"
  | "threadsUrl"
  | "facebookUrl"
  | "snapchatUrl"
  | "links" // any mix of profile URLs, sorted by domain
  | "email"
  | "phone"
  | "discord"
  | "discordChannel"
  | "whatsapp"
  | "contactHandle"
  | "source"
  | "sourceDetail"
  | "sideshiftUrl"
  | "paymentMethod"
  | "paymentHandle"
  | "expectedPerWeek"
  | "onboardedAt"
  | "notes"
  | "skip";

export const IMPORT_FIELD_LABELS: Record<ImportField, string> = {
  displayName: "Creator name",
  tiktokUrl: "TikTok",
  instagramUrl: "Instagram",
  youtubeUrl: "YouTube",
  threadsUrl: "Threads",
  facebookUrl: "Facebook",
  snapchatUrl: "Snapchat",
  links: "Profile links (any platform)",
  email: "Email",
  phone: "Phone",
  discord: "Discord handle",
  discordChannel: "Discord channel link",
  whatsapp: "WhatsApp",
  contactHandle: "Other handle",
  source: "Source",
  sourceDetail: "Source detail",
  sideshiftUrl: "Sideshift URL",
  paymentMethod: "Payment method",
  paymentHandle: "Payment handle",
  expectedPerWeek: "Posts per week",
  onboardedAt: "Onboarded date",
  notes: "Notes",
  skip: "Ignore column",
};

export const IMPORT_FIELD_ORDER: ImportField[] = [
  "displayName",
  "tiktokUrl",
  "instagramUrl",
  "youtubeUrl",
  "threadsUrl",
  "facebookUrl",
  "snapchatUrl",
  "links",
  "email",
  "phone",
  "discord",
  "discordChannel",
  "whatsapp",
  "contactHandle",
  "source",
  "sourceDetail",
  "sideshiftUrl",
  "paymentMethod",
  "paymentHandle",
  "expectedPerWeek",
  "onboardedAt",
  "notes",
  "skip",
];

/** Columns the template ships with, in order. */
export const TEMPLATE_HEADERS = [
  "Name",
  "TikTok",
  "Instagram",
  "YouTube",
  "Threads",
  "Facebook",
  "Snapchat",
  "Email",
  "Phone",
  "Discord",
  "Source",
  "Posts per week",
  "Onboarded",
  "Notes",
];

// ---------- CSV text → cells ----------

/** RFC 4180-ish: quoted fields, doubled quotes, CR/LF/CRLF, a leading BOM. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const delim = detectDelimiter(src);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === delim) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  // Drop fully blank lines (trailing newline, spacer rows).
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

// Google Sheets exports commas; Excel in some locales exports semicolons; a
// copy-paste from a sheet is tab-separated. Pick whichever the first line uses most.
function detectDelimiter(src: string): string {
  const first = src.split(/\r?\n/, 1)[0] ?? "";
  const count = (d: string) => first.split(d).length - 1;
  const tabs = count("\t");
  const semis = count(";");
  const commas = count(",");
  if (tabs > commas && tabs > semis) return "\t";
  if (semis > commas) return ";";
  return ",";
}

// ---------- header → field ----------

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const HEADER_RULES: [RegExp, ImportField][] = [
  [/^(creator )?(display )?name$|^creator$|^full name$|^username$|^handle$/, "displayName"],
  [/tik ?tok|^tt( link| url| handle)?$/, "tiktokUrl"],
  [/instagram|^ig( link| url| handle)?$|^insta/, "instagramUrl"],
  [/you ?tube|^yt( link| url| handle)?$|shorts/, "youtubeUrl"],
  [/threads/, "threadsUrl"],
  [/facebook|^fb( link| url| page)?$/, "facebookUrl"],
  [/snap/, "snapchatUrl"],
  [/^(profile |social |account |creator )?(links?|urls?|profiles?|socials?|accounts?)$|^social media$/, "links"],
  [/e ?mail/, "email"],
  [/phone|mobile|cell|number/, "phone"],
  [/discord (channel|link)/, "discordChannel"],
  [/discord/, "discord"],
  [/whats ?app/, "whatsapp"],
  [/sideshift (url|link|profile)/, "sideshiftUrl"],
  [/^source detail|referred by|referrer/, "sourceDetail"],
  [/^source$|^sourced? from$|^origin$|^channel$/, "source"],
  [/payment method|pay method|paid via|payout method/, "paymentMethod"],
  [/payment (handle|info|details?)|venmo|paypal|zelle|cash ?app|payout (handle|details?)/, "paymentHandle"],
  [/per week|weekly|cadence|frequency|posts ?wk/, "expectedPerWeek"],
  [/onboard|start(ed)?( date)?|joined|date added|signed/, "onboardedAt"],
  [/note|comment|remark/, "notes"],
  [/^(other|contact|dm)( handle)?$/, "contactHandle"],
];

export function guessField(header: string): ImportField {
  const h = norm(header);
  if (!h) return "skip";
  for (const [re, field] of HEADER_RULES) if (re.test(h)) return field;
  return "skip";
}

/** Does the first row look like headers rather than data? */
export function looksLikeHeader(row: string[]): boolean {
  if (row.some((c) => /https?:\/\//i.test(c) || /@/.test(c))) return false;
  const guessed = row.filter((c) => guessField(c) !== "skip").length;
  return guessed >= Math.max(1, Math.ceil(row.length / 3));
}

// ---------- URL classification ----------

type Platform = "tiktokUrl" | "instagramUrl" | "youtubeUrl" | "threadsUrl" | "facebookUrl" | "snapchatUrl";

export function classifyUrl(url: string): Platform | null {
  const u = url.toLowerCase();
  if (/tiktok\.com/.test(u)) return "tiktokUrl";
  if (/instagram\.com|instagr\.am/.test(u)) return "instagramUrl";
  if (/youtube\.com|youtu\.be/.test(u)) return "youtubeUrl";
  if (/threads\.(net|com)/.test(u)) return "threadsUrl";
  if (/facebook\.com|fb\.com/.test(u)) return "facebookUrl";
  if (/snapchat\.com/.test(u)) return "snapchatUrl";
  return null;
}

/** Every URL in a cell, whatever separates them (space, comma, newline, ";"). */
export function extractUrls(cell: string): string[] {
  return (cell.match(/https?:\/\/[^\s,;|"'<>]+|(?:www\.)?(?:tiktok|instagram|youtube|threads|facebook|snapchat)\.(?:com|net)\/[^\s,;|"'<>]+/gi) ?? []).map((u) =>
    /^https?:\/\//i.test(u) ? u : `https://${u}`
  );
}

// ---------- rows → creator drafts ----------

export interface CreatorDraft {
  displayName: string;
  tiktokUrl: string | null;
  instagramUrl: string | null;
  youtubeUrl: string | null;
  threadsUrl: string | null;
  facebookUrl: string | null;
  snapchatUrl: string | null;
  email: string | null;
  phone: string | null;
  discord: string | null;
  discordChannel: string | null;
  whatsapp: string | null;
  contactHandle: string | null;
  source: string | null;
  sourceDetail: string | null;
  sideshiftUrl: string | null;
  paymentMethod: string | null;
  paymentHandle: string | null;
  expectedPerWeek: number | null;
  onboardedAt: string | null; // YYYY-MM-DD
  notes: string | null;
}

export interface DraftRow {
  line: number; // 1-based line in the file, for error messages
  draft: CreatorDraft;
  /** Handles parsed from the URLs, for duplicate checks. */
  handles: Partial<Record<Platform, string>>;
  /** Why this row can't be imported (empty = fine). */
  problems: string[];
}

const SOURCES = new Set(["sideshift", "referral", "outreach", "agency", "other"]);
const PAY_METHODS = new Set(["sideshift", "venmo", "paypal", "other"]);

function clean(v: string | undefined): string | null {
  const s = (v ?? "").trim();
  return s ? s : null;
}

function toIsoDay(v: string | null): string | null {
  if (!v) return null;
  const s = v.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/); // US m/d/y
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** A profile URL (or bare handle) is only kept if the platform parser gets a handle out of it. */
function profileFor(platform: Platform, raw: string | null): { url: string | null; handle: string | null } {
  if (!raw) return { url: null, handle: null };
  const s = raw.trim();
  switch (platform) {
    case "tiktokUrl": {
      const h = parseTikTokHandle(s);
      return h ? { url: /tiktok\.com/i.test(s) ? s : `https://www.tiktok.com/@${h}`, handle: h } : { url: null, handle: null };
    }
    case "instagramUrl": {
      const h = parseInstagramHandle(s);
      return h ? { url: /instagram\.com/i.test(s) ? s : `https://www.instagram.com/${h}/`, handle: h } : { url: null, handle: null };
    }
    case "youtubeUrl": {
      const yt = parseYouTube(s);
      const isUrl = /youtube\.com|youtu\.be/i.test(s);
      if (yt.channelId) return { url: isUrl ? s : `https://www.youtube.com/channel/${yt.channelId}`, handle: yt.channelId };
      if (yt.handle) return { url: isUrl ? s : `https://www.youtube.com/@${yt.handle}`, handle: yt.handle };
      // /c/… or /user/… URLs resolve to an id at sync time; keep them.
      return isUrl ? { url: s, handle: s.toLowerCase() } : { url: null, handle: null };
    }
    case "threadsUrl": {
      const h = parseThreadsHandle(s);
      return h ? { url: /threads\./i.test(s) ? s : `https://www.threads.net/@${h}`, handle: h } : { url: null, handle: null };
    }
    case "facebookUrl": {
      const fb = parseFacebook(s);
      return fb.url ? { url: fb.url, handle: fb.handle } : { url: null, handle: null };
    }
    case "snapchatUrl": {
      const h = parseSnapchatHandle(s);
      return h ? { url: /snapchat\.com/i.test(s) ? s : `https://www.snapchat.com/add/${h}`, handle: h } : { url: null, handle: null };
    }
  }
}

const PLATFORMS: Platform[] = ["tiktokUrl", "instagramUrl", "youtubeUrl", "threadsUrl", "facebookUrl", "snapchatUrl"];

/**
 * Turn parsed cells into creator drafts using a column→field mapping.
 * `mapping[i]` says what column i holds. Rows that can't be imported carry
 * `problems` so the preview can explain instead of silently dropping them.
 */
export function buildDrafts(rows: string[][], mapping: ImportField[], firstDataRow: number): DraftRow[] {
  const out: DraftRow[] = [];
  for (let r = firstDataRow; r < rows.length; r++) {
    const cells = rows[r];
    const get = (f: ImportField): string[] =>
      mapping.flatMap((m, i) => (m === f && cells[i] !== undefined ? [cells[i]] : []));
    const first = (f: ImportField) => clean(get(f).find((c) => c.trim()));

    // Platform URLs: the dedicated column, plus anything found in a "links"
    // column, plus any stray URL in any cell whose domain gives it away.
    const raw: Record<Platform, string | null> = {
      tiktokUrl: first("tiktokUrl"),
      instagramUrl: first("instagramUrl"),
      youtubeUrl: first("youtubeUrl"),
      threadsUrl: first("threadsUrl"),
      facebookUrl: first("facebookUrl"),
      snapchatUrl: first("snapchatUrl"),
    };
    const looseCells = [
      ...get("links"),
      ...mapping.flatMap((m, i) => (m === "skip" && cells[i] ? [cells[i]] : [])),
    ];
    for (const cell of looseCells) {
      for (const url of extractUrls(cell)) {
        const p = classifyUrl(url);
        if (p && !raw[p]) raw[p] = url;
      }
    }
    // A platform column holding a URL from a different platform (pasted in the
    // wrong box) is still routed by domain, not by column.
    for (const p of PLATFORMS) {
      const v = raw[p];
      if (!v) continue;
      const real = /https?:\/\/|\.com|\.net/i.test(v) ? classifyUrl(v) : null;
      if (real && real !== p) {
        if (!raw[real]) raw[real] = v;
        raw[p] = null;
      }
    }

    const profiles = Object.fromEntries(PLATFORMS.map((p) => [p, profileFor(p, raw[p])])) as Record<
      Platform,
      { url: string | null; handle: string | null }
    >;
    const handles: Partial<Record<Platform, string>> = {};
    for (const p of PLATFORMS) if (profiles[p].handle) handles[p] = profiles[p].handle!;

    const problems: string[] = [];
    let displayName = first("displayName");
    if (displayName?.startsWith("@")) displayName = displayName.slice(1);
    if (!displayName) {
      // Fall back to the first handle so a bare list of links still imports.
      const h = handles.tiktokUrl ?? handles.instagramUrl ?? handles.threadsUrl ?? handles.snapchatUrl ?? handles.youtubeUrl ?? handles.facebookUrl;
      displayName = h && !/^https?:/.test(h) ? h : null;
    }
    if (!displayName) problems.push("No name");
    if (!Object.keys(handles).length) problems.push("No profile URL on a tracked platform");

    const sourceRaw = first("source")?.toLowerCase() ?? null;
    const source = sourceRaw ? (SOURCES.has(sourceRaw) ? sourceRaw : "other") : null;
    const payRaw = first("paymentMethod")?.toLowerCase() ?? null;
    const paymentMethod = payRaw ? (PAY_METHODS.has(payRaw) ? payRaw : "other") : null;
    const perWeekRaw = first("expectedPerWeek");
    const perWeekNum = perWeekRaw ? Number(perWeekRaw.replace(/[^\d.]/g, "")) : NaN;
    const expectedPerWeek = Number.isFinite(perWeekNum) && perWeekNum > 0 ? Math.max(1, Math.min(21, Math.round(perWeekNum))) : null;

    const draft: CreatorDraft = {
      displayName: displayName ?? "",
      tiktokUrl: profiles.tiktokUrl.url,
      instagramUrl: profiles.instagramUrl.url,
      youtubeUrl: profiles.youtubeUrl.url,
      threadsUrl: profiles.threadsUrl.url,
      facebookUrl: profiles.facebookUrl.url,
      snapchatUrl: profiles.snapchatUrl.url,
      email: first("email"),
      phone: first("phone"),
      discord: first("discord"),
      discordChannel: first("discordChannel"),
      whatsapp: first("whatsapp"),
      contactHandle: first("contactHandle"),
      source,
      sourceDetail: first("sourceDetail") ?? (sourceRaw && source === "other" ? first("source") : null),
      sideshiftUrl: first("sideshiftUrl"),
      paymentMethod,
      paymentHandle: first("paymentHandle"),
      expectedPerWeek,
      onboardedAt: toIsoDay(first("onboardedAt")),
      notes: first("notes"),
    };
    out.push({ line: r + 1, draft, handles, problems });
  }
  return out;
}

/** Everything the preview needs from a raw file in one go. */
export function analyzeCsv(text: string): {
  rows: string[][];
  headers: string[];
  hasHeader: boolean;
  mapping: ImportField[];
} {
  const rows = parseCsv(text);
  const width = rows.reduce((n, r) => Math.max(n, r.length), 0);
  const first = rows[0] ?? [];
  const hasHeader = looksLikeHeader(first);
  const headers = Array.from({ length: width }, (_, i) => (hasHeader ? first[i] ?? "" : `Column ${i + 1}`));
  const mapping = headers.map((h, i) => {
    if (hasHeader) return guessField(h);
    // Headerless: sniff the column's contents.
    const sample = rows.slice(0, 20).map((r) => r[i] ?? "").filter(Boolean);
    const urls = sample.flatMap(extractUrls).map(classifyUrl).filter(Boolean);
    if (urls.length) {
      const uniq = new Set(urls);
      return uniq.size === 1 ? (urls[0] as ImportField) : "links";
    }
    if (sample.some((c) => /@.+\..+/.test(c))) return "email";
    if (i === 0) return "displayName";
    return "skip";
  });
  return { rows, headers, hasHeader, mapping };
}

/** Same creator already in the roster? Matched on any platform handle (case-insensitive). */
export function duplicateOf(
  handles: Partial<Record<Platform, string>>,
  existing: Array<{
    id: string;
    displayName: string;
    tiktokHandle?: string | null;
    instagramHandle?: string | null;
    youtubeHandle?: string | null;
    threadsHandle?: string | null;
    facebookHandle?: string | null;
    snapchatHandle?: string | null;
  }>
): { id: string; displayName: string } | null {
  const lc = (s: string | null | undefined) => (s ?? "").toLowerCase();
  for (const e of existing) {
    if (
      (handles.tiktokUrl && lc(e.tiktokHandle) === handles.tiktokUrl.toLowerCase()) ||
      (handles.instagramUrl && lc(e.instagramHandle) === handles.instagramUrl.toLowerCase()) ||
      (handles.youtubeUrl && lc(e.youtubeHandle) === handles.youtubeUrl.toLowerCase()) ||
      (handles.threadsUrl && lc(e.threadsHandle) === handles.threadsUrl.toLowerCase()) ||
      (handles.facebookUrl && lc(e.facebookHandle) === handles.facebookUrl.toLowerCase()) ||
      (handles.snapchatUrl && lc(e.snapchatHandle) === handles.snapchatUrl.toLowerCase())
    )
      return { id: e.id, displayName: e.displayName };
  }
  return null;
}

/** Rows in the same file that point at the same account. Returns the index of the first twin. */
export function duplicateWithin(drafts: DraftRow[]): Map<number, number> {
  const seen = new Map<string, number>();
  const dup = new Map<number, number>();
  drafts.forEach((d, i) => {
    for (const [p, h] of Object.entries(d.handles)) {
      const key = `${p}:${h.toLowerCase()}`;
      const prev = seen.get(key);
      if (prev !== undefined && prev !== i) {
        if (!dup.has(i)) dup.set(i, prev);
      } else seen.set(key, i);
    }
  });
  return dup;
}

export function templateCsv(): string {
  const example = [
    "Jane Doe",
    "https://www.tiktok.com/@janedoe",
    "https://www.instagram.com/janedoe/",
    "",
    "",
    "",
    "",
    "jane@email.com",
    "+1 555 010 0100",
    "janedoe",
    "sideshift",
    "7",
    "2026-10-01",
    "Started with the fall batch",
  ];
  const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [TEMPLATE_HEADERS, example].map((r) => r.map(cell).join(",")).join("\n") + "\n";
}
