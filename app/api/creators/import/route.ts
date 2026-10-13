import { prisma } from "@/lib/db";
import { ok, bad, serverError } from "@/lib/api";
import { syncAutoCampaign } from "@/lib/autocampaign";
import {
  parseTikTokHandle,
  parseInstagramHandle,
  parseYouTube,
  parseThreadsHandle,
  parseFacebook,
  resolveSnapchat,
} from "@/lib/scrapecreators";
import { getScrapeCreatorsKey } from "@/lib/settings";
import { syncCreators, type SyncableCreator } from "@/lib/sync";
import type { CreatorDraft } from "@/lib/creatorCsv";

export const maxDuration = 300;

// Leave headroom under maxDuration so the response still gets out; creators
// that didn't get their first sync here are picked up by the 6h cron or the
// client's Sync button.
const SYNC_BUDGET_MS = 230_000;
const MAX_ROWS = 500;

export interface ImportRowResult {
  index: number;
  displayName: string;
  status: "created" | "skipped" | "failed";
  creatorId?: string;
  reason?: string;
}

function str(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s : null;
}

/** Bulk-add creators from a CSV the user previewed in the browser. */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const clientId = str(body?.clientId);
    if (!clientId) return bad("clientId is required");
    const drafts: Partial<CreatorDraft>[] = Array.isArray(body?.creators) ? body.creators : [];
    if (!drafts.length) return bad("No creators to import");
    if (drafts.length > MAX_ROWS) return bad(`Import at most ${MAX_ROWS} creators at a time`);

    const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true } });
    if (!client) return bad("Client not found", 404);

    // Duplicate guard against the roster as it is right now, plus rows earlier
    // in this same file — the browser preview checks too, but the server is
    // what actually has to be right.
    const existing = await prisma.creator.findMany({
      where: { clientId },
      select: {
        id: true,
        displayName: true,
        tiktokHandle: true,
        instagramHandle: true,
        youtubeHandle: true,
        youtubeChannelId: true,
        threadsHandle: true,
        facebookHandle: true,
        snapchatHandle: true,
      },
    });
    const taken = new Map<string, string>();
    const keyOf = (p: string, h: string | null | undefined) => (h ? `${p}:${h.toLowerCase()}` : null);
    const remember = (c: (typeof existing)[number]) => {
      for (const k of [
        keyOf("tt", c.tiktokHandle),
        keyOf("ig", c.instagramHandle),
        keyOf("yt", c.youtubeHandle),
        keyOf("ytid", c.youtubeChannelId),
        keyOf("th", c.threadsHandle),
        keyOf("fb", c.facebookHandle),
        keyOf("sc", c.snapchatHandle),
      ])
        if (k && !taken.has(k)) taken.set(k, c.displayName);
    };
    existing.forEach(remember);

    const results: ImportRowResult[] = [];
    const created: SyncableCreator[] = [];

    for (let i = 0; i < drafts.length; i++) {
      const d = drafts[i];
      const displayName = str(d.displayName);
      if (!displayName) {
        results.push({ index: i, displayName: "", status: "failed", reason: "No name" });
        continue;
      }

      const tiktokUrl = str(d.tiktokUrl);
      const instagramUrl = str(d.instagramUrl);
      const youtubeUrl = str(d.youtubeUrl);
      const threadsUrl = str(d.threadsUrl);
      const snap = await resolveSnapchat(str(d.snapchatUrl));
      const snapchatUrl = snap.url;
      const tiktokHandle = tiktokUrl ? parseTikTokHandle(tiktokUrl) : null;
      const instagramHandle = instagramUrl ? parseInstagramHandle(instagramUrl) : null;
      const yt = parseYouTube(youtubeUrl ?? "");
      const threadsHandle = threadsUrl ? parseThreadsHandle(threadsUrl) : null;
      const fb = parseFacebook(str(d.facebookUrl) ?? "");
      const snapchatHandle = snap.handle;

      if (!tiktokHandle && !instagramHandle && !youtubeUrl && !threadsHandle && !fb.url && !snapchatHandle) {
        results.push({ index: i, displayName, status: "failed", reason: "No profile URL on a tracked platform" });
        continue;
      }

      const keys = [
        keyOf("tt", tiktokHandle),
        keyOf("ig", instagramHandle),
        keyOf("yt", yt.handle),
        keyOf("ytid", yt.channelId),
        keyOf("th", threadsHandle),
        keyOf("fb", fb.handle),
        keyOf("sc", snapchatHandle),
      ].filter((k): k is string => !!k);
      const dupKey = keys.find((k) => taken.has(k));
      if (dupKey) {
        results.push({ index: i, displayName, status: "skipped", reason: `Already tracked as ${taken.get(dupKey)}` });
        continue;
      }

      const onboarded = d.onboardedAt ? new Date(d.onboardedAt) : new Date();
      const perWeek = typeof d.expectedPerWeek === "number" && Number.isFinite(d.expectedPerWeek) ? d.expectedPerWeek : 7;

      try {
        const creator = await prisma.creator.create({
          data: {
            clientId,
            displayName,
            tiktokUrl,
            tiktokHandle,
            instagramUrl,
            instagramHandle,
            youtubeUrl,
            youtubeHandle: yt.handle,
            youtubeChannelId: yt.channelId,
            threadsUrl,
            threadsHandle,
            facebookUrl: fb.url,
            facebookHandle: fb.handle,
            snapchatUrl,
            snapchatHandle,
            source: str(d.source) ?? "sideshift",
            sourceDetail: str(d.sourceDetail),
            sideshiftUrl: str(d.sideshiftUrl),
            paymentMethod: str(d.paymentMethod) ?? "sideshift",
            paymentHandle: str(d.paymentHandle),
            phone: str(d.phone),
            email: str(d.email),
            contactHandle: str(d.contactHandle),
            discord: str(d.discord),
            discordChannel: str(d.discordChannel),
            whatsapp: str(d.whatsapp),
            expectedPerWeek: Math.max(1, Math.min(21, Math.round(perWeek))),
            onboardedAt: isNaN(onboarded.getTime()) ? new Date() : onboarded,
            status: "active",
            notes: str(d.notes),
          },
        });
        for (const k of keys) taken.set(k, displayName);
        created.push(creator);
        results.push({ index: i, displayName, status: "created", creatorId: creator.id });
      } catch (e) {
        results.push({ index: i, displayName, status: "failed", reason: e instanceof Error ? e.message : "Could not save" });
      }
    }

    if (created.length) await syncAutoCampaign(clientId);

    // First sync, as many as fit in the time budget; the rest wait for cron.
    let synced = 0;
    let syncFailed = 0;
    let syncPending = created.length;
    const apiKey = await getScrapeCreatorsKey();
    if (apiKey && created.length) {
      const started = Date.now();
      const batch = 3;
      for (let i = 0; i < created.length; i += batch) {
        if (Date.now() - started > SYNC_BUDGET_MS) break;
        const slice = created.slice(i, i + batch);
        try {
          const r = await syncCreators(slice, apiKey, batch);
          synced += r.filter((x) => x.ok).length;
          syncFailed += r.filter((x) => !x.ok).length;
        } catch {
          syncFailed += slice.length;
        }
        syncPending -= slice.length;
      }
    }

    return ok({
      results,
      created: created.length,
      skipped: results.filter((r) => r.status === "skipped").length,
      failed: results.filter((r) => r.status === "failed").length,
      sync: { attempted: !!apiKey, synced, failed: syncFailed, pending: syncPending },
    });
  } catch (e) {
    return serverError(e);
  }
}
