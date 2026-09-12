import { prisma } from "./db";
import { parsePayRules, type PayRulesJson } from "./payouts";

// The auto campaign: every client with a real payment structure gets a
// campaign named "General" that mirrors that structure, with all creators
// assigned except those in a manual campaign (so nobody is paid twice).
// Payouts then track with zero setup. Re-synced whenever the structure,
// the roster, or manual assignments change — and lazily from the payouts
// and campaigns pages, which backfills clients that predate the feature.

function campaignDataFromRules(r: PayRulesJson) {
  return {
    period: r.period === "weekly" ? "weekly" : "monthly",
    targetVideos: r.targetVideos ?? null,
    baseFee: r.baseFee ?? 0,
    perPost: r.perPost ?? 0,
    cpmRate: r.cpmRate ?? 0,
    cpmBasis: r.cpmBasis === "perVideo" ? "perVideo" : "aggregate",
    cpmCapPerVideo: r.cpmCapPerVideo ?? null,
    viewTiers: r.viewTiers?.length ? JSON.stringify(r.viewTiers) : null,
    bonus: r.bonus ?? 0,
    minViews: r.minViews ?? 0,
    viewWindowDays: r.viewWindowDays ?? null,
    payoutCap: r.payoutCap ?? null,
    starterDays: r.starterDays ?? null,
    starterPerPost: r.starterPerPost ?? null,
    payPerOriginal: r.payPerOriginal === true,
    currency: r.currency || "USD",
  };
}

/** Does the structure actually pay anything? All-zero structures don't earn an auto campaign. */
function paysAnything(r: PayRulesJson | null): r is PayRulesJson {
  if (!r) return false;
  return Boolean(r.baseFee || r.perPost || r.cpmRate || r.viewTiers?.length || r.bonus || r.flatDeal || (r.starterDays && r.starterPerPost));
}

export async function syncAutoCampaign(clientId: string): Promise<void> {
  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) return;
  const rules = parsePayRules(client.defaultPayRules);
  const auto = await prisma.campaign.findFirst({ where: { clientId, isAuto: true } });

  // No meaningful structure: keep an existing auto campaign in sync with the
  // (now empty) rules, but never create one just to compute zeros.
  if (!paysAnything(rules)) {
    if (auto && rules) {
      await prisma.campaign.update({ where: { id: auto.id }, data: campaignDataFromRules(rules) });
    }
    return;
  }

  const campaign = auto
    ? await prisma.campaign.update({ where: { id: auto.id }, data: campaignDataFromRules(rules) })
    : await prisma.campaign.create({
        data: { clientId, name: "General", isAuto: true, status: "active", ...campaignDataFromRules(rules) },
      });

  // Desired membership: every creator of the client without a manual assignment.
  const [creators, manualLinks, existingLinks] = await Promise.all([
    prisma.creator.findMany({ where: { clientId }, select: { id: true, payRules: true } }),
    prisma.campaignCreator.findMany({
      where: { campaign: { clientId, isAuto: false } },
      select: { creatorId: true },
    }),
    prisma.campaignCreator.findMany({ where: { campaignId: campaign.id }, select: { creatorId: true } }),
  ]);
  const manual = new Set(manualLinks.map((l) => l.creatorId));
  const existing = new Set(existingLinks.map((l) => l.creatorId));
  const wanted = new Set(creators.filter((c) => !manual.has(c.id)).map((c) => c.id));

  const toAdd = creators.filter((c) => wanted.has(c.id) && !existing.has(c.id));
  const toRemove = [...existing].filter((id) => !wanted.has(id));

  if (!toAdd.length && !toRemove.length) return;
  await prisma.$transaction([
    ...(toRemove.length
      ? [prisma.campaignCreator.deleteMany({ where: { campaignId: campaign.id, creatorId: { in: toRemove } } })]
      : []),
    ...(toAdd.length
      ? [prisma.campaignCreator.createMany({
          data: toAdd.map((c) => {
            // Individualized clients: the creator's personal deal seeds their
            // overrides, exactly like a manual assignment would.
            const deal = parsePayRules(c.payRules);
            return {
              campaignId: campaign.id,
              creatorId: c.id,
              baseFee: deal?.baseFee ?? null,
              perPost: deal?.perPost ?? null,
              cpmRate: deal?.cpmRate ?? null,
              cpmBasis: deal?.cpmBasis ?? null,
              cpmCapPerVideo: deal?.cpmCapPerVideo ?? null,
              viewTiers: deal?.viewTiers?.length ? JSON.stringify(deal.viewTiers) : null,
              bonus: deal?.bonus ?? null,
              minViews: deal?.minViews ?? null,
              viewWindowDays: deal?.viewWindowDays ?? null,
              payoutCap: deal?.payoutCap ?? null,
              flatDeal: deal?.flatDeal ?? null,
              note: deal ? deal.note ?? "personal deal" : null,
            };
          }),
        })]
      : []),
  ]);
}
