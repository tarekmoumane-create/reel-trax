import { prisma } from "@/lib/db";
import { ok, bad, serverError } from "@/lib/api";
import { DATE_RE, dayStart, dayEnd, cents, settle, earningsForRange, loadCampaigns } from "@/lib/payrun";

// Record a pay run, or undo one record.
//
// { clientId, creatorId | all: true, from, to, status: "paid" | "cancelled" }
//   Records every part of [from, to] that no payment covers yet, for that
//   creator (or every creator) on each campaign they're on, at what they earned
//   there. Paying also tops up earlier records in the range that have earned
//   more since — a video that crossed the minimum after it was paid.
//   Amounts come from lib/payrun, the same math the Payouts page shows.
//
// { payoutId, status: "due" }
//   Deletes that record, so its period is owed again.
export async function POST(request: Request) {
  try {
    const b = await request.json();

    if (b?.status === "due") {
      if (!b.payoutId) return bad("payoutId is required");
      await prisma.payout.delete({ where: { id: String(b.payoutId) } }).catch(() => null);
      return ok({ status: "due" });
    }

    const status = b?.status;
    if (status !== "paid" && status !== "cancelled") return bad("Invalid status");
    const clientId = String(b?.clientId ?? "");
    const from = String(b?.from ?? "");
    const to = String(b?.to ?? "");
    if (!clientId) return bad("clientId is required");
    if (!DATE_RE.test(from) || !DATE_RE.test(to) || from > to) return bad("from/to must be YYYY-MM-DD with from <= to");
    const all = b?.all === true;
    const creatorId = all ? undefined : String(b?.creatorId ?? "");
    if (!all && !creatorId) return bad("creatorId or all is required");

    const now = new Date();
    const start = dayStart(from);
    const end = dayEnd(to);
    const campaigns = await loadCampaigns(clientId, creatorId);

    let created = 0;
    let toppedUp = 0;
    let amount = 0;
    for (const c of campaigns) {
      if (c.status === "paused") continue;
      for (const a of c.assignments) {
        const records = c.payouts.filter((p) => p.creatorId === a.creator.id);
        const st = settle(c, a, records, start, end, now);

        for (const g of st.gaps) {
          const e = earningsForRange(c, a, g.start, g.end, now);
          // Nothing earned here yet: leave it open, so a video that qualifies
          // later still shows up as owed instead of being settled at $0.
          if (e.amount === 0) continue;
          await prisma.payout.create({
            data: {
              campaignId: c.id, creatorId: a.creator.id, periodStart: g.start, periodEnd: g.end,
              amount: status === "cancelled" ? 0 : e.amount, currency: c.currency, status,
              postsCount: e.posts, viewsCount: e.views, paidAt: status === "paid" ? now : null,
            },
          });
          created++;
          if (status === "paid") amount += e.amount;
        }

        if (status !== "paid") continue;
        for (const r of st.records) {
          if (r.status !== "paid" || r.periodEnd.getTime() > end.getTime()) continue;
          const delta = cents(r.live - r.amount);
          if (delta < 0.01) continue;
          await prisma.payout.update({ where: { id: r.id }, data: { amount: r.live, paidAt: now } });
          toppedUp++;
          amount += delta;
        }
      }
    }

    return ok({ created, toppedUp, amount: cents(amount) });
  } catch (e) {
    return serverError(e);
  }
}
