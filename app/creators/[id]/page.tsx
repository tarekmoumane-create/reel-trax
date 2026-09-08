"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CreatorDetailResponse, CreatorDTO, PostDTO } from "@/lib/types";
import { PostActivity } from "@/components/PostActivity";
import { Chart } from "@/components/Chart";
import { StatusBadge } from "@/components/StatusBadge";
import { ContactButton } from "@/components/ContactButton";
import { VideoThumb } from "@/components/VideoThumb";
import { Avatar } from "@/components/Avatar";
import { TopBar } from "@/components/PageHeader";
import { SOURCE_LABEL, daysLabel, fmtNum, timeAgo } from "@/lib/ui";
import { PAYMENT_METHODS, PAYMENT_LABEL, payLink } from "@/lib/pay";
import { Select } from "@/components/Select";
import { RangePicker, PRESETS, dstr, fmtRangeDate, type Range } from "@/components/RangePicker";
import { VideoPayMenu, type VideoPayPatch } from "@/components/VideoPayMenu";
import { parsePayExclusions } from "@/lib/payouts";

export default function CreatorDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<CreatorDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

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
              </div>
              <div className="mono mt-1 flex flex-wrap items-center gap-x-3 text-[12px] text-[var(--muted)]">
                {creator.tiktokUrl && <a href={creator.tiktokUrl} target="_blank" rel="noreferrer" className="hover:text-[var(--signal)]">TT @{creator.tiktokHandle}</a>}
                {creator.instagramUrl && <a href={creator.instagramUrl} target="_blank" rel="noreferrer" className="hover:text-[var(--signal)]">IG @{creator.instagramHandle}</a>}
                {creator.youtubeUrl && <a href={creator.youtubeUrl} target="_blank" rel="noreferrer" className="hover:text-[var(--signal)]">YT {creator.youtubeHandle ? `@${creator.youtubeHandle}` : "channel"}</a>}
                {creator.threadsHandle && <a href={creator.threadsUrl ?? `https://www.threads.com/@${creator.threadsHandle}`} target="_blank" rel="noreferrer" className="hover:text-[var(--signal)]">TH @{creator.threadsHandle}</a>}
                <span className="rounded bg-[var(--panel2)] px-1.5 py-0.5 text-[10px]">from {SOURCE_LABEL[creator.source] ?? creator.source}{creator.sourceDetail ? ` · ${creator.sourceDetail}` : ""}</span>
                <span className="rounded bg-[color:rgba(124,92,255,0.15)] px-1.5 py-0.5 text-[10px] text-[var(--signal)]">pay via {PAYMENT_LABEL[creator.paymentMethod] ?? creator.paymentMethod}</span>
                {creator.onboardedAt && (
                  <span className="rounded bg-[var(--panel2)] px-1.5 py-0.5 text-[10px]">
                    onboarded {new Date(creator.onboardedAt).toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" })}
                  </span>
                )}
                {posts.length > 0 && (
                  <span className="rounded bg-[var(--panel2)] px-1.5 py-0.5 text-[10px]">
                    first post {new Date(posts[posts.length - 1].postedAt).toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" })}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {editing && <EditPanel creator={creator} onSave={patch} onDelete={remove} busy={busy} />}

        {/* KPI cards */}
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Kpi icon="clock" label="Last post" value={daysLabel(cadence.daysSinceLastPost)} />
          <Kpi icon="fire" label="Streak" value={cadence.currentStreakDays > 0 ? `${cadence.currentStreakDays}d` : "—"} />
          <Kpi icon="grid" label="Posts · 7d" value={`${cadence.postsLast7d}`} />
          <Kpi icon="grid" label="Posts · 30d" value={`${cadence.postsLast30d}`} />
          <Kpi icon="target" label="Target / wk" value={`${cadence.expectedPerWeek}`} />
          <Kpi icon="gauge" label="Pace" value={`${Math.round(cadence.pace7d * 100)}%`} tone={cadence.pace7d >= 1 ? "var(--ok)" : "var(--warn)"} />
        </div>

        {/* activity strip */}
        <div className="card mb-4 p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Post activity <span className="text-[var(--muted)]">· last 30 days</span></h2>
            <span className="mono text-[11px] text-[var(--faint)]">
              synced {timeAgo(creator.lastSyncedAt)}{creator.lastSyncStatus && creator.lastSyncStatus !== "ok" ? ` · ${creator.lastSyncStatus}` : ""}
            </span>
          </div>
          <div className="overflow-x-auto">
            <PostActivity calendar={cadence.calendar} days={30} dot={18} gap={7} />
          </div>
          {creator.lastSyncError && <p className="mt-3 rounded-lg bg-[color:rgba(242,104,95,0.1)] px-3 py-2 text-xs text-[var(--bad)]">Last sync issue: {creator.lastSyncError}</p>}
        </div>

        {/* trend */}
        {posts.length > 0 && <CreatorTrendCard posts={posts} />}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="card p-5 lg:col-span-1"><ContactPanel creator={creator} onSave={patch} busy={busy} /></div>
          <div className="card p-5 lg:col-span-2">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">Recent posts <span className="text-[var(--muted)]">({posts.length})</span></h2>
              <span className="text-[11px] text-[var(--faint)]">Pay column: mark warm-ups or set a fixed price per video</span>
            </div>
            {posts.length === 0 ? (
              <p className="py-8 text-center text-sm text-[var(--muted)]">No posts tracked yet. They&apos;ll appear after the next sync.</p>
            ) : (
              <div className="max-h-[420px] space-y-1 overflow-y-auto pr-1">
                {posts.slice(0, 60).map((p) => <PostRow key={p.id} post={p} onPay={(patch) => savePostPay(p.id, patch)} />)}
              </div>
            )}
          </div>
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
};

function Kpi({ icon, label, value, tone }: { icon: string; label: string; value: string; tone?: string }) {
  return (
    <div className="card p-3.5">
      <div className="mb-2 flex items-center gap-2 text-[11px] text-[var(--muted)]">
        <span className="tile-ico h-6 w-6">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{KPI_ICONS[icon]}</svg>
        </span>
        {label}
      </div>
      <div className="mono text-lg font-bold" style={{ color: tone }}>{value}</div>
    </div>
  );
}

function PostRow({ post, onPay }: { post: PostDTO; onPay: (patch: VideoPayPatch) => void }) {
  const dt = new Date(post.postedAt);
  return (
    <div className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-[var(--panel2)]">
      <VideoThumb url={post.url} thumbnailUrl={post.thumbnailUrl} platform={post.platform} w={32} h={44} />
      <span className="mono w-24 shrink-0 text-[11px] text-[var(--muted)]">{dt.toLocaleDateString("en", { month: "short", day: "numeric", year: "2-digit" })}</span>
      <a href={post.url ?? "#"} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-sm hover:text-[var(--signal)]">
        {post.caption || <span className="text-[var(--faint)]">(no caption)</span>}
      </a>
      <span className="mono shrink-0 text-[11px] text-[var(--muted)]">▶ {fmtNum(post.views)}</span>
      <span className="mono shrink-0 text-[11px] text-[var(--muted)]">♥ {fmtNum(post.likes)}</span>
      {post.source === "manual" && <span className="rounded bg-[var(--panel2)] px-1.5 py-0.5 text-[9px] text-[var(--faint)]">manual</span>}
      <div className="w-[108px] shrink-0">
        <VideoPayMenu
          value={{ exclusions: parsePayExclusions(post.payExclusions), isWarmUp: post.isWarmUp, payOverride: post.payOverride }}
          onChange={onPay}
        />
      </div>
    </div>
  );
}

function ContactPanel({ creator, onSave, busy }: { creator: CreatorDTO; onSave: (b: Record<string, unknown>) => Promise<void>; busy: boolean }) {
  const [notes, setNotes] = useState(creator.notes ?? "");

  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold">Contact</h2>
      <dl className="space-y-2 text-sm">
        <Row label="Preferred" value={creator.preferredChannel || "—"} />
        <Row label="Phone" value={creator.phone || "—"} />
        <Row label="WhatsApp" value={creator.whatsapp || "—"} />
        <Row label="Discord" value={creator.discord ? `@${creator.discord.replace(/^@/, "")}` : "—"} />
        <Row label="Discord channel" value={creator.discordChannel || "—"} href={creator.discordChannel} />
        <Row label="Email" value={creator.email || "—"} href={creator.email ? `mailto:${creator.email}` : null} />
      </dl>

      <div className="mt-4">
        <label className="mb-1 block text-xs font-medium text-[var(--muted)]">Notes</label>
        <textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full px-2.5 py-2 text-sm" placeholder="Reminders, preferences, deal terms…" />
        <button onClick={() => onSave({ notes })} disabled={busy || notes === (creator.notes ?? "")} className="btn mt-2 w-full justify-center py-1.5 text-sm disabled:opacity-50">Save notes</button>
      </div>
    </div>
  );
}

function Row({ label, value, href }: { label: string; value: string; href?: string | null }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="shrink-0 text-[var(--muted)]">{label}</dt>
      <dd className="min-w-0 truncate text-right">
        {href && value !== "—" ? (
          <a href={href} target={href.startsWith("http") ? "_blank" : undefined} rel="noreferrer" className="text-[var(--signal)] hover:underline">{value.replace(/^https?:\/\//, "")}</a>
        ) : value}
      </dd>
    </div>
  );
}

function EditPanel({ creator, onSave, onDelete, busy }: { creator: CreatorDTO; onSave: (b: Record<string, unknown>) => Promise<void>; onDelete: () => void; busy: boolean }) {
  const [f, setF] = useState({
    displayName: creator.displayName, tiktokUrl: creator.tiktokUrl ?? "", instagramUrl: creator.instagramUrl ?? "", youtubeUrl: creator.youtubeUrl ?? "", threadsUrl: creator.threadsUrl ?? "",
    source: creator.source, sourceDetail: creator.sourceDetail ?? "", sideshiftUrl: creator.sideshiftUrl ?? "",
    paymentMethod: creator.paymentMethod ?? "sideshift", paymentHandle: creator.paymentHandle ?? "", expectedPerWeek: creator.expectedPerWeek,
    status: creator.status, phone: creator.phone ?? "", email: creator.email ?? "", contactHandle: creator.contactHandle ?? "",
    discord: creator.discord ?? "", discordChannel: creator.discordChannel ?? "", whatsapp: creator.whatsapp ?? "", preferredChannel: creator.preferredChannel ?? "",
    onboardedAt: creator.onboardedAt ? creator.onboardedAt.slice(0, 10) : "",
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
      </div>
      <div className="mt-4 flex items-center justify-between">
        <button onClick={onDelete} className="rounded-lg border border-[color:rgba(242,104,95,0.4)] px-3 py-2 text-sm text-[var(--bad)] hover:bg-[color:rgba(242,104,95,0.1)]">Delete creator</button>
        <button onClick={() => onSave(f)} disabled={busy} className="btn btn-primary disabled:opacity-60">{busy ? "Saving…" : "Save changes"}</button>
      </div>
    </div>
  );
}

function CreatorTrendCard({ posts }: { posts: PostDTO[] }) {
  const [range, setRange] = useState<Range>(() => PRESETS[4].range()); // last 30 days

  const { labels, views, total } = useMemo(() => {
    const labels: string[] = [];
    const map = new Map<string, number>();
    const d = new Date(`${range.from}T12:00:00`);
    const end = new Date(`${range.to}T12:00:00`);
    while (d <= end && labels.length <= 366) {
      const k = dstr(d);
      labels.push(k);
      map.set(k, 0);
      d.setDate(d.getDate() + 1);
    }
    let total = 0;
    for (const p of posts) {
      const k = dstr(new Date(p.postedAt));
      if (map.has(k)) {
        map.set(k, map.get(k)! + p.views);
        total += p.views;
      }
    }
    return { labels, views: labels.map((k) => map.get(k)!), total };
  }, [posts, range.from, range.to]);

  return (
    <div className="card mb-4 p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">
          Views <span className="text-[var(--muted)]">· {range.label}</span>
          <span className="mono ml-2.5 text-base font-bold text-[var(--signal)]">{fmtNum(total)}</span>
        </h2>
        <RangePicker range={range} onChange={setRange} />
      </div>
      <Chart labels={labels} series={[{ name: "Views", color: "var(--signal)", values: views, area: true }]} format={fmtNum} formatX={fmtRangeDate} height={170} />
    </div>
  );
}
