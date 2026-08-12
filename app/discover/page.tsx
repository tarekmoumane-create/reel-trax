"use client";

import { useEffect, useRef, useState } from "react";
import { TopBar, PageTitle } from "@/components/PageHeader";

interface Msg {
  role: "user" | "assistant";
  text: string;
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
  const scrollRef = useRef<HTMLDivElement>(null);

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
          {msgs.map((m, i) => (
            <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
              <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-[13px] leading-relaxed ${m.role === "user" ? "bg-[var(--signal)] text-white" : "bg-[var(--panel)] text-[var(--muted)]"}`}>
                {m.role === "assistant" ? <div className="space-y-1">{render(m.text)}</div> : m.text}
              </div>
            </div>
          ))}
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
