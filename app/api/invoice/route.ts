import { prisma } from "@/lib/db";
import { ok, bad, serverError } from "@/lib/api";
import {
  periodsSince, computeEarnings, effectiveRules, parseViewTiers, parsePayExclusions, paySummary, starterAnchor,
  type CampaignRules, type PeriodBounds,
} from "@/lib/payouts";
import { syncAutoCampaign } from "@/lib/autocampaign";
import { getInvoiceProfile } from "@/lib/settings";
import type { InvoiceLine } from "@/lib/invoice";

// A client statement for an arbitrary date range — what every creator earned
// between two dates, across all of the client's campaigns. Feeds the Invoice
// tab on Payouts and the printable invoice page.
//
// Rules are per billing period, so the range is walked period by period:
// each period that overlaps the range is clipped to it and computed on its
// own. Per-period amounts (base fees, flat deals, target bonuses) are charged
// once per period touched; per-video pay only counts videos posted in range.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86_400_000;

const dayStr = (d: Date) => d.toISOString().slice(0, 10);

/**
 * The start of this client's history: whichever came first, their earliest
 * tracked post or their earliest campaign. Falls back to the start of the
 * current month when there is nothing to bill yet.
 */
async function allTimeFrom(clientId: string): Promise<string> {
  const [post, campaign] = await Promise.all([
    prisma.post.findFirst({
      where: { creator: { clientId } },
      orderBy: { postedAt: "asc" },
      select: { postedAt: true },
    }),
    prisma.campaign.findFirst({
      where: { clientId },
      orderBy: { createdAt: "asc" },
      select: { startDate: true, createdAt: true },
    }),
  ]);
  const candidates = [post?.postedAt, campaign?.startDate ?? campaign?.createdAt].filter(Boolean) as Date[];
  if (!candidates.length) {
    const n = new Date();
    return dayStr(new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1)));
  }
  return dayStr(new Date(Math.min(...candidates.map((d) => d.getTime()))));
}

function rulesOf(c: {
  period: string; targetVideos: number | null; baseFee: number; perPost: number;
  cpmRate: number; cpmBasis: string; cpmCapPerVideo: number | null; viewTiers: string | null;
  bonus: number; minViews: number; viewWindowDays: number | null; payoutCap: number | null;
  starterDays: number | null; starterPerPost: number | null; payPerOriginal: boolean;
}): CampaignRules {
  return {
    period: c.period, targetVideos: c.targetVideos, baseFee: c.baseFee, perPost: c.perPost,
    cpmRate: c.cpmRate, cpmBasis: c.cpmBasis, cpmCapPerVideo: c.cpmCapPerVideo, viewTiers: parseViewTiers(c.viewTiers),
    bonus: c.bonus, minViews: c.minViews, viewWindowDays: c.viewWindowDays, payoutCap: c.payoutCap,
    starterDays: c.starterDays, starterPerPost: c.starterPerPost, payPerOriginal: c.payPerOriginal,
  };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get("clientId");
    if (!clientId) return bad("clientId is required");

    const client = await prisma.client.findUnique({ where: { id: clientId } });
    if (!client) return bad("Client not found", 404);

    // `all=1` means "the whole thing up to today": the server works out the
    // earliest date this client has any history for, so the statement covers
    // everything instead of the caller guessing a start date.
    let from = searchParams.get("from") ?? "";
    let to = searchParams.get("to") ?? "";
    if (searchParams.get("all") === "1") {
      const bounds = await allTimeFrom(clientId);
      from = bounds;
      to = dayStr(new Date());
    }
    if (!DATE_RE.test(from) || !DATE_RE.test(to) || from > to) return bad("from/to must be YYYY-MM-DD with from <= to");

    await syncAutoCampaign(clientId);

    const rangeStart = new Date(`${from}T00:00:00.000Z`);
    const rangeEnd = new Date(`${to}T23:59:59.999Z`);
    const now = new Date();

    const campaigns = await prisma.campaign.findMany({
      where: { clientId },
      include: {
        assignments: {
          include: {
            creator: {
              select: {
                id: true, displayName: true, onboardedAt: true, createdAt: true, tiktokHandle: true, instagramHandle: true, youtubeHandle: true, threadsHandle: true, facebookHandle: true,
                posts: {
                  select: {
                    platform: true, url: true, caption: true, postedAt: true, views: true,
                    payExclusions: true, isWarmUp: true, payOverride: true, groupKey: true,
                    snapshots: { select: { day: true, views: true } },
                  },
                },
              },
            },
          },
        },
      },
    });

    const lines = new Map<string, InvoiceLine>();
    let currency = "USD";

    for (const c of campaigns) {
      if (c.status === "paused") continue;
      currency = c.currency || currency;
      const baseRules = rulesOf(c);
      const campaignStart = c.startDate ?? c.createdAt;
      // Periods from campaign start through the range end, then keep the
      // ones that overlap the range (and the campaign's own lifetime).
      const periods = periodsSince(c.period, campaignStart, rangeEnd, 600).filter((p) => {
        if (p.end.getTime() < rangeStart.getTime() || p.start.getTime() > rangeEnd.getTime()) return false;
        if (c.endDate && p.start.getTime() > c.endDate.getTime()) return false;
        return true;
      });
      for (const p of periods) {
        const bounds: PeriodBounds = {
          start: new Date(Math.max(p.start.getTime(), rangeStart.getTime())),
          end: new Date(Math.min(p.end.getTime(), rangeEnd.getTime())),
          label: p.label,
        };
        for (const a of c.assignments) {
          const rules = effectiveRules(baseRules, { ...a, viewTiers: parseViewTiers(a.viewTiers) });
          const e = computeEarnings(rules, a.creator.posts, bounds, now, { onboardedAt: a.creator.onboardedAt, firstPostAt: starterAnchor(a.creator.posts, a.creator) });
          const inRange = a.creator.posts.filter((v) => v.postedAt.getTime() >= bounds.start.getTime() && v.postedAt.getTime() <= bounds.end.getTime());
          if (e.amount === 0 && inRange.length === 0) continue;

          const cr = a.creator;
          const line = lines.get(cr.id) ?? {
            creatorId: cr.id, creatorName: cr.displayName,
            handles: [cr.tiktokHandle && `TT @${cr.tiktokHandle}`, cr.instagramHandle && `IG @${cr.instagramHandle}`, cr.youtubeHandle && `YT @${cr.youtubeHandle}`, cr.threadsHandle && `TH @${cr.threadsHandle}`, cr.facebookHandle && `FB ${cr.facebookHandle}`].filter(Boolean) as string[],
            campaigns: [], posts: 0, views: 0, amount: 0, breakdown: [], videos: [],
          };
          if (!line.campaigns.includes(c.name)) line.campaigns.push(c.name);
          line.posts += e.qualifyingPosts;
          line.views += e.qualifyingViews;
          line.amount += e.amount;
          for (const b of e.breakdown) {
            const label = b.label.replace(/ × \d+$/, "").replace(/ \(.*\)$/, "");
            const hit = line.breakdown.find((x) => x.label === label);
            if (hit) hit.amount += b.amount; else line.breakdown.push({ label, amount: b.amount });
          }
          if (e.capped) {
            const hit = line.breakdown.find((x) => x.label === "Cap applied");
            const over = e.breakdown.reduce((s, b) => s + b.amount, 0) - e.amount;
            if (hit) hit.amount -= over; else line.breakdown.push({ label: "Cap applied", amount: -over });
          }
          // With cross-posts paid once, the copies still get listed — a client
          // should see every placement — but they're marked so the video count
          // and the line total visibly agree.
          const original = new Map<string, string>();
          if (rules.payPerOriginal) {
            for (const v of inRange) {
              if (!v.groupKey) continue;
              const held = original.get(v.groupKey);
              if (!held || v.postedAt.toISOString() < held) original.set(v.groupKey, v.postedAt.toISOString());
            }
          }
          for (const v of inRange) {
            const isCopy = !!v.groupKey && original.get(v.groupKey) !== undefined && original.get(v.groupKey) !== v.postedAt.toISOString();
            line.videos.push({
              platform: v.platform, url: v.url, caption: v.caption, postedAt: v.postedAt.toISOString(), views: v.views,
              pay: isCopy
                ? "Cross-post"
                : paySummary({ exclusions: parsePayExclusions(v.payExclusions), isWarmUp: v.isWarmUp, payOverride: v.payOverride }, currency).label,
            });
          }
          lines.set(cr.id, line);
        }
      }
    }

    const out = [...lines.values()]
      .map((l) => ({
        ...l,
        amount: Math.round(l.amount * 100) / 100,
        breakdown: l.breakdown.map((b) => ({ ...b, amount: Math.round(b.amount * 100) / 100 })).filter((b) => b.amount !== 0),
        videos: l.videos.sort((a, b) => (a.postedAt < b.postedAt ? -1 : 1)),
      }))
      .sort((a, b) => b.amount - a.amount || a.creatorName.localeCompare(b.creatorName));

    const total = Math.round(out.reduce((s, l) => s + l.amount, 0) * 100) / 100;
    const days = Math.round((rangeEnd.getTime() - rangeStart.getTime()) / DAY);

    return ok({
      client: { id: client.id, name: client.name, website: client.website, logoUrl: client.logoUrl },
      from, to, days, currency,
      lines: out,
      totals: {
        amount: total,
        creators: out.length,
        posts: out.reduce((s, l) => s + l.posts, 0),
        views: out.reduce((s, l) => s + l.views, 0),
        videos: out.reduce((s, l) => s + l.videos.length, 0),
      },
      profile: await getInvoiceProfile(),
    });
  } catch (e) {
    return serverError(e);
  }
}
