import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db";
import { ok, bad, serverError } from "@/lib/api";
import { computeCadence } from "@/lib/cadence";
import { getAnthropicKey, getTimeZone } from "@/lib/settings";
import { periodBounds, computeEarnings, effectiveRules, parseViewTiers, type CampaignRules } from "@/lib/payouts";

export const maxDuration = 60;

// Builds a compact snapshot of one client's world so Claude can answer
// operational questions ("who's behind this week?", "who do I owe?").
async function buildSnapshot(clientId: string) {
  const tz = await getTimeZone();
  const now = new Date();
  const client = await prisma.client.findUnique({ where: { id: clientId } });

  const creators = await prisma.creator.findMany({
    where: { clientId },
    include: { posts: { select: { postedAt: true, views: true, payExclusions: true, isWarmUp: true, payOverride: true } } },
  });

  const creatorRows = creators.map((c) => {
    const cad = computeCadence(c.posts, { expectedPerWeek: c.expectedPerWeek, now, timeZone: tz });
    return {
      name: c.displayName,
      status: c.status,
      source: c.source,
      tiktok: c.tiktokHandle,
      instagram: c.instagramHandle,
      youtube: c.youtubeHandle,
      threads: c.threadsHandle,
      cadenceStatus: cad.status,
      postsLast7d: cad.postsLast7d,
      target: c.expectedPerWeek,
      streakDays: cad.currentStreakDays,
      daysSinceLastPost: cad.daysSinceLastPost,
    };
  });

  const campaigns = await prisma.campaign.findMany({
    where: { clientId },
    include: { assignments: { include: { creator: { include: { posts: { select: { postedAt: true, views: true, payExclusions: true, isWarmUp: true, payOverride: true } } } } } } },
  });
  const campaignRows = campaigns.map((c) => {
    const bounds = periodBounds(c.period, now);
    const base: CampaignRules = {
      period: c.period, targetVideos: c.targetVideos, baseFee: c.baseFee, perPost: c.perPost,
      cpmRate: c.cpmRate, cpmBasis: c.cpmBasis, cpmCapPerVideo: c.cpmCapPerVideo, viewTiers: parseViewTiers(c.viewTiers),
      bonus: c.bonus, minViews: c.minViews, viewWindowDays: c.viewWindowDays, payoutCap: c.payoutCap,
    };
    const creatorsPay = c.assignments.map((a) => ({
      name: a.creator.displayName,
      earned: computeEarnings(effectiveRules(base, { ...a, viewTiers: parseViewTiers(a.viewTiers) }), a.creator.posts, bounds).amount,
    }));
    return {
      name: c.name, status: c.status, period: c.period, targetVideos: c.targetVideos,
      currentPeriod: bounds.label,
      periodTotal: Math.round(creatorsPay.reduce((s, x) => s + x.earned, 0) * 100) / 100,
      currency: c.currency, creators: creatorsPay,
    };
  });

  return { client: client?.name, timeZone: tz, today: now.toISOString().slice(0, 10), creators: creatorRows, campaigns: campaignRows };
}

export async function POST(request: Request) {
  try {
    const b = await request.json();
    const clientId = b?.clientId;
    const question = (b?.question ?? "").trim();
    if (!clientId) return bad("clientId is required");
    if (!question) return bad("question is required");

    const apiKey = await getAnthropicKey();
    if (!apiKey)
      return bad("No Anthropic API key set. Add one in Settings to use the copilot.", 400);

    const snapshot = await buildSnapshot(clientId);
    const anthropic = new Anthropic({ apiKey });

    const system =
      "You are the Reel Trax copilot, an assistant for a UGC creator agency. You answer questions about ONE client's creators, their posting cadence, campaigns, and payouts using ONLY the JSON snapshot provided. Be concise and specific: name creators, cite numbers (posts, streaks, days since last post, dollar amounts). When asked who needs attention, prioritize 'quiet' then 'behind' cadence. If the snapshot doesn't contain the answer, say so briefly. Format with short markdown (bullets, bold names). Do not invent data.";

    const msg = await anthropic.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 1200,
      system,
      messages: [
        {
          role: "user",
          content: `Client data snapshot (JSON):\n\`\`\`json\n${JSON.stringify(snapshot)}\n\`\`\`\n\nQuestion: ${question}`,
        },
      ],
    });

    const text = msg.content
      .filter((blk): blk is Anthropic.TextBlock => blk.type === "text")
      .map((blk) => blk.text)
      .join("\n")
      .trim();

    return ok({ answer: text || "(no answer)" });
  } catch (e) {
    return serverError(e);
  }
}
