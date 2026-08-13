import { PrismaClient } from "@prisma/client";

function createClient() {
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    // Stored profile pictures are binary and only ever wanted by the route that
    // serves them (which asks for them explicitly with `select`). Omitting them
    // globally keeps every other query — and every JSON response — small.
    omit: { creator: { avatarData: true } },
  });
}

// Reuse the client across hot-reloads / serverless invocations.
const globalForPrisma = globalThis as unknown as {
  prisma?: ReturnType<typeof createClient>;
};

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
