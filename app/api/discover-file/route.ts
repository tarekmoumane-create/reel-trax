import Anthropic from "@anthropic-ai/sdk";
import { ok, bad, serverError } from "@/lib/api";
import { getAnthropicKey } from "@/lib/settings";

export const maxDuration = 120;

// Extracts the contents of an uploaded file (PDF or image) into text so it can
// ride along with a Discover question. LightReel's chat API is text-only, so
// Claude reads the file and produces a faithful text version of it.
// Text-like files never hit this route — the browser reads those directly.

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
type ImageType = (typeof IMAGE_TYPES)[number];

// Vercel functions reject request bodies over ~4.5MB, so cap the raw file at
// 3MB (base64 inflates by ~1/3). The client enforces this too.
const MAX_BYTES = 3 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const b = await request.json();
    const name = (b?.name ?? "file").toString().slice(0, 200);
    const mediaType = (b?.mediaType ?? "").toString();
    const data = (b?.dataBase64 ?? "").toString();
    if (!data) return bad("dataBase64 is required");
    if (data.length > (MAX_BYTES * 4) / 3 + 1024) return bad("File is too large — 3MB max");

    const isPdf = mediaType === "application/pdf";
    const isImage = (IMAGE_TYPES as readonly string[]).includes(mediaType);
    if (!isPdf && !isImage) return bad(`Unsupported file type: ${mediaType || "unknown"}`);

    const apiKey = await getAnthropicKey();
    if (!apiKey) return bad("No Anthropic API key set. Add one in Settings to attach files.", 400);

    const anthropic = new Anthropic({ apiKey });
    const fileBlock = isPdf
      ? ({ type: "document", source: { type: "base64", media_type: "application/pdf", data } } as const)
      : ({ type: "image", source: { type: "base64", media_type: mediaType as ImageType, data } } as const);

    const response = await anthropic.messages.create({
      model: "claude-opus-5",
      max_tokens: 8192,
      system:
        "Extract the contents of the file into plain text for a UGC/creator-marketing research assistant. Transcribe all text faithfully. For images, also describe what is shown (layout, people, products, on-screen captions, visible metrics like view counts). For briefs/decks, preserve the structure with simple headings and bullets. Output only the extracted content — no commentary.",
      messages: [
        {
          role: "user",
          content: [fileBlock, { type: "text", text: `Extract the contents of this file ("${name}").` }],
        },
      ],
    });

    if (response.stop_reason === "refusal") return bad("Couldn't read this file", 422);

    const text = response.content
      .filter((blk): blk is Anthropic.TextBlock => blk.type === "text")
      .map((blk) => blk.text)
      .join("\n")
      .trim();
    if (!text) return bad("Couldn't extract anything from this file", 422);

    return ok({ text });
  } catch (e) {
    return serverError(e);
  }
}
