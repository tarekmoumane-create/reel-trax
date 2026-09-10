import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { ok, bad, serverError } from "@/lib/api";
import { getAnthropicKey } from "@/lib/settings";

export const maxDuration = 60;

// Turns a free-text Discover answer into a spreadsheet-shaped table so it can
// be dropped into Google Sheets. Claude does the structuring — answers vary
// from creator lists to trend breakdowns, so a fixed parser won't cut it.

const Table = z.object({
  title: z.string(),
  headers: z.array(z.string()).min(1),
  rows: z.array(z.array(z.string())).min(1),
});

export async function POST(request: Request) {
  try {
    const b = await request.json();
    const answer = (b?.answer ?? "").trim();
    if (!answer) return bad("answer is required");

    const apiKey = await getAnthropicKey();
    if (!apiKey) return bad("No Anthropic API key set. Add one in Settings to export.", 400);

    const anthropic = new Anthropic({ apiKey });
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 16000,
      system:
        'Convert research answers into a single spreadsheet table. Respond with ONLY a JSON object: {"title": string, "headers": string[], "rows": string[][]}. Every row must have exactly as many cells as there are headers. Pick columns that fit the content (e.g. creators → Name, Handle, Account link, Followers, Niche, Why; trends/hooks → Trend, Description, Example, Why it works). REQUIRED: whenever rows are creators, accounts, or videos, include an "Account link" column with the full profile URL for every row — use URLs from the answer when present, otherwise construct them from the platform and handle (TikTok → https://www.tiktok.com/@handle, Instagram → https://www.instagram.com/handle, YouTube → https://www.youtube.com/@handle, Threads → https://www.threads.com/@handle, Facebook → https://www.facebook.com/handle; assume TikTok if the platform is unstated). For videos, also include the video URL if the answer has one. Preserve every distinct item from the answer as its own row. Use "" for unknown cells. No markdown, no commentary.',
      messages: [{ role: "user", content: answer }],
    });

    const text = msg.content
      .filter((blk): blk is Anthropic.TextBlock => blk.type === "text")
      .map((blk) => blk.text)
      .join("")
      .trim();

    if (msg.stop_reason === "max_tokens")
      return bad("This answer is too long to export in one table — try exporting a shorter answer.", 422);

    // Tolerate a stray code fence around the JSON.
    const jsonText = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    let raw: unknown;
    try {
      raw = JSON.parse(jsonText);
    } catch {
      return bad("Couldn't structure this answer into a table — try again.", 422);
    }
    const parsed = Table.safeParse(raw);
    if (!parsed.success) return bad("Couldn't structure this answer into a table", 422);

    const { title, headers, rows } = parsed.data;
    const width = headers.length;
    const squared = rows.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ""));
    return ok({ title, headers, rows: squared });
  } catch (e) {
    return serverError(e);
  }
}
