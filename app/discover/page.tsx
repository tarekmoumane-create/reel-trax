"use client";

import { useEffect, useRef, useState } from "react";
import { TopBar, PageTitle } from "@/components/PageHeader";

interface Msg {
  role: "user" | "assistant";
  text: string;
}

interface SheetTable {
  title: string;
  headers: string[];
  rows: string[][];
}

type ExportState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; table: SheetTable; copied: boolean };

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

function tableToCsv(t: SheetTable) {
  return [t.headers, ...t.rows].map((r) => r.map(csvCell).join(",")).join("\n");
}

// TSV pastes cleanly into a Google Sheet — one cell per column, no dialogs.
function tableToTsv(t: SheetTable) {
  const clean = (v: string) => v.replace(/[\t\n]/g, " ");
  return [t.headers, ...t.rows].map((r) => r.map(clean).join("\t")).join("\n");
}

const SUGGESTIONS = [
  "What hooks are my competitors using in the supplement niche right now?",
  "Find 10 fitness creators with 1,000–5,000 followers I could reach out to.",
  "What TikTok UGC trends are breaking out this week?",
  "Why do skincare 'get ready with me' videos tend to go viral?",
];

function render(text: string) {
  return text.split("\n").map((line, i) => {
    const bullet = /^\s*[-•]\s+/.test(line);
    const content = line.replace(/^\s*[-•]\s+/, "");
    const parts = content.split(/(\*\*[^*]+\*\*)/g).map((p, j) =>
      p.startsWith("**") && p.endsWith("**") ? <strong key={j} className="text-[var(--ink)]">{p.slice(2, -2)}</strong> : <span key={j}>{p}</span>
    );
    return (
      <div key={i} className={bullet ? "flex gap-2 pl-1" : ""}>
        {bullet && <span className="text-[var(--signal)]">•</span>}
        <span>{parts}</span>
      </div>
    );
  });
}

export default function DiscoverPage() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [exports, setExports] = useState<Record<number, ExportState>>({});
  const scrollRef = useRef<HTMLDivElement>(null);

  async function prepareExport(i: number, answer: string) {
    setExports((e) => ({ ...e, [i]: { status: "loading" } }));
    try {
      const res = await fetch("/api/discover-export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Export failed");
      setExports((e) => ({ ...e, [i]: { status: "ready", table: d, copied: false } }));
    } catch (err) {
      setExports((e) => ({ ...e, [i]: { status: "error", message: err instanceof Error ? err.message : "Export failed" } }));
    }
  }

  // Copies the table (TSV) and opens a fresh Google Sheet to paste into —
  // both must happen inside the click so clipboard + popup are allowed.
  function openInSheets(i: number, table: SheetTable) {
    navigator.clipboard.writeText(tableToTsv(table)).catch(() => {});
    window.open("https://sheets.new", "_blank");
    setExports((e) => ({ ...e, [i]: { status: "ready", table, copied: true } }));
  }

  function downloadCsv(table: SheetTable) {
    const blob = new Blob([tableToCsv(table)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${table.title.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "discover-export"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs, loading]);

  async function ask(question: string) {
    if (!question.trim() || loading) return;
    setMsgs((m) => [...m, { role: "user", text: question }]);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch("/api/lightreel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, conversationId }),
      });
      const d = await res.json();
      if (res.ok) {
        setConversationId(d.conversationId ?? conversationId);
        setMsgs((m) => [...m, { role: "assistant", text: d.answer }]);
      } else {
        setMsgs((m) => [...m, { role: "assistant", text: `⚠ ${d.error || "Something went wrong."}` }]);
      }
    } catch {
      setMsgs((m) => [...m, { role: "assistant", text: "⚠ Network error." }]);
    }
    setLoading(false);
  }

  return (
    <>
      <TopBar
        crumbs={["Analytics", "Discover"]}
        right={<span className="mono text-[11px] text-[var(--faint)]">powered by LightReel</span>}
      />
      <div className="mx-auto flex h-[calc(100vh-52px)] max-w-3xl flex-col px-6 py-6">
        <PageTitle title="Discover" sub="AI competitor & trend research across 150k+ TikTok UGC videos." />

        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto">
          {msgs.length === 0 && (
            <div className="pt-2">
              <p className="text-sm text-[var(--muted)]">Ask about competitor hooks, trending formats, or find creators to reach out to.</p>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {SUGGESTIONS.map((s) => (
                  <button key={s} onClick={() => ask(s)} className="card px-3.5 py-3 text-left text-[13px] hover:border-[var(--signal)]">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {msgs.map((m, i) => {
            const ex = exports[i];
            return (
              <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
                <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-[13px] leading-relaxed ${m.role === "user" ? "bg-[var(--signal)] text-white" : "bg-[var(--panel)] text-[var(--muted)]"}`}>
                  {m.role === "assistant" ? <div className="space-y-1">{render(m.text)}</div> : m.text}
                  {m.role === "assistant" && !m.text.startsWith("⚠") && (
                    <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-[var(--line2)] pt-2.5">
                      {!ex || ex.status === "error" ? (
                        <>
                          <button onClick={() => prepareExport(i, m.text)} className="flex items-center gap-1.5 rounded-lg border border-[var(--line)] px-2.5 py-1 text-[11px] font-medium text-[var(--muted)] hover:border-[var(--signal)] hover:text-[var(--ink)]">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3h18v18H3zM3 9h18M9 9v12M15 9v12" /></svg>
                            Export to Google Sheets
                          </button>
                          {ex?.status === "error" && <span className="text-[11px] text-[var(--bad)]">{ex.message}</span>}
                        </>
                      ) : ex.status === "loading" ? (
                        <span className="text-[11px] text-[var(--faint)]">Building your sheet…</span>
                      ) : (
                        <>
                          <button onClick={() => openInSheets(i, ex.table)} className="rounded-lg bg-[var(--signal)] px-2.5 py-1 text-[11px] font-medium text-white hover:opacity-90">
                            Open in Google Sheets ↗
                          </button>
                          <button onClick={() => downloadCsv(ex.table)} className="rounded-lg border border-[var(--line)] px-2.5 py-1 text-[11px] font-medium text-[var(--muted)] hover:border-[var(--signal)] hover:text-[var(--ink)]">
                            Download CSV
                          </button>
                          <span className="text-[11px] text-[var(--faint)]">
                            {ex.copied
                              ? "Copied! Paste into the new sheet with ⌘V."
                              : `${ex.table.rows.length} rows ready — opening copies the data to paste.`}
                          </span>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {loading && <div className="text-[13px] text-[var(--faint)]">Researching… this can take a minute.</div>}
        </div>

        <div className="mt-3 flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && ask(input)}
            placeholder="Ask LightReel anything about UGC…"
            className="min-w-0 flex-1 px-3.5 py-2.5 text-sm"
          />
          <button onClick={() => ask(input)} disabled={loading || !input.trim()} className="btn btn-primary px-4 disabled:opacity-50">
            {loading ? "…" : "Ask"}
          </button>
        </div>
      </div>
    </>
  );
}
