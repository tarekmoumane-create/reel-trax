import { prisma } from "@/lib/db";
import { ok, serverError } from "@/lib/api";
import { logoFromWebsite } from "@/lib/brand";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const data: Record<string, unknown> = {};
    if (typeof body.name === "string") data.name = body.name.trim();
    if (typeof body.color === "string") data.color = body.color;
    if (typeof body.archived === "boolean") data.archived = body.archived;
    if ("website" in body) {
      const website = (body.website ?? "").trim() || null;
      data.website = website;
      // re-derive the logo when the site changes and no explicit logo was given
      if (!("logoUrl" in body) && website) data.logoUrl = logoFromWebsite(website);
    }
    if ("logoUrl" in body) data.logoUrl = (body.logoUrl ?? "").trim() || null;
    const client = await prisma.client.update({ where: { id }, data });
    return ok(client);
  } catch (e) {
    return serverError(e);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await prisma.client.delete({ where: { id } });
    return ok({ deleted: true });
  } catch (e) {
    return serverError(e);
  }
}
