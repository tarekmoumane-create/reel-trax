import { prisma } from "@/lib/db";
import { ok, bad, serverError } from "@/lib/api";
import { isDeadLogoUrl, logoFromWebsite } from "@/lib/brand";
import { sanitizePayRules } from "@/lib/payouts";

export async function GET() {
  try {
    const clients = await prisma.client.findMany({
      where: { archived: false },
      orderBy: { createdAt: "asc" },
      include: { _count: { select: { creators: true } } },
    });

    // Heal rows still pointing at the retired Clearbit logo API, so existing
    // clients get their logo back without anyone re-saving them by hand.
    const stale = clients.filter((c) => isDeadLogoUrl(c.logoUrl));
    if (stale.length) {
      await Promise.all(
        stale.map((c) => {
          const logoUrl = c.website ? logoFromWebsite(c.website) : null;
          c.logoUrl = logoUrl;
          return prisma.client.update({ where: { id: c.id }, data: { logoUrl } });
        })
      );
    }

    return ok(clients);
  } catch (e) {
    return serverError(e);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const name = (body?.name ?? "").trim();
    if (!name) return bad("Client name is required");
    const website = (body?.website ?? "").trim() || null;
    let logoUrl = (body?.logoUrl ?? "").trim() || null;
    if (!logoUrl && website) logoUrl = logoFromWebsite(website);
    const defaultPayRules = sanitizePayRules(body?.defaultPayRules);
    const client = await prisma.client.create({
      data: {
        name,
        color: body?.color || "#ec5a35",
        website,
        logoUrl,
        payMode: body?.payMode === "individual" ? "individual" : "uniform",
        defaultPayRules: defaultPayRules ? JSON.stringify(defaultPayRules) : null,
      },
    });
    return ok(client, { status: 201 });
  } catch (e) {
    return serverError(e);
  }
}
