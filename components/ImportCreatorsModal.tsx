"use client";

import { useMemo, useRef, useState } from "react";
import {
  analyzeCsv,
  buildDrafts,
  duplicateOf,
  duplicateWithin,
  templateCsv,
  IMPORT_FIELD_LABELS,
  IMPORT_FIELD_ORDER,
  type DraftRow,
  type ImportField,
} from "@/lib/creatorCsv";
import { Select } from "./Select";

type Existing = Parameters<typeof duplicateOf>[1];

interface RowResult {
  index: number;
  displayName: string;
  status: "created" | "skipped" | "failed";
  reason?: string;
}

interface ImportResponse {
  results: RowResult[];
  created: number;
  skipped: number;
  failed: number;
  sync: { attempted: boolean; synced: number; failed: number; pending: number };
}

const PLATFORM_SHORT: Record<string, string> = {
  tiktokUrl: "TT",
  instagramUrl: "IG",
  youtubeUrl: "YT",
  threadsUrl: "TH",
  facebookUrl: "FB",
  snapchatUrl: "SC",
};

export function ImportCreatorsModal({
  clientId,
  clientName,
  existing,
  onClose,
  onDone,
}: {
  clientId: string;
  clientName: string;
  existing: Existing;
  onClose: () => void;
  onDone: () => void;
}) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<string[][]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [hasHeader, setHasHeader] = useState(true);
  const [mapping, setMapping] = useState<ImportField[]>([]);
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResponse | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  function loadText(text: string, name: string | null) {
    const a = analyzeCsv(text);
    if (!a.rows.length) {
      setError("That file is empty.");
      return;
    }
    setError(null);
    setFileName(name);
    setRows(a.rows);
    setHeaders(a.headers);
    setHasHeader(a.hasHeader);
    setMapping(a.mapping);
    setExcluded(new Set());
    setResult(null);
  }

  async function loadFile(f: File | undefined) {
    if (!f) return;
    loadText(await f.text(), f.name);
  }

  const drafts: DraftRow[] = useMemo(
    () => (rows.length ? buildDrafts(rows, mapping, hasHeader ? 1 : 0) : []),
    [rows, mapping, hasHeader]
  );
  const withinDups = useMemo(() => duplicateWithin(drafts), [drafts]);

  // Each row's fate before import: ready, or why not.
  const judged = useMemo(
    () =>
      drafts.map((d, i) => {
        if (d.problems.length) return { d, i, kind: "problem" as const, note: d.problems.join(" · ") };
        const twin = withinDups.get(i);
        if (twin !== undefined) return { d, i, kind: "dupfile" as const, note: `Same account as line ${drafts[twin].line}` };
        const dup = duplicateOf(d.handles, existing);
        if (dup) return { d, i, kind: "dup" as const, note: `Already tracked as ${dup.displayName}` };
        return { d, i, kind: "ready" as const, note: "" };
      }),
    [drafts, withinDups, existing]
  );
  const ready = judged.filter((j) => j.kind === "ready" && !excluded.has(j.i));
  const mapsName = mapping.includes("displayName");
  const mapsAnyProfile = mapping.some((m) => m !== "skip" && (m.endsWith("Url") || m === "links"));

  async function submit() {
    if (!ready.length) return;
    setImporting(true);
    setError(null);
    const res = await fetch("/api/creators/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, creators: ready.map((j) => j.d.draft) }),
    });
    setImporting(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error || "Import failed");
      return;
    }
    setResult(data as ImportResponse);
    onDone();
  }

  function downloadTemplate() {
    const blob = new Blob([templateCsv()], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "reel-trax-creators-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const fieldOptions: [string, string][] = IMPORT_FIELD_ORDER.map((f) => [f, IMPORT_FIELD_LABELS[f]]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[var(--scrim)] p-4 backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <div className="card my-8 w-full max-w-3xl p-5" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Import creators from CSV</h2>
            <p className="text-xs text-[var(--muted)]">
              into <span className="text-[var(--text)]">{clientName}</span> · one creator per row, profile links in any
              column · tracking starts automatically
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg px-2 py-1 text-[var(--muted)] hover:bg-[var(--panel2)]">
            ✕
          </button>
        </div>

        {result ? (
          <ResultView result={result} onClose={onClose} />
        ) : (
          <>
            {/* Step 1: pick a file */}
            <div
              className={`rounded-xl border border-dashed p-4 text-center transition ${
                dragging ? "border-[var(--signal)] bg-[var(--panel2)]" : "border-[var(--line)]"
              }`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                loadFile(e.dataTransfer.files?.[0]);
              }}
            >
              <input
                ref={fileInput}
                type="file"
                accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
                className="hidden"
                onChange={(e) => loadFile(e.target.files?.[0])}
              />
              {fileName ? (
                <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-sm">
                  <span className="mono text-[13px]">{fileName}</span>
                  <span className="text-[var(--muted)]">
                    {drafts.length} row{drafts.length === 1 ? "" : "s"}
                  </span>
                  <button onClick={() => fileInput.current?.click()} className="text-[var(--signal)] hover:underline">
                    Choose another
                  </button>
                </div>
              ) : (
                <div className="text-sm">
                  <button onClick={() => fileInput.current?.click()} className="btn btn-primary">
                    Choose CSV file
                  </button>
                  <div className="mt-2 text-xs text-[var(--muted)]">
                    or drop it here · exported from Google Sheets, Excel or Sideshift ·{" "}
                    <button onClick={downloadTemplate} className="text-[var(--signal)] hover:underline">
                      download a template
                    </button>
                  </div>
                </div>
              )}
            </div>

            {!fileName && <PasteBox onText={(t) => loadText(t, "pasted rows")} />}

            {/* Step 2: confirm what each column means */}
            {rows.length > 0 && (
              <div className="mt-4 rounded-xl border border-[var(--line)] p-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div className="text-xs font-semibold text-[var(--muted)]">Columns</div>
                  <label className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
                    <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} />
                    First row is a header
                  </label>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {headers.map((h, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <div className="min-w-0 flex-1 truncate text-[12.5px]" title={h}>
                        <span className={mapping[i] === "skip" ? "text-[var(--faint)]" : ""}>{h || `Column ${i + 1}`}</span>
                        <div className="truncate text-[11px] text-[var(--faint)]">
                          {rows[hasHeader ? 1 : 0]?.[i] || "—"}
                        </div>
                      </div>
                      <Select
                        size="sm"
                        align="right"
                        value={mapping[i] ?? "skip"}
                        onChange={(v) => setMapping((m) => m.map((x, j) => (j === i ? (v as ImportField) : x)))}
                        options={fieldOptions}
                      />
                    </div>
                  ))}
                </div>
                {!mapsName && (
                  <p className="mt-2 text-[12px] text-amber-400">
                    No name column — creators will be named after their first handle.
                  </p>
                )}
                {!mapsAnyProfile && (
                  <p className="mt-2 text-[12px] text-amber-400">
                    No profile-link column found. Links are still picked up from any column by their domain, but rows without
                    one can&apos;t be tracked.
                  </p>
                )}
              </div>
            )}

            {/* Step 3: preview */}
            {drafts.length > 0 && (
              <div className="mt-4 overflow-hidden rounded-xl border border-[var(--line)]">
                <div className="grid grid-cols-[28px_minmax(140px,1.4fr)_minmax(120px,1fr)_minmax(140px,1.2fr)] items-center gap-3 border-b border-[var(--line)] bg-[var(--panel2)] px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                  <div />
                  <div>Creator</div>
                  <div>Platforms</div>
                  <div>Status</div>
                </div>
                <div className="max-h-[320px] overflow-y-auto">
                  {judged.map(({ d, i, kind, note }) => {
                    const on = kind === "ready" && !excluded.has(i);
                    return (
                      <div
                        key={i}
                        className={`grid grid-cols-[28px_minmax(140px,1.4fr)_minmax(120px,1fr)_minmax(140px,1.2fr)] items-center gap-3 border-b border-[var(--line)] px-3 py-2 text-[13px] last:border-b-0 ${
                          on ? "" : "opacity-60"
                        }`}
                      >
                        <input
                          type="checkbox"
                          disabled={kind !== "ready"}
                          checked={on}
                          onChange={(e) =>
                            setExcluded((s) => {
                              const n = new Set(s);
                              if (e.target.checked) n.delete(i);
                              else n.add(i);
                              return n;
                            })
                          }
                        />
                        <div className="min-w-0">
                          <div className="truncate font-medium">{d.draft.displayName || <span className="text-[var(--faint)]">—</span>}</div>
                          <div className="truncate text-[11.5px] text-[var(--faint)]">
                            line {d.line}
                            {d.draft.email ? ` · ${d.draft.email}` : ""}
                            {d.draft.phone ? ` · ${d.draft.phone}` : ""}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {Object.entries(d.handles).map(([p, h]) => (
                            <span
                              key={p}
                              title={h}
                              className="mono rounded-md border border-[var(--line)] px-1.5 py-0.5 text-[11px] text-[var(--muted)]"
                            >
                              {PLATFORM_SHORT[p]} @{h.length > 18 ? h.slice(0, 16) + "…" : h}
                            </span>
                          ))}
                          {!Object.keys(d.handles).length && <span className="text-[var(--faint)]">—</span>}
                        </div>
                        <div className="text-[12.5px]">
                          {kind === "ready" && <span className="text-emerald-400">Ready</span>}
                          {kind === "dup" && <span className="text-[var(--muted)]">{note}</span>}
                          {kind === "dupfile" && <span className="text-[var(--muted)]">{note}</span>}
                          {kind === "problem" && <span className="text-amber-400">{note}</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {error && <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>}

            <div className="mt-5 flex items-center justify-between gap-3">
              <div className="text-xs text-[var(--muted)]">
                {drafts.length > 0 && (
                  <>
                    {ready.length} to import
                    {judged.some((j) => j.kind === "dup" || j.kind === "dupfile") &&
                      ` · ${judged.filter((j) => j.kind === "dup" || j.kind === "dupfile").length} already tracked`}
                    {judged.some((j) => j.kind === "problem") &&
                      ` · ${judged.filter((j) => j.kind === "problem").length} can't be imported`}
                  </>
                )}
              </div>
              <div className="flex gap-2">
                <button onClick={onClose} className="rounded-lg border px-4 py-2 text-sm hover:bg-[var(--panel2)]">
                  Cancel
                </button>
                <button
                  onClick={submit}
                  disabled={importing || !ready.length}
                  className="rounded-lg bg-[var(--signal)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                >
                  {importing
                    ? `Importing ${ready.length}…`
                    : `Import ${ready.length} creator${ready.length === 1 ? "" : "s"}`}
                </button>
              </div>
            </div>
            {importing && (
              <p className="mt-2 text-right text-[11.5px] text-[var(--faint)]">
                Creating creators and pulling their first posts. This can take a minute for a big list.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function PasteBox({ onText }: { onText: (t: string) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  if (!open)
    return (
      <div className="mt-2 text-center text-xs text-[var(--muted)]">
        No file? <button onClick={() => setOpen(true)} className="text-[var(--signal)] hover:underline">Paste rows from a sheet</button>
      </div>
    );
  return (
    <div className="mt-3">
      <textarea
        className="w-full px-3 py-2 font-mono text-[12.5px]"
        rows={6}
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"Name\tTikTok\tInstagram\nJane Doe\thttps://www.tiktok.com/@janedoe\thttps://www.instagram.com/janedoe/"}
      />
      <div className="mt-2 flex justify-end">
        <button onClick={() => text.trim() && onText(text)} disabled={!text.trim()} className="btn disabled:opacity-60">
          Use these rows
        </button>
      </div>
    </div>
  );
}

function ResultView({ result, onClose }: { result: ImportResponse; onClose: () => void }) {
  const failures = result.results.filter((r) => r.status !== "created");
  const { sync } = result;
  return (
    <div>
      <div className="grid grid-cols-3 overflow-hidden rounded-xl border border-[var(--line)]">
        <Stat label="Added" value={result.created} tone="text-emerald-400" />
        <Stat label="Already tracked" value={result.skipped} />
        <Stat label="Failed" value={result.failed} tone={result.failed ? "text-amber-400" : undefined} />
      </div>
      <p className="mt-3 text-sm text-[var(--muted)]">
        {!sync.attempted
          ? "No ScrapeCreators key is set, so nothing was synced yet. Add the key in Settings and the next sync will pull their posts."
          : sync.pending > 0
            ? `First sync done for ${sync.synced} of ${result.created}. The other ${sync.pending} will be picked up on the next sync (automatic every 6 hours, or hit Sync now).`
            : sync.failed > 0
              ? `First sync done for ${sync.synced}; ${sync.failed} couldn't be fetched yet and will be retried on the next sync.`
              : result.created > 0
                ? "Every new creator has had their first sync. Their posts are on the roster now."
                : "Nothing new to sync."}
      </p>
      {failures.length > 0 && (
        <div className="mt-3 max-h-[240px] overflow-y-auto rounded-xl border border-[var(--line)]">
          {failures.map((r) => (
            <div key={r.index} className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-3 py-2 text-[13px] last:border-b-0">
              <span className="truncate font-medium">{r.displayName || <span className="text-[var(--faint)]">—</span>}</span>
              <span className={`shrink-0 text-[12.5px] ${r.status === "failed" ? "text-amber-400" : "text-[var(--muted)]"}`}>{r.reason}</span>
            </div>
          ))}
        </div>
      )}
      <div className="mt-5 flex justify-end">
        <button onClick={onClose} className="rounded-lg bg-[var(--signal)] px-4 py-2 text-sm font-medium text-white">
          Done
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="border-r border-[var(--line)] px-4 py-3 last:border-r-0">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">{label}</div>
      <div className={`mono mt-0.5 text-xl font-semibold ${tone ?? ""}`}>{value}</div>
    </div>
  );
}
