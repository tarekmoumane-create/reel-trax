import { prisma } from "@/lib/db";
import { ok, bad, serverError } from "@/lib/api";
import { computeCadence, type CadenceStatus } from "@/lib/cadence";
import { getTimeZone } from "@/lib/settings";
import { avgEngagement } from "@/lib/engagement";
import { detectShadowBans } from "@/lib/shadowban";
import { cadenceNow, trackingEnded } from "@/lib/tracking";

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
      include: { posts: { select: { platform: true, postedAt: true, views: true, likes: true, comments: true, shares: true }, orderBy: { postedAt: "desc" } } },
    });

    const realNow = new Date();
    const rows = creators.map((c) => {
      // A creator past their tracking cutoff is read as of their last day
      // with the client, so they don't sit on the roster as "gone quiet".
      const ended = trackingEnded(c.trackUntil, realNow, tz);
      const now = cadenceNow(c.trackUntil, realNow, tz);
      const cadence = computeCadence(c.posts, {
        expectedPerWeek: c.expectedPerWeek,
        now,
        timeZone: tz,
        calendarDays: 84,
      });
      const cutoff30 = now.getTime() - 30 * 86_400_000;
      const viewsTotal = c.posts.reduce((s, p) => s + p.views, 0);
      const views30d = c.posts.reduce(
        (s, p) => (p.postedAt.getTime() >= cutoff30 ? s + p.views : s),
        0
      );
      const engagementTotal = avgEngagement(c.posts);
      const engagement30d = avgEngagement(c.posts.filter((p) => p.postedAt.getTime() >= cutoff30));
      const shadowBans = detectShadowBans(c.posts, { now, timeZone: tz });
      return {
        id: c.id,
        displayName: c.displayName,
        avatarUrl: c.avatarUrl,
        status: c.status,
        source: c.source,
        tiktokHandle: c.tiktokHandle,
        instagramHandle: c.instagramHandle,
        youtubeHandle: c.youtubeHandle,
        threadsHandle: c.threadsHandle,
        facebookHandle: c.facebookHandle,
        snapchatHandle: c.snapchatHandle,
        trackUntil: c.trackUntil,
        ended,
        expectedPerWeek: c.expectedPerWeek,
        lastSyncedAt: c.lastSyncedAt,
        lastSyncStatus: c.lastSyncStatus,
        preferredChannel: c.preferredChannel,
        // everything ContactButton needs to open the right app from the roster
        phone: c.phone,
        contactHandle: c.contactHandle,
        email: c.email,
        discord: c.discord,
        discordChannel: c.discordChannel,
        whatsapp: c.whatsapp,
        sideshiftUrl: c.sideshiftUrl,
        createdAt: c.createdAt,
        viewsTotal,
        views30d,
        engagementTotal,
        engagement30d,
        cadence,
        shadowBans,
      };
    });

    // active first (finished creators count as inactive here), then by
    // cadence severity, then most-overdue
    rows.sort((a, b) => {
      const aActive = a.status === "active" && !a.ended ? 0 : 1;
      const bActive = b.status === "active" && !b.ended ? 0 : 1;
      if (aActive !== bActive) return aActive - bActive;
      const r = STATUS_RANK[a.cadence.status] - STATUS_RANK[b.cadence.status];
      if (r !== 0) return r;
      return (b.cadence.daysSinceLastPost ?? -1) - (a.cadence.daysSinceLastPost ?? -1);
    });

    // Cadence tallies cover creators still being tracked — someone who
    // finished last month isn't "on track" or "behind" today.
    const live = rows.filter((r) => !r.ended);
    const summary = {
      total: rows.length,
      ended: rows.length - live.length,
      onTrack: live.filter((r) => r.cadence.status === "on_track").length,
      behind: live.filter((r) => r.cadence.status === "behind").length,
      quiet: live.filter((r) => r.cadence.status === "quiet").length,
      noData: live.filter((r) => r.cadence.status === "no_data").length,
      shadowBanned: live.filter((r) => r.shadowBans.length > 0).length,
    };

    return ok({ summary, rows, timeZone: tz });
  } catch (e) {
    return serverError(e);
  }
}
