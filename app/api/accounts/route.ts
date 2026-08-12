import { prisma } from "@/lib/db";
import { ok, bad, serverError } from "@/lib/api";
import { computeCadence } from "@/lib/cadence";
import { getTimeZone } from "@/lib/settings";

// One row per social account (a creator can have TikTok and/or Instagram),
// each with its own post-activity strip and totals.
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get("clientId");
    if (!clientId) return bad("clientId is required");
    const tz = await getTimeZone();

    const creators = await prisma.creator.findMany({
      where: { clientId },
      include: { posts: true },
    });

    const now = new Date();
    const rows: unknown[] = [];

    for (const c of creators) {
      const platforms: { platform: "tiktok" | "instagram"; handle: string | null; url: string | null }[] = [];
      if (c.tiktokHandle) platforms.push({ platform: "tiktok", handle: c.tiktokHandle, url: c.tiktokUrl });
      if (c.instagramHandle) platforms.push({ platform: "instagram", handle: c.instagramHandle, url: c.instagramUrl });

      for (const p of platforms) {
        const posts = c.posts.filter((x) => x.platform === p.platform);
        const cadence = computeCadence(posts, { expectedPerWeek: c.expectedPerWeek, now, timeZone: tz, calendarDays: 84 });
        rows.push({
          creatorId: c.id,
          creatorName: c.displayName,
          platform: p.platform,
          handle: p.handle,
          url: p.url,
          postsCount: posts.length,
          viewsSum: posts.reduce((s, x) => s + x.views, 0),
          lastPostAt: cadence.lastPostAt,
          daysSinceLastPost: cadence.daysSinceLastPost,
          status: cadence.status,
          calendar: cadence.calendar,
        });
      }
    }

    // most-recently-active first
    rows.sort((a, b) => (((b as { daysSinceLastPost: number | null }).daysSinceLastPost ?? 9999) < ((a as { daysSinceLastPost: number | null }).daysSinceLastPost ?? 9999) ? 1 : -1));

    return ok({ rows, timeZone: tz });
  } catch (e) {
    return serverError(e);
  }
}
