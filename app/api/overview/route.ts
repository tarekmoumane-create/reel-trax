import { prisma } from "@/lib/db";
import { ok, bad, serverError } from "@/lib/api";
import { computeCadence, type CadenceStatus } from "@/lib/cadence";
import { getTimeZone } from "@/lib/settings";

// Ordering so the people you need to chase surface first.
const STATUS_RANK: Record<CadenceStatus, number> = {
  quiet: 0,
  behind: 1,
  no_data: 2,
  on_track: 3,
};

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get("clientId");
    if (!clientId) return bad("clientId is required");

    const tz = await getTimeZone();
    const creators = await prisma.creator.findMany({
      where: { clientId },
      include: { posts: { select: { postedAt: true, views: true }, orderBy: { postedAt: "desc" } } },
    });

    const now = new Date();
    const rows = creators.map((c) => {
      const cadence = computeCadence(c.posts, {
        expectedPerWeek: c.expectedPerWeek,
        now,
        timeZone: tz,
        calendarDays: 84,
      });
      const needsFollowUp =
        !!c.followUpAt && new Date(c.followUpAt).getTime() <= now.getTime();
      const cutoff30 = now.getTime() - 30 * 86_400_000;
      const viewsTotal = c.posts.reduce((s, p) => s + p.views, 0);
      const views30d = c.posts.reduce(
        (s, p) => (p.postedAt.getTime() >= cutoff30 ? s + p.views : s),
        0
      );
      return {
        id: c.id,
        displayName: c.displayName,
        avatarUrl: c.avatarUrl,
        status: c.status,
        source: c.source,
        tiktokHandle: c.tiktokHandle,
        instagramHandle: c.instagramHandle,
        expectedPerWeek: c.expectedPerWeek,
        lastContactedAt: c.lastContactedAt,
        followUpAt: c.followUpAt,
        needsFollowUp,
        lastSyncedAt: c.lastSyncedAt,
        lastSyncStatus: c.lastSyncStatus,
        preferredChannel: c.preferredChannel,
        // everything ContactButton needs to open the right app from the roster
        phone: c.phone,
        contactHandle: c.contactHandle,
        email: c.email,
        discord: c.discord,
        whatsapp: c.whatsapp,
        sideshiftUrl: c.sideshiftUrl,
        createdAt: c.createdAt,
        viewsTotal,
        views30d,
        cadence,
      };
    });

    // active first, then by cadence severity, then most-overdue
    rows.sort((a, b) => {
      const aActive = a.status === "active" ? 0 : 1;
      const bActive = b.status === "active" ? 0 : 1;
      if (aActive !== bActive) return aActive - bActive;
      const r = STATUS_RANK[a.cadence.status] - STATUS_RANK[b.cadence.status];
      if (r !== 0) return r;
      return (b.cadence.daysSinceLastPost ?? -1) - (a.cadence.daysSinceLastPost ?? -1);
    });

    const summary = {
      total: rows.length,
      onTrack: rows.filter((r) => r.cadence.status === "on_track").length,
      behind: rows.filter((r) => r.cadence.status === "behind").length,
      quiet: rows.filter((r) => r.cadence.status === "quiet").length,
      noData: rows.filter((r) => r.cadence.status === "no_data").length,
      needFollowUp: rows.filter((r) => r.needsFollowUp).length,
    };

    return ok({ summary, rows, timeZone: tz });
  } catch (e) {
    return serverError(e);
  }
}
