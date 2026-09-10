import { prisma } from "@/lib/db";
import { ok, bad, serverError } from "@/lib/api";
import {
  periodsSince, computeEarnings, effectiveRules, parseViewTiers, parsePayExclusions, paySummary,
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

function rulesOf(c: {
  period: string; targetVideos: number | null; baseFee: number; perPost: number;
  cpmRate: number; cpmBasis: string; cpmCapPerVideo: number | null; viewTiers: string | null;
  bonus: number; minViews: number; viewWindowDays: number | null; payoutCap: number | null;
}): CampaignRules {
  return {
    period: c.period, targetVideos: c.targetVideos, baseFee: c.baseFee, perPost: c.perPost,
    cpmRate: c.cpmRate, cpmBasis: c.cpmBasis, cpmCapPerVideo: c.cpmCapPerVideo, viewTiers: parseViewTiers(c.viewTiers),
    bonus: c.bonus, minViews: c.minViews, viewWindowDays: c.viewWindowDays, payoutCap: c.payoutCap,
  };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get("clientId");
    const from = searchParams.get("from") ?? "";
    const to = searchParams.get("to") ?? "";
    if (!clientId) return bad("clientId is required");
    if (!DATE_RE.test(from) || !DATE_RE.test(to) || from > to) return bad("from/to must be YYYY-MM-DD with from <= to");

    const client = await prisma.client.findUnique({ where: { id: clientId } });
    if (!client) return bad("Client not found", 404);

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
                id: true, displayName: true, tiktokHandle: true, instagramHandle: true, youtubeHandle: true, threadsHandle: true, facebookHandle: true,
                posts: {
                  select: {
                    platform: true, url: true, caption: true, postedAt: true, views: true,
                    payExclusions: true, isWarmUp: true, payOverride: true,
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
      const periods = periodsSince(c.period, campaignStart, rangeEnd, 120).filter((p) => {
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
          const e = computeEarnings(rules, a.creator.posts, bounds, now);
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
          for (const v of inRange) {
            line.videos.push({
              platform: v.platform, url: v.url, caption: v.caption, postedAt: v.postedAt.toISOString(), views: v.views,
              pay: paySummary({ exclusions: parsePayExclusions(v.payExclusions), isWarmUp: v.isWarmUp, payOverride: v.payOverride }, currency).label,
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
