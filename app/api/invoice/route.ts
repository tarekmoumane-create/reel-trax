import { prisma } from "@/lib/db";
import { ok, bad, serverError } from "@/lib/api";
import { parsePayExclusions, paySummary } from "@/lib/payouts";
import { syncAutoCampaign } from "@/lib/autocampaign";
import { getInvoiceProfile } from "@/lib/settings";
import {
  DATE_RE, DAY, dayStr, dayStart, dayEnd, cents,
  settle, loadCampaigns, historyStart, lastSettledThrough, oldestOwed, managementFeeMonths,
} from "@/lib/payrun";
import type { InvoiceLine } from "@/lib/invoice";

// What every creator earned for a pay period, across all of a client's
// campaigns, and how much of it is still owed. Feeds the Payouts page and the
// printable invoice.
//
// The period is either explicit (`from` + `to`), `all=1` for the client's whole
// history, or `since=last` — from the oldest day any creator is still owed
// through today, which is how a pay run picks up where the last one stopped.
// (When nobody is owed anything, the day after the latest recorded payment.)
// The math lives in lib/payrun so "Mark paid" records the same numbers.

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get("clientId");
    if (!clientId) return bad("clientId is required");

    const client = await prisma.client.findUnique({ where: { id: clientId } });
    if (!client) return bad("Client not found", 404);

    const now = new Date();
    const all = searchParams.get("all") === "1";
    const sinceLast = searchParams.get("since") === "last";
    let from = searchParams.get("from") ?? "";
    let to = searchParams.get("to") ?? "";
    if (!all && !sinceLast && (!DATE_RE.test(from) || !DATE_RE.test(to) || from > to)) {
      return bad("from/to must be YYYY-MM-DD with from <= to");
    }

    await syncAutoCampaign(clientId);
    const [history, campaigns] = await Promise.all([historyStart(clientId), loadCampaigns(clientId)]);

    if (all) {
      from = history;
      to = dayStr(now);
    } else if (sinceLast) {
      to = dayStr(now);
      const oldest = oldestOwed(campaigns, dayStart(history), dayEnd(to), now);
      if (oldest) from = dayStr(oldest);
      else {
        const through = await lastSettledThrough(clientId);
        from = through ? dayStr(new Date(through.getTime() + 1)) : history;
      }
      // Paid right up to today: show today, which will read as settled.
      if (from > to) from = to;
    }

    const rangeStart = dayStart(from);
    const rangeEnd = dayEnd(to);
    // Anything still owed from before this period — so "since last payment"
    // can never quietly hide a creator who was skipped in an earlier run.
    const earlierEnd = from > history ? new Date(rangeStart.getTime() - 1) : null;

    const lines = new Map<string, InvoiceLine>();
    let currency = "USD";
    let earlierOwed = 0;
    const earlierCreators = new Set<string>();

    for (const c of campaigns) {
      if (c.status === "paused") continue;
      currency = c.currency || currency;
      for (const a of c.assignments) {
        const cr = a.creator;
        const records = c.payouts.filter((p) => p.creatorId === cr.id);
        const st = settle(c, a, records, rangeStart, rangeEnd, now);

        if (earlierEnd) {
          const before = settle(c, a, records, dayStart(history), earlierEnd, now);
          earlierOwed += before.owed;
          if (before.owed > 0) earlierCreators.add(cr.id);
        }

        const inRange = cr.posts.filter((v) => v.postedAt.getTime() >= rangeStart.getTime() && v.postedAt.getTime() <= rangeEnd.getTime());
        if (st.earned.amount === 0 && inRange.length === 0 && st.owed === 0 && st.records.length === 0) continue;

        const line = lines.get(cr.id) ?? {
          creatorId: cr.id, creatorName: cr.displayName,
          handles: [cr.tiktokHandle && `TT @${cr.tiktokHandle}`, cr.instagramHandle && `IG @${cr.instagramHandle}`, cr.youtubeHandle && `YT @${cr.youtubeHandle}`, cr.threadsHandle && `TH @${cr.threadsHandle}`, cr.facebookHandle && `FB ${cr.facebookHandle}`, cr.snapchatHandle && `SC @${cr.snapchatHandle}`].filter(Boolean) as string[],
          campaigns: [], posts: 0, views: 0, amount: 0, breakdown: [], videos: [],
          owed: 0, paid: 0, late: 0, records: [],
          pay: { sideshiftUrl: cr.sideshiftUrl, paymentMethod: cr.paymentMethod, paymentHandle: cr.paymentHandle },
        };
        if (!line.campaigns.includes(c.name)) line.campaigns.push(c.name);
        line.posts += st.earned.posts;
        line.views += st.earned.views;
        line.amount += st.earned.amount;
        line.owed += st.owed;
        line.paid += st.paid;
        line.late += st.late;
        for (const b of st.earned.breakdown) {
          const hit = line.breakdown.find((x) => x.label === b.label);
          if (hit) hit.amount += b.amount;
          else line.breakdown.push({ ...b });
        }
        for (const r of st.records) {
          line.records.push({
            id: r.id, campaign: c.name, from: dayStr(r.periodStart), to: dayStr(r.periodEnd),
            amount: r.amount, live: r.live, status: r.status, paidAt: r.paidAt?.toISOString() ?? null,
          });
        }

        // With cross-posts paid once, the copies still get listed — a client
        // should see every placement — but they're marked so the video count
        // and the line total visibly agree.
        const original = new Map<string, string>();
        if (c.payPerOriginal) {
          for (const v of inRange) {
            if (!v.groupKey) continue;
            const held = original.get(v.groupKey);
            if (!held || v.postedAt.toISOString() < held) original.set(v.groupKey, v.postedAt.toISOString());
          }
        }
        for (const v of inRange) {
          const first = v.groupKey ? original.get(v.groupKey) : undefined;
          const isCopy = first !== undefined && first !== v.postedAt.toISOString();
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

    const out = [...lines.values()]
      .map((l) => ({
        ...l,
        amount: cents(l.amount), owed: cents(l.owed), paid: cents(l.paid), late: cents(l.late),
        breakdown: l.breakdown.map((b) => ({ ...b, amount: cents(b.amount) })).filter((b) => b.amount !== 0),
        records: l.records.sort((a, b) => (a.from < b.from ? -1 : 1)),
        videos: l.videos.sort((a, b) => (a.postedAt < b.postedAt ? -1 : 1)),
      }))
      .sort((a, b) => b.owed - a.owed || b.amount - a.amount || a.creatorName.localeCompare(b.creatorName));

    const sum = (k: "amount" | "owed" | "paid") => cents(out.reduce((s, l) => s + l[k], 0));
    // The agency's own monthly fee — billed to the client, never owed to creators.
    const fees = managementFeeMonths(
      client.managementFee,
      client.managementFeeStart ? dayStr(client.managementFeeStart) : history,
      from,
      to
    );
    const days = Math.round((rangeEnd.getTime() - rangeStart.getTime()) / DAY);

    return ok({
      client: {
        id: client.id, name: client.name, website: client.website, logoUrl: client.logoUrl,
        managementFee: client.managementFee,
        managementFeeStart: client.managementFeeStart ? dayStr(client.managementFeeStart) : null,
      },
      from, to, days, currency,
      since: all ? "all" : sinceLast ? "last" : null,
      historyFrom: history,
      lines: out,
      fees,
      totals: {
        amount: sum("amount"),
        owed: sum("owed"),
        paid: sum("paid"),
        fees: cents(fees.reduce((s, f) => s + f.amount, 0)),
        creators: out.length,
        posts: out.reduce((s, l) => s + l.posts, 0),
        views: out.reduce((s, l) => s + l.views, 0),
        videos: out.reduce((s, l) => s + l.videos.length, 0),
      },
      earlier: earlierEnd
        ? { amount: cents(earlierOwed), creators: earlierCreators.size, from: history, to: dayStr(earlierEnd) }
        : null,
      profile: await getInvoiceProfile(),
    });
  } catch (e) {
    return serverError(e);
  }
}
