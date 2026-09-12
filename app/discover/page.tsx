"use client";

import { useEffect, useRef, useState } from "react";
import { TopBar, PageTitle } from "@/components/PageHeader";
import { downloadCsv, openInSheets as openSheet, type SheetTable } from "@/lib/sheet";

interface Msg {
  role: "user" | "assistant";
  text: string;
}

type ExportState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; table: SheetTable; copied: boolean };

interface Attachment {
  id: number;
  name: string;
  status: "reading" | "ready" | "error";
  content?: string;
  error?: string;
}

const MAX_FILE_BYTES = 3 * 1024 * 1024; // matches the API route / Vercel body limit
const MAX_TEXT_CHARS = 40_000; // per attached text file
const TEXT_EXTENSIONS = /\.(txt|md|markdown|csv|tsv|json)$/i;
const EXTRACT_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/gif", "image/webp"];

function isTextFile(f: File) {
  return f.type.startsWith("text/") || f.type === "application/json" || TEXT_EXTENSIONS.test(f.name);
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
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [dragging, setDragging] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nextAttachmentId = useRef(1);

  function patchAttachment(id: number, patch: Partial<Attachment>) {
    setAttachments((list) => list.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  }

  function addFiles(files: Iterable<File>) {
    for (const file of files) {
      const id = nextAttachmentId.current++;
      const att: Attachment = { id, name: file.name || "pasted image", status: "reading" };
      setAttachments((list) => [...list, att]);

      if (file.size > MAX_FILE_BYTES) {
        patchAttachment(id, { status: "error", error: "Too large (3MB max)" });
        continue;
      }

      if (isTextFile(file)) {
        // Text-ish files are read right in the browser — no API round trip.
        file
          .text()
          .then((raw) => {
            const text = raw.length > MAX_TEXT_CHARS ? `${raw.slice(0, MAX_TEXT_CHARS)}\n…(truncated)` : raw;
            patchAttachment(id, { status: "ready", content: text.trim() });
          })
          .catch(() => patchAttachment(id, { status: "error", error: "Couldn't read file" }));
        continue;
      }

      if (!EXTRACT_TYPES.includes(file.type)) {
        patchAttachment(id, { status: "error", error: "Unsupported type" });
        continue;
      }

      // PDFs and images: Claude extracts their contents into text server-side.
      const reader = new FileReader();
      reader.onerror = () => patchAttachment(id, { status: "error", error: "Couldn't read file" });
      reader.onload = async () => {
        const dataBase64 = String(reader.result).split(",")[1] ?? "";
        try {
          const res = await fetch("/api/discover-file", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: file.name, mediaType: file.type, dataBase64 }),
          });
          const d = await res.json();
          if (!res.ok) throw new Error(d.error || "Extraction failed");
          patchAttachment(id, { status: "ready", content: d.text });
        } catch (err) {
          patchAttachment(id, { status: "error", error: err instanceof Error ? err.message : "Extraction failed" });
        }
      };
      reader.readAsDataURL(file);
    }
  }

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
    openSheet(table);
    setExports((e) => ({ ...e, [i]: { status: "ready", table, copied: true } }));
  }



  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs, loading]);

  async function ask(question: string) {
    const ready = attachments.filter((a) => a.status === "ready" && a.content);
    const stillReading = attachments.some((a) => a.status === "reading");
    if ((!question.trim() && ready.length === 0) || loading || stillReading) return;

    // Attached file contents ride along with the question as plain text —
    // LightReel's API only takes text.
    const base = question.trim() || "Analyze the attached file(s) for UGC / competitor research insights.";
    const display = ready.length ? `${base}\n${ready.map((a) => `📎 ${a.name}`).join("\n")}` : base;
    let composed = base;
    for (const a of ready) composed += `\n\n--- Attached file: ${a.name} ---\n${a.content}`;

    setMsgs((m) => [...m, { role: "user", text: display }]);
    setInput("");
    setAttachments([]);
    setLoading(true);
    try {
      const res = await fetch("/api/lightreel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: composed, conversationId }),
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
      <div
        className={`mx-auto flex h-[calc(100vh-52px)] max-w-3xl flex-col px-6 py-6 ${dragging ? "rounded-2xl outline-dashed outline-2 outline-[var(--signal)]" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
        }}
      >
        <PageTitle title="Discover" sub="AI competitor & trend research across 150k+ TikTok UGC videos. Attach briefs, screenshots or CSVs to research against." />

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
                          <button onClick={() => downloadCsv(ex.table, "discover-export")} className="rounded-lg border border-[var(--line)] px-2.5 py-1 text-[11px] font-medium text-[var(--muted)] hover:border-[var(--signal)] hover:text-[var(--ink)]">
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

        <div className="mt-3">
          {attachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {attachments.map((a) => (
                <span
                  key={a.id}
                  className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] ${
                    a.status === "error"
                      ? "border-[color:rgba(242,104,95,0.4)] text-[var(--bad)]"
                      : "border-[var(--line)] bg-[var(--panel)] text-[var(--muted)]"
                  }`}
                >
                  📎 <span className="max-w-[180px] truncate">{a.name}</span>
                  {a.status === "reading" && <span className="text-[var(--faint)]">reading…</span>}
                  {a.status === "error" && <span>{a.error}</span>}
                  <button
                    onClick={() => setAttachments((list) => list.filter((x) => x.id !== a.id))}
                    className="text-[var(--faint)] hover:text-[var(--bad)]"
                    title="Remove"
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".txt,.md,.csv,.tsv,.json,.pdf,image/jpeg,image/png,image/gif,image/webp"
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) addFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              title="Attach files (briefs, screenshots, CSVs) — or drag & drop / paste"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-[var(--line)] text-[var(--muted)] hover:border-[var(--signal)] hover:text-[var(--ink)]"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
            </button>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && ask(input)}
              onPaste={(e) => {
                if (e.clipboardData.files?.length) {
                  e.preventDefault();
                  addFiles(e.clipboardData.files);
                }
              }}
              placeholder={attachments.length ? "Ask about the attached file(s)…" : "Ask LightReel anything about UGC…"}
              className="min-w-0 flex-1 px-3.5 py-2.5 text-sm"
            />
            <button
              onClick={() => ask(input)}
              disabled={
                loading ||
                attachments.some((a) => a.status === "reading") ||
                (!input.trim() && !attachments.some((a) => a.status === "ready"))
              }
              className="btn btn-primary px-4 disabled:opacity-50"
            >
              {loading ? "…" : attachments.some((a) => a.status === "reading") ? "Reading…" : "Ask"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
