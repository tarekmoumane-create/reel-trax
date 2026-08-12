import { prisma } from "@/lib/db";
import { ok, bad, serverError } from "@/lib/api";

export async function GET() {
  try {
    const clients = await prisma.client.findMany({
      where: { archived: false },
      orderBy: { createdAt: "asc" },
      include: { _count: { select: { creators: true } } },
    });
    return ok(clients);
  } catch (e) {
    return serverError(e);
  }
}

export function hostOf(url: string): string | null {
  try {
    const u = new URL(/:\/\//.test(url) ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Auto-derive a client's logo from their website (Clearbit's logo API). */
export function logoFromWebsite(website: string): string | null {
  const h = hostOf(website);
  return h ? `https://logo.clearbit.com/${h}?size=128` : null;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const name = (body?.name ?? "").trim();
    if (!name) return bad("Client name is required");
    const website = (body?.website ?? "").trim() || null;
    let logoUrl = (body?.logoUrl ?? "").trim() || null;
    if (!logoUrl && website) logoUrl = logoFromWebsite(website);
    const client = await prisma.client.create({
      data: { name, color: body?.color || "#ec5a35", website, logoUrl },
    });
    return ok(client, { status: 201 });
  } catch (e) {
    return serverError(e);
  }
}
