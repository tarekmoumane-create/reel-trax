import { prisma } from "@/lib/db";
import { ok, bad, serverError } from "@/lib/api";

// Replace the campaign's creator assignments with the provided set.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const b = await request.json();
    const creatorIds: string[] = Array.isArray(b?.creatorIds) ? b.creatorIds : [];

    const campaign = await prisma.campaign.findUnique({ where: { id } });
    if (!campaign) return bad("Campaign not found", 404);

    // keep only creators that belong to this campaign's client
    const valid = await prisma.creator.findMany({
      where: { id: { in: creatorIds }, clientId: campaign.clientId },
      select: { id: true },
    });
    const validIds = valid.map((v) => v.id);

    await prisma.$transaction([
      prisma.campaignCreator.deleteMany({ where: { campaignId: id } }),
      ...(validIds.length
        ? [prisma.campaignCreator.createMany({ data: validIds.map((creatorId) => ({ campaignId: id, creatorId })) })]
        : []),
    ]);

    return ok({ assigned: validIds.length });
  } catch (e) {
    return serverError(e);
  }
}
