"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CreatorDetailResponse, CreatorDTO, PostDTO } from "@/lib/types";
import { PostActivity } from "@/components/PostActivity";
import { Chart } from "@/components/Chart";
import { StatusBadge } from "@/components/StatusBadge";
import { ShadowBanBadge, describeShadowBans } from "@/components/ShadowBanBadge";
import { ContactButton } from "@/components/ContactButton";
import { VideoThumb } from "@/components/VideoThumb";
import { Avatar } from "@/components/Avatar";
import { TopBar } from "@/components/PageHeader";
import { SOURCE_LABEL, daysLabel, fmtNum, timeAgo } from "@/lib/ui";
import { avgEngagement, engagementRate, fmtPct } from "@/lib/engagement";
import { PAYMENT_METHODS, PAYMENT_LABEL, payLink } from "@/lib/pay";
import { Select } from "@/components/Select";
import { RangePicker, PRESETS, dstr, fmtRangeDate, type Range } from "@/components/RangePicker";
import { VideoPayMenu, type VideoPayPatch } from "@/components/VideoPayMenu";
import { CrossPostMenu } from "@/components/CrossPostMenu";
import { parsePayExclusions } from "@/lib/payouts";

export default function CreatorDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<CreatorDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  // One date range for the whole page: the chart and the posts list read it,
  // and either one's picker sets it. null = all time.
  const [range, setRange] = useState<Range | null>(() => PRESETS[4].range()); // last 30 days

  const load = useCallback(async () => {
    const res = await fetch(`/api/creators/${id}`);
    if (res.ok) setData(await res.json());
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    await fetch(`/api/creators/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    await load();
    setBusy(false);
  }
  async function resync() {
    setBusy(true);
    await fetch(`/api/creators/${id}/sync`, { method: "POST" });
    await load();
    setBusy(false);
  }
  async function remove() {
    if (!confirm("Delete this creator and all tracked posts?")) return;
    await fetch(`/api/creators/${id}`, { method: "DELETE" });
    router.push("/creators");
  }
  async function savePostPay(postId: string, patch: VideoPayPatch) {
    // optimistic — the menu updates instantly, the PATCH lands behind it
    setData((d) => {
      if (!d?.creator.posts) return d;
      const posts = d.creator.posts.map((p) => {
        if (p.id !== postId) return p;
        const next = { ...p };
        if (patch.payExclusions) next.payExclusions = patch.payExclusions.length ? JSON.stringify(patch.payExclusions) : null;
        if ("isWarmUp" in patch) next.isWarmUp = !!patch.isWarmUp;
        if ("payOverride" in patch) next.payOverride = patch.payOverride ?? null;
        return next;
      });
      return { ...d, creator: { ...d.creator, posts } };
    });
    await fetch(`/api/videos/${postId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
  }

  if (loading) return <><TopBar crumbs={["Creator Hub", "Creators", "…"]} /><div className="py-16 text-center text-sm text-[var(--muted)]">Loading…</div></>;
  if (!data) return <><TopBar crumbs={["Creator Hub", "Creators"]} /><div className="py-16 text-center text-sm text-[var(--muted)]">Not found. <Link href="/creators" className="text-[var(--signal)]">Back</Link></div></>;

  const { creator, cadence } = data;
  const posts = creator.posts ?? [];

  return (
    <>
      <TopBar
        crumbs={["Creator Hub", "Creators", creator.displayName]}
        right={
          <>
            {payLink(creator) && (
              <a href={payLink(creator)!.href} target="_blank" rel="noreferrer" className="btn" title={`Pay via ${payLink(creator)!.label}`}>
                Pay · {payLink(creator)!.label}
              </a>
            )}
            <ContactButton creator={creator} />
            <button onClick={resync} disabled={busy} className="btn disabled:opacity-60">{busy ? "…" : "Resync"}</button>
            <button onClick={() => setEditing((e) => !e)} className="btn">{editing ? "Close" : "Edit"}</button>
          </>
        }
      />

      <div className="px-6 py-6">
        {/* header */}
        <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <Avatar name={creator.displayName} creatorId={creator.id} size={56} rounded="16px" />

            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="font-display text-2xl font-bold">{creator.displayName}</h1>
                <StatusBadge status={cadence.status} />
                <ShadowBanBadge flags={data.shadowBans} />
              </div>
              <div className="mono mt-1 flex flex-wrap items-center gap-x-3 text-[13px] text-[var(--muted)]">
                {creator.tiktokUrl && <a href={creator.tiktokUrl} target="_blank" rel="noreferrer" className="hover:text-[var(--signal)]">TT @{creator.tiktokHandle}</a>}
                {creator.instagramUrl && <a href={creator.instagramUrl} target="_blank" rel="noreferrer" className="hover:text-[var(--signal)]">IG @{creator.instagramHandle}</a>}
                {creator.youtubeUrl && <a href={creator.youtubeUrl} target="_blank" rel="noreferrer" className="hover:text-[var(--signal)]">YT {creator.youtubeHandle ? `@${creator.youtubeHandle}` : "channel"}</a>}
                {creator.threadsHandle && <a href={creator.threadsUrl ?? `https://www.threads.com/@${creator.threadsHandle}`} target="_blank" rel="noreferrer" className="hover:text-[var(--signal)]">TH @{creator.threadsHandle}</a>}
                {creator.facebookUrl && <a href={creator.facebookUrl} target="_blank" rel="noreferrer" className="hover:text-[var(--signal)]">FB {creator.facebookHandle ?? "page"}</a>}
                <span className="rounded bg-[var(--panel2)] px-1.5 py-0.5 text-[11.5px]">from {SOURCE_LABEL[creator.source] ?? creator.source}{creator.sourceDetail ? ` · ${creator.sourceDetail}` : ""}</span>
                <span className="rounded bg-[color:rgba(124,92,255,0.15)] px-1.5 py-0.5 text-[11.5px] text-[var(--signal)]">pay via {PAYMENT_LABEL[creator.paymentMethod] ?? creator.paymentMethod}</span>
                {creator.onboardedAt && (
                  <span className="rounded bg-[var(--panel2)] px-1.5 py-0.5 text-[11.5px]">
                    onboarded {new Date(creator.onboardedAt).toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" })}
                  </span>
                )}
                {posts.length > 0 && (
                  <span className="rounded bg-[var(--panel2)] px-1.5 py-0.5 text-[11.5px]">
                    first post {new Date(posts[posts.length - 1].postedAt).toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" })}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {data.shadowBans.length > 0 && (
          <div className="mb-4 rounded-xl border border-[color:rgba(242,104,95,0.4)] bg-[color:rgba(242,104,95,0.08)] px-3.5 py-2.5 text-sm">
            <span className="font-medium text-[var(--bad)]">Looks shadow banned.</span>{" "}
            <span className="text-[var(--muted)]">{describeShadowBans(data.shadowBans)}. Worth checking the account from a logged-out browser.</span>
          </div>
        )}

        {editing && <EditPanel creator={creator} onSave={patch} onDelete={remove} busy={busy} />}

        {/* KPI cards */}
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
          <Kpi icon="clock" label="Last post" value={daysLabel(cadence.daysSinceLastPost)} />
          <Kpi icon="fire" label="Streak" value={cadence.currentStreakDays > 0 ? `${cadence.currentStreakDays}d` : "—"} />
          <Kpi icon="grid" label="Posts · 7d" value={`${cadence.postsLast7d}`} />
          <Kpi icon="grid" label="Posts · 30d" value={`${cadence.postsLast30d}`} />
          <Kpi icon="bolt" label="Eng. rate · 30d" value={fmtPct(data.engagement30d)} title="Likes + comments + shares, divided by views, across their videos from the last 30 days" />
          <Kpi icon="target" label="Target / wk" value={`${cadence.expectedPerWeek}`} />
          <Kpi icon="gauge" label="Pace" value={`${Math.round(cadence.pace7d * 100)}%`} tone={cadence.pace7d >= 1 ? "var(--ok)" : "var(--warn)"} />
        </div>

        {/* activity strip */}
        <div className="card mb-4 p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Post activity <span className="text-[var(--muted)]">· last 30 days</span></h2>
            <span className="mono text-[12.5px] text-[var(--faint)]">
              synced {timeAgo(creator.lastSyncedAt)}{creator.lastSyncStatus && creator.lastSyncStatus !== "ok" ? ` · ${creator.lastSyncStatus}` : ""}
            </span>
          </div>
          <div className="overflow-x-auto">
            <PostActivity calendar={cadence.calendar} days={30} dot={18} gap={7} />
          </div>
          {creator.lastSyncError && <p className="mt-3 rounded-lg bg-[color:rgba(242,104,95,0.1)] px-3 py-2 text-xs text-[var(--bad)]">Last sync issue: {creator.lastSyncError}</p>}
        </div>

        {/* trend */}
        {posts.length > 0 && <CreatorTrendCard posts={posts} range={range} onRange={setRange} />}

        <div className="card p-5">
          <PostsPanel posts={posts} range={range} onRange={setRange} onPay={savePostPay} onGrouped={load} />
        </div>
      </div>
    </>
  );
}

const KPI_ICONS: Record<string, React.ReactNode> = {
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  fire: <path d="M12 3s5 4 5 9a5 5 0 0 1-10 0c0-2 1-3 1-3s0 2 2 2c2 0 1-4 2-6z" />,
  grid: <path d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z" />,
  target: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4" /></>,
  gauge: <><path d="M12 13l4-4" /><path d="M4 18a8 8 0 1 1 16 0" /></>,
  bolt: <path d="M13 3L5 14h6l-1 7 8-11h-6z" />,
};

function Kpi({ icon, label, value, tone, title }: { icon: string; label: string; value: string; tone?: string; title?: string }) {
  return (
    <div className="card p-3.5" title={title}>
      <div className="mb-2 flex items-center gap-2 whitespace-nowrap text-[12.5px] text-[var(--muted)]">
        <span className="tile-ico h-6 w-6">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{KPI_ICONS[icon]}</svg>
        </span>
        {label}
      </div>
      <div className="mono text-lg font-bold" style={{ color: tone }}>{value}</div>
    </div>
  );
}

type PostSortKey = "newest" | "oldest" | "views" | "likes" | "comments" | "shares" | "engagement";

const POST_SORT_OPTIONS: [PostSortKey, string][] = [
  ["newest", "Newest first"],
  ["oldest", "Oldest first"],
  ["views", "Most views"],
  ["likes", "Most likes"],
  ["comments", "Most comments"],
  ["shares", "Most shares"],
  ["engagement", "Best engagement"],
];

const PLATFORM_LABEL: Record<string, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  youtube: "YouTube",
  threads: "Threads",
  facebook: "Facebook",
};

const postedMs = (p: PostDTO) => new Date(p.postedAt).getTime();

const POST_SORTS: Record<PostSortKey, (a: PostDTO, b: PostDTO) => number> = {
  newest: (a, b) => postedMs(b) - postedMs(a),
  oldest: (a, b) => postedMs(a) - postedMs(b),
  views: (a, b) => b.views - a.views,
  likes: (a, b) => b.likes - a.likes,
  comments: (a, b) => b.comments - a.comments,
  shares: (a, b) => b.shares - a.shares,
  // reactions per view, so a small post that punched above its weight can
  // outrank a big one. No views yet, no rate — those go last.
  engagement: (a, b) => (engagementRate(b) ?? -1) - (engagementRate(a) ?? -1),
};

const POST_SORT_LS_KEY = "rt.creatorPostsSort";
const PAGE = 60;

function PostsPanel({ posts, range, onRange, onPay, onGrouped }: {
  posts: PostDTO[];
  range: Range | null;
  onRange: (r: Range | null) => void;
  onPay: (postId: string, patch: VideoPayPatch) => void;
  onGrouped: () => void;
}) {
  const [sort, setSort] = useState<PostSortKey>("newest");
  const [platform, setPlatform] = useState("");
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(POST_SORT_LS_KEY) as PostSortKey | null;
    if (saved && POST_SORT_OPTIONS.some(([k]) => k === saved)) setSort(saved);
  }, []);

  // only offer the platform filter when this creator actually posts on more than one
  const platforms = useMemo(() => [...new Set(posts.map((p) => p.platform))].sort(), [posts]);

  // This panel holds the creator's whole history, so group sizes can be counted
  // here rather than fetched — the platform filter must not shrink them.
  const groupSizes = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of posts) if (p.groupKey) m.set(p.groupKey, (m.get(p.groupKey) ?? 0) + 1);
    return m;
  }, [posts]);

  const rows = useMemo(() => {
    const filtered = posts.filter((p) => {
      if (platform && p.platform !== platform) return false;
      if (!range) return true;
      const day = dstr(new Date(p.postedAt));
      return day >= range.from && day <= range.to;
    });
    return [...filtered].sort(POST_SORTS[sort]);
  }, [posts, platform, sort, range]);

  const visible = showAll ? rows : rows.slice(0, PAGE);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">
          Posts <span className="text-[var(--muted)]">({rows.length}{rows.length !== posts.length ? ` of ${posts.length}` : ""})</span>
          <span className="ml-1.5 text-[12.5px] font-normal text-[var(--faint)]">{range ? range.label : "All time"}</span>
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <RangePicker
            range={range ?? { ...PRESETS[4].range(), label: "All time" }}
            onChange={(r) => onRange(r)}
            onAllTime={() => onRange(null)}
            allTimeActive={!range}
          />
          {platforms.length > 1 && (
            <Select
              size="sm"
              align="right"
              value={platform}
              onChange={setPlatform}
              options={[["", "All platforms"] as [string, string], ...platforms.map((p) => [p, PLATFORM_LABEL[p] ?? p] as [string, string])]}
            />
          )}
          <Select
            size="sm"
            align="right"
            value={sort}
            onChange={(v) => {
              setSort(v as PostSortKey);
              localStorage.setItem(POST_SORT_LS_KEY, v);
            }}
            options={POST_SORT_OPTIONS as [string, string][]}
          />
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-[var(--muted)]">
          {posts.length === 0
            ? "No posts tracked yet. They’ll appear after the next sync."
            : `No posts ${platform ? "on this platform " : ""}in ${range ? range.label.toLowerCase() : "this range"}.`}
        </p>
      ) : (
        <>
          <div className="max-h-[420px] space-y-1 overflow-y-auto pr-1">
            {visible.map((p) => (
              <PostRow key={p.id} post={p} sort={sort} groupSize={groupSizes.get(p.groupKey ?? "") ?? 1} onPay={(patch) => onPay(p.id, patch)} onGrouped={onGrouped} />
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between gap-3 text-[12.5px] text-[var(--faint)]">
            <span>
              {showAll || rows.length <= PAGE ? `Showing all ${rows.length}` : `Showing top ${PAGE} of ${rows.length}`}
              {" · "}Pay column: mark warm-ups or set a fixed price per video
            </span>
            {rows.length > PAGE && (
              <button onClick={() => setShowAll((s) => !s)} className="shrink-0 text-[var(--signal)] hover:underline">
                {showAll ? `Show top ${PAGE}` : `Show all ${rows.length}`}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function PostRow({ post, sort, groupSize, onPay, onGrouped }: { post: PostDTO; sort: PostSortKey; groupSize: number; onPay: (patch: VideoPayPatch) => void; onGrouped: () => void }) {
  const dt = new Date(post.postedAt);
  const hot = (k: PostSortKey) => (sort === k ? "font-semibold text-[var(--signal)]" : "");
  const stat = "mono w-[64px] shrink-0 whitespace-nowrap text-[13px]";

  return (
    <div className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-[var(--panel2)]">
      <VideoThumb url={post.url} thumbnailUrl={post.thumbnailUrl} platform={post.platform} w={32} h={44} />
      {/* caption on top, every stat underneath — fixed widths so the numbers
          still line up down the list; they wrap rather than clip when narrow */}
      <div className="min-w-0 flex-1">
        <a href={post.url ?? "#"} target="_blank" rel="noreferrer" className="block truncate text-sm hover:text-[var(--signal)]">
          {post.caption || <span className="text-[var(--faint)]">(no caption)</span>}
        </a>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className={`mono w-[76px] shrink-0 whitespace-nowrap text-[13px] ${hot(sort === "oldest" ? "oldest" : "newest")}`}>
            {dt.toLocaleDateString("en", { month: "short", day: "numeric", year: "2-digit" })}
          </span>
          <span className={`${stat} ${hot("views")}`} title="Views">▶ {fmtNum(post.views)}</span>
          <span className={`${stat} ${hot("likes")}`} title="Likes">♥ {fmtNum(post.likes)}</span>
          <span className={`${stat} ${hot("comments")}`} title="Comments">≡ {fmtNum(post.comments)}</span>
          <span className={`${stat} ${hot("shares")}`} title="Shares">↻ {fmtNum(post.shares)}</span>
          <span className={`mono shrink-0 whitespace-nowrap text-[13px] ${hot("engagement") || "font-medium"}`} title="Engagement rate: likes + comments + shares, divided by views">
            {fmtPct(engagementRate(post))} <span className="font-normal text-[var(--muted)]">eng.</span>
          </span>
        </div>
      </div>
      {post.source === "manual" && <span className="rounded bg-[var(--panel2)] px-1.5 py-0.5 text-[11px] text-[var(--faint)]">manual</span>}
      <div className="w-[104px] shrink-0">
        <CrossPostMenu
          postId={post.id}
          platform={post.platform}
          groupSize={groupSize}
          groupPinned={post.groupPinned}
          onChanged={onGrouped}
        />
      </div>
      <div className="w-[108px] shrink-0">
        <VideoPayMenu
          value={{ exclusions: parsePayExclusions(post.payExclusions), isWarmUp: post.isWarmUp, payOverride: post.payOverride }}
          onChange={onPay}
        />
      </div>
    </div>
  );
}

function EditPanel({ creator, onSave, onDelete, busy }: { creator: CreatorDTO; onSave: (b: Record<string, unknown>) => Promise<void>; onDelete: () => void; busy: boolean }) {
  const [f, setF] = useState({
    displayName: creator.displayName, tiktokUrl: creator.tiktokUrl ?? "", instagramUrl: creator.instagramUrl ?? "", youtubeUrl: creator.youtubeUrl ?? "", threadsUrl: creator.threadsUrl ?? "", facebookUrl: creator.facebookUrl ?? "",
    source: creator.source, sourceDetail: creator.sourceDetail ?? "", sideshiftUrl: creator.sideshiftUrl ?? "",
    paymentMethod: creator.paymentMethod ?? "sideshift", paymentHandle: creator.paymentHandle ?? "", expectedPerWeek: creator.expectedPerWeek,
    status: creator.status, phone: creator.phone ?? "", email: creator.email ?? "", contactHandle: creator.contactHandle ?? "",
    discord: creator.discord ?? "", discordChannel: creator.discordChannel ?? "", whatsapp: creator.whatsapp ?? "", preferredChannel: creator.preferredChannel ?? "",
    onboardedAt: creator.onboardedAt ? creator.onboardedAt.slice(0, 10) : "",
    notes: creator.notes ?? "",
  });
  const field = "w-full px-3 py-2 text-sm";
  const label = "mb-1 block text-xs font-medium text-[var(--muted)]";
  function set<K extends keyof typeof f>(k: K, v: (typeof f)[K]) { setF((p) => ({ ...p, [k]: v })); }

  return (
    <div className="card mb-4 p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div><label className={label}>Name</label><input className={field} value={f.displayName} onChange={(e) => set("displayName", e.target.value)} /></div>
        <div><label className={label}>TikTok URL</label><input className={field} value={f.tiktokUrl} onChange={(e) => set("tiktokUrl", e.target.value)} /></div>
        <div><label className={label}>Instagram URL</label><input className={field} value={f.instagramUrl} onChange={(e) => set("instagramUrl", e.target.value)} /></div>
        <div><label className={label}>YouTube channel URL <span className="text-[var(--faint)]">(Shorts)</span></label><input className={field} value={f.youtubeUrl} onChange={(e) => set("youtubeUrl", e.target.value)} placeholder="youtube.com/@handle" /></div>
        <div><label className={label}>Threads URL</label><input className={field} value={f.threadsUrl} onChange={(e) => set("threadsUrl", e.target.value)} placeholder="threads.com/@handle" /></div>
        <div><label className={label}>Facebook page URL <span className="text-[var(--faint)]">(Reels)</span></label><input className={field} value={f.facebookUrl} onChange={(e) => set("facebookUrl", e.target.value)} placeholder="facebook.com/pagename" /></div>
        <div><label className={label}>Source</label><Select className="w-full" value={f.source} onChange={(v) => set("source", v)} options={["sideshift", "referral", "outreach", "agency", "other"].map((s) => [s, SOURCE_LABEL[s] ?? s] as [string, string])} /></div>
        <div><label className={label}>Source detail</label><input className={field} value={f.sourceDetail} onChange={(e) => set("sourceDetail", e.target.value)} /></div>
        <div className="sm:col-span-2 lg:col-span-3"><label className={label}>Sideshift chat URL <span className="text-[var(--faint)]">(pay them here)</span></label><input className={field} value={f.sideshiftUrl} onChange={(e) => set("sideshiftUrl", e.target.value)} placeholder="link to their Sideshift chat" /></div>
        <div><label className={label}>Payment method</label><Select className="w-full" value={f.paymentMethod} onChange={(v) => set("paymentMethod", v)} options={PAYMENT_METHODS as [string, string][]} /></div>
        {(f.paymentMethod === "venmo" || f.paymentMethod === "paypal") && (
          <div><label className={label}>{f.paymentMethod === "venmo" ? "Venmo" : "PayPal"} username</label><input className={field} value={f.paymentHandle} onChange={(e) => set("paymentHandle", e.target.value)} placeholder="@username" /></div>
        )}
        <div><label className={label}>Target posts / week</label><input type="number" min={1} max={21} className={field} value={f.expectedPerWeek} onChange={(e) => set("expectedPerWeek", Number(e.target.value) || 7)} /></div>
        <div><label className={label}>Onboarded on</label><input type="date" className={field} value={f.onboardedAt} onChange={(e) => set("onboardedAt", e.target.value)} /></div>
        <div><label className={label}>Status</label><Select className="w-full" value={f.status} onChange={(v) => set("status", v)} options={["active", "paused", "inactive"].map((s) => [s, s] as [string, string])} /></div>
        <div><label className={label}>Preferred channel</label><Select className="w-full" value={f.preferredChannel} onChange={(v) => set("preferredChannel", v)} options={["", "imessage", "instagram", "whatsapp", "discord", "email", "other"].map((s) => [s, s || "—"] as [string, string])} /></div>
        <div><label className={label}>Phone (iMessage/SMS)</label><input className={field} value={f.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+1…" /></div>
        <div><label className={label}>WhatsApp <span className="text-[var(--faint)]">(if different)</span></label><input className={field} value={f.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} placeholder="+1…" /></div>
        <div><label className={label}>Discord handle</label><input className={field} value={f.discord} onChange={(e) => set("discord", e.target.value)} placeholder="username" /></div>
        <div><label className={label}>Discord channel <span className="text-[var(--faint)]">(link to their creator channel)</span></label><input className={field} value={f.discordChannel} onChange={(e) => set("discordChannel", e.target.value)} placeholder="https://discord.com/channels/…" /></div>
        <div><label className={label}>Contact handle</label><input className={field} value={f.contactHandle} onChange={(e) => set("contactHandle", e.target.value)} /></div>
        <div><label className={label}>Email</label><input className={field} value={f.email} onChange={(e) => set("email", e.target.value)} /></div>
        <div className="sm:col-span-2 lg:col-span-3"><label className={label}>Notes</label><textarea rows={3} className={field} value={f.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Reminders, preferences, deal terms…" /></div>
      </div>
      <div className="mt-4 flex items-center justify-between">
        <button onClick={onDelete} className="rounded-lg border border-[color:rgba(242,104,95,0.4)] px-3 py-2 text-sm text-[var(--bad)] hover:bg-[color:rgba(242,104,95,0.1)]">Delete creator</button>
        <button onClick={() => onSave(f)} disabled={busy} className="btn btn-primary disabled:opacity-60">{busy ? "Saving…" : "Save changes"}</button>
      </div>
    </div>
  );
}

function CreatorTrendCard({ posts, range, onRange }: { posts: PostDTO[]; range: Range | null; onRange: (r: Range | null) => void }) {
  // All time runs from their first tracked post to today.
  const span: Range = useMemo(() => {
    if (range) return range;
    const first = posts.reduce((min, p) => (p.postedAt < min ? p.postedAt : min), posts[0]?.postedAt ?? new Date().toISOString());
    return { from: dstr(new Date(first)), to: dstr(new Date()), label: "All time" };
  }, [range, posts]);

  const { labels, views, total, engagement } = useMemo(() => {
    const labels: string[] = [];
    const map = new Map<string, number>();
    const d = new Date(`${span.from}T12:00:00`);
    const end = new Date(`${span.to}T12:00:00`);
    while (d <= end && labels.length <= 366) {
      const k = dstr(d);
      labels.push(k);
      map.set(k, 0);
      d.setDate(d.getDate() + 1);
    }
    let total = 0;
    const inRange: PostDTO[] = [];
    for (const p of posts) {
      const k = dstr(new Date(p.postedAt));
      if (map.has(k)) {
        map.set(k, map.get(k)! + p.views);
        total += p.views;
        inRange.push(p);
      }
    }
    return { labels, views: labels.map((k) => map.get(k)!), total, engagement: avgEngagement(inRange) };
  }, [posts, span.from, span.to]);

  return (
    <div className="card mb-4 p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">
          Views <span className="text-[var(--muted)]">· {span.label}</span>
          <span className="mono ml-2.5 text-base font-bold text-[var(--signal)]">{fmtNum(total)}</span>
          {engagement != null && (
            <span className="ml-3 font-normal" title="Likes + comments + shares, divided by views, across the videos posted in this range">
              <span className="mono text-base font-bold">{fmtPct(engagement)}</span> engagement
            </span>
          )}
        </h2>
        <RangePicker range={span} onChange={(r) => onRange(r)} onAllTime={() => onRange(null)} allTimeActive={!range} />
      </div>
      <Chart labels={labels} series={[{ name: "Views", color: "var(--signal)", values: views, area: true }]} format={fmtNum} formatX={fmtRangeDate} height={170} />
    </div>
  );
}
