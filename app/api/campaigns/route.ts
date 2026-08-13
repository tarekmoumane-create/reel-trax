import { prisma } from "@/lib/db";
import { ok, bad, serverError } from "@/lib/api";
import { parseViewTiers } from "@/lib/payouts";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get("clientId");
    if (!clientId) return bad("clientId is required");
    const campaigns = await prisma.campaign.findMany({
      where: { clientId },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { assignments: true } } },
    });
    return ok(campaigns);
  } catch (e) {
    return serverError(e);
  }
}

const NUM = (v: unknown, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

export async function POST(request: Request) {
  try {
    const b = await request.json();
    const clientId = (b?.clientId ?? "").trim();
    const name = (b?.name ?? "").trim();
    if (!clientId) return bad("clientId is required");
    if (!name) return bad("Campaign name is required");

    const campaign = await prisma.campaign.create({
      data: {
        clientId,
        name,
        status: b.status || "active",
        period: b.period === "weekly" ? "weekly" : "monthly",
        targetVideos: b.targetVideos != null && b.targetVideos !== "" ? NUM(b.targetVideos) : null,
        startDate: b.startDate ? new Date(b.startDate) : null,
        endDate: b.endDate ? new Date(b.endDate) : null,
        baseFee: NUM(b.baseFee),
        perPost: NUM(b.perPost),
        cpmRate: NUM(b.cpmRate),
        cpmBasis: b.cpmBasis === "perVideo" ? "perVideo" : "aggregate",
        cpmCapPerVideo: b.cpmCapPerVideo != null && b.cpmCapPerVideo !== "" ? NUM(b.cpmCapPerVideo) : null,
        viewTiers: (() => {
          const tiers = parseViewTiers(JSON.stringify(b.viewTiers ?? null));
          return tiers.length ? JSON.stringify(tiers) : null;
        })(),
        bonus: NUM(b.bonus),
        minViews: NUM(b.minViews),
        payoutCap: b.payoutCap != null && b.payoutCap !== "" ? NUM(b.payoutCap) : null,
        currency: b.currency || "USD",
      },
    });
    return ok(campaign, { status: 201 });
  } catch (e) {
    return serverError(e);
  }
}
