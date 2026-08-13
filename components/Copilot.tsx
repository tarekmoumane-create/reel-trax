"use client";

import { useEffect, useRef, useState } from "react";
import { useClients } from "@/app/providers";

interface Msg {
  role: "user" | "assistant";
  text: string;
}

const SUGGESTIONS = [
  "Who's gone quiet this week?",
  "Who do I need to follow up with?",
  "What's the projected payout this period?",
  "Who are my top performers right now?",
];

// Very light markdown: **bold** and - bullets.
function render(text: string) {
  return text.split("\n").map((line, i) => {
    const bulleted = /^\s*[-•]\s+/.test(line);
    const content = line.replace(/^\s*[-•]\s+/, "");
    const parts = content.split(/(\*\*[^*]+\*\*)/g).map((p, j) =>
      p.startsWith("**") && p.endsWith("**") ? (
        <strong key={j} className="text-[var(--ink)]">{p.slice(2, -2)}</strong>
      ) : (
        <span key={j}>{p}</span>
      )
    );
    return (
      <div key={i} className={bulleted ? "flex gap-2 pl-1" : ""}>
        {bulleted && <span className="text-[var(--signal)]">•</span>}
        <span>{parts}</span>
      </div>
    );
  });
}

export function Copilot() {
  const { currentClientId, currentClient } = useClients();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs, loading]);

  async function ask(question: string) {
    if (!question.trim() || !currentClientId || loading) return;
    setMsgs((m) => [...m, { role: "user", text: question }]);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch("/api/copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: currentClientId, question }),
      });
      const d = await res.json();
      setMsgs((m) => [...m, { role: "assistant", text: res.ok ? d.answer : `⚠ ${d.error || "Something went wrong."}` }]);
    } catch {
      setMsgs((m) => [...m, { role: "assistant", text: "⚠ Network error." }]);
    }
    setLoading(false);
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--panel)] px-2.5 py-2 text-[13px] font-medium hover:border-[var(--signal)]"
      >
        <span className="grid h-5 w-5 place-items-center rounded-md bg-gradient-to-br from-[var(--signal)] to-[var(--signal-2)] text-white">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" /></svg>
        </span>
        Copilot
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex justify-end bg-[var(--scrim)] backdrop-blur-sm" onMouseDown={() => setOpen(false)}>
          <div className="flex h-full w-full max-w-md flex-col border-l border-[var(--line)] bg-[var(--rail)]" onMouseDown={(e) => e.stopPropagation()}>
            {/* header */}
            <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
              <div className="flex items-center gap-2.5">
                <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-[var(--signal)] to-[var(--signal-2)] text-white">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" /></svg>
                </span>
                <div>
                  <div className="font-display text-sm font-bold">Copilot</div>
                  <div className="text-[11px] text-[var(--muted)]">{currentClient?.name ?? "No client"}</div>
                </div>
              </div>
              <button onClick={() => setOpen(false)} className="rounded-lg px-2 py-1 text-[var(--muted)] hover:bg-[var(--panel2)]">✕</button>
            </div>

            {/* messages */}
            <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
              {msgs.length === 0 && (
                <div className="pt-4">
                  <p className="text-sm text-[var(--muted)]">Ask me anything about <span className="text-[var(--ink)]">{currentClient?.name}</span>&apos;s creators, cadence, campaigns or payouts.</p>
                  <div className="mt-4 space-y-2">
                    {SUGGESTIONS.map((s) => (
                      <button key={s} onClick={() => ask(s)} className="block w-full rounded-lg border border-[var(--line)] bg-[var(--panel)] px-3 py-2 text-left text-[13px] hover:border-[var(--signal)]">
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {msgs.map((m, i) => (
                <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
                  <div className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ${m.role === "user" ? "bg-[var(--signal)] text-white" : "bg-[var(--panel)] text-[var(--muted)]"}`}>
                    {m.role === "assistant" ? <div className="space-y-1">{render(m.text)}</div> : m.text}
                  </div>
                </div>
              ))}
              {loading && <div className="text-[13px] text-[var(--faint)]">Thinking…</div>}
            </div>

            {/* input */}
            <div className="border-t border-[var(--line)] p-3">
              <div className="flex gap-2">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && ask(input)}
                  placeholder="Ask about this client…"
                  className="min-w-0 flex-1 px-3 py-2 text-sm"
                />
                <button onClick={() => ask(input)} disabled={loading || !input.trim()} className="btn btn-primary px-3 disabled:opacity-50">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" /></svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
