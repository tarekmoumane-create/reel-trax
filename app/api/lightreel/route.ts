import { ok, bad, serverError } from "@/lib/api";
import { getLightReelKey } from "@/lib/settings";

export const maxDuration = 300; // LightReel can take a while

// Proxies a research question to LightReel's /v1/chat so the key stays server-side.
export async function POST(request: Request) {
  try {
    const b = await request.json();
    const question = (b?.question ?? "").trim();
    const conversationId = b?.conversationId || undefined;
    if (!question) return bad("question is required");

    const key = await getLightReelKey();
    if (!key)
      return bad("No LightReel API key set. Add one in Settings to use Discover.", 400);

    const res = await fetch("https://api.lightreel.ai/v1/chat", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ question, ...(conversationId ? { conversation_id: conversationId } : {}) }),
      cache: "no-store",
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      let msg = txt.slice(0, 300);
      try {
        msg = JSON.parse(txt)?.error?.message || msg;
      } catch {}
      return bad(`LightReel error (${res.status}): ${msg}`, 502);
    }

    const data = await res.json();
    const answer =
      typeof data.answer === "string" ? data.answer : JSON.stringify(data.answer, null, 2);
    return ok({ conversationId: data.conversationId ?? conversationId ?? null, answer });
  } catch (e) {
    return serverError(e);
  }
}
