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

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const name = (body?.name ?? "").trim();
    if (!name) return bad("Client name is required");
    const client = await prisma.client.create({
      data: { name, color: body?.color || "#6366f1" },
    });
    return ok(client, { status: 201 });
  } catch (e) {
    return serverError(e);
  }
}
