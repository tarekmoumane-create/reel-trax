import { prisma } from "@/lib/db";
import { ok, bad, serverError } from "@/lib/api";
import { parsePayExclusions } from "@/lib/payouts";

const DAY = 86_400_000;
// How far either side of a video to look for a copy of it. Wider than the
// auto-matcher's window on purpose: this list exists for the cases it missed.
const CANDIDATE_DAYS = 7;

/**
 * The cross-post group this video is in, plus the posts it could plausibly be
 * linked to — what the "same video as…" picker needs to correct a bad match.
 */
export async function GET(_r: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const post = await prisma.post.findUnique({
      where: { id },
      select: { id: true, creatorId: true, platform: true, postedAt: true, groupKey: true, groupPinned: true },
    });
    if (!post) return bad("Video not found", 404);

    const near = await prisma.post.findMany({
      where: {
        creatorId: post.creatorId,
        postedAt: {
          gte: new Date(post.postedAt.getTime() - CANDIDATE_DAYS * DAY),
          lte: new Date(post.postedAt.getTime() + CANDIDATE_DAYS * DAY),
        },
      },
      select: { id: true, platform: true, url: true, caption: true, thumbnailUrl: true, postedAt: true, views: true, groupKey: true },
      orderBy: { postedAt: "asc" },
    });

    const members = post.groupKey
      ? await prisma.post.findMany({
          where: { groupKey: post.groupKey },
          select: { id: true, platform: true, url: true, postedAt: true, views: true, groupPinned: true },
          orderBy: { postedAt: "asc" },
        })
      : [];

    return ok({
      id: post.id,
      groupKey: post.groupKey,
      groupPinned: post.groupPinned,
      members,
      // Already in this video's group, or on a platform the group has covered,
      // so linking them would claim one original was posted twice to one app.
      candidates: near
        .filter((p) => p.id !== post.id && (!post.groupKey || p.groupKey !== post.groupKey))
        .map((p) => ({
          id: p.id, platform: p.platform, url: p.url, caption: p.caption, thumbnailUrl: p.thumbnailUrl,
          postedAt: p.postedAt, views: p.views, grouped: p.groupKey != null,
        })),
    });
  } catch (e) {
    return serverError(e);
  }
}

// Per-video pay settings: which components it counts toward, whether it's a
// warm-up post, and an optional hand-set price. Any subset may be sent.
// Also the cross-post group, which is a judgement call the auto-matcher can
// get wrong: `groupWith` merges this video into another one's group and
// `ungroup: true` splits it back out. Either way both ends are pinned, so the
// next sync takes the correction as given instead of re-deciding.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const data: { payExclusions?: string | null; isWarmUp?: boolean; payOverride?: number | null } = {};

    if ("payExclusions" in body) {
      let list = parsePayExclusions(JSON.stringify(body.payExclusions ?? []));
      // "all" makes the finer-grained flags moot — store it alone.
      if (list.includes("all")) list = ["all"];
      data.payExclusions = list.length ? JSON.stringify(list) : null;
    }
    if ("isWarmUp" in body) data.isWarmUp = body.isWarmUp === true;
    if ("payOverride" in body) {
      if (body.payOverride === null || body.payOverride === "") data.payOverride = null;
      else {
        const n = Number(body.payOverride);
        if (!Number.isFinite(n) || n < 0) return bad("payOverride must be a non-negative number");
        data.payOverride = Math.round(n * 100) / 100;
      }
    }

    const grouping = "groupWith" in body || "ungroup" in body;
    if (Object.keys(data).length === 0 && !grouping) return bad("Nothing to update");
    if (Object.keys(data).length) await prisma.post.update({ where: { id }, data });

    if (body.ungroup === true) {
      await prisma.post.update({ where: { id }, data: { groupKey: null, groupPinned: true } });
    } else if (body.groupWith) {
      const [me, other] = await Promise.all([
        prisma.post.findUnique({ where: { id }, select: { id: true, creatorId: true, platform: true, groupKey: true } }),
        prisma.post.findUnique({ where: { id: String(body.groupWith) }, select: { id: true, creatorId: true, platform: true, groupKey: true } }),
      ]);
      if (!me || !other) return bad("Video not found", 404);
      if (me.creatorId !== other.creatorId) return bad("Only one creator's own posts can be the same video");

      // Merging carries each side's existing copies along, so the platform
      // check has to cover both whole groups: one original is one post per
      // platform, and anything else is two different videos.
      const sideOf = async (p: { id: string; platform: string; groupKey: string | null }) =>
        p.groupKey
          ? prisma.post.findMany({ where: { groupKey: p.groupKey }, select: { id: true, platform: true } })
          : [{ id: p.id, platform: p.platform }];
      const [mine, theirs] = await Promise.all([sideOf(me), sideOf(other)]);
      const clash = theirs.find((t) => mine.some((m) => m.platform === t.platform));
      if (clash) return bad(`Both videos already have a ${clash.platform} post — one original can't be posted twice to one platform.`);

      // Keep whichever side already has a group so its other members come
      // along; otherwise open a new one named after the video being linked to.
      const key = other.groupKey ?? me.groupKey ?? `grp_${other.id}`;
      const moving = [...mine.map((m) => m.id), ...theirs.map((t) => t.id)];
      await prisma.post.updateMany({
        where: { id: { in: [...new Set(moving)] } },
        data: { groupKey: key, groupPinned: true },
      });
    }

    const post = await prisma.post.findUnique({ where: { id } });
    if (!post) return bad("Video not found", 404);
    return ok({
      id: post.id,
      payExclusions: parsePayExclusions(post.payExclusions),
      isWarmUp: post.isWarmUp,
      payOverride: post.payOverride,
      groupKey: post.groupKey,
      groupPinned: post.groupPinned,
    });
  } catch (e) {
    return serverError(e);
  }
}
