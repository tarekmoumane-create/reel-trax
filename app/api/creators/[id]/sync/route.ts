import { prisma } from "@/lib/db";
import { ok, bad, serverError } from "@/lib/api";
import { getScrapeCreatorsKey } from "@/lib/settings";
import { syncCreator } from "@/lib/sync";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const apiKey = await getScrapeCreatorsKey();
    if (!apiKey)
      return bad("No ScrapeCreators API key set. Add it in Settings.", 400);
    const creator = await prisma.creator.findUnique({ where: { id } });
    if (!creator) return bad("Creator not found", 404);
    const result = await syncCreator(creator, apiKey);
    return ok(result);
  } catch (e) {
    return serverError(e);
  }
}
