"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { CreatorDetailResponse, CreatorDTO, PostDTO } from "@/lib/types";
import { PostActivity } from "@/components/PostActivity";
import { StatusBadge } from "@/components/StatusBadge";
import { TopBar } from "@/components/PageHeader";
import { SOURCE_LABEL, daysLabel, fmtNum, initials, timeAgo } from "@/lib/ui";

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
            <button onClick={resync} disabled={busy} className="btn disabled:opacity-60">{busy ? "…" : "Resync"}</button>
            <button onClick={() => setEditing((e) => !e)} className="btn">{editing ? "Close" : "Edit"}</button>
          </>
        }
      />

      <div className="px-6 py-6">
        {/* header */}
        <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="grid h-14 w-14 place-items-center rounded-2xl bg-[var(--panel2)] text-lg font-semibold text-[var(--muted)]">{initials(creator.displayName)}</div>
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="font-display text-2xl font-bold">{creator.displayName}</h1>
                <StatusBadge status={cadence.status} />
              </div>
              <div className="mono mt-1 flex flex-wrap items-center gap-x-3 text-[12px] text-[var(--muted)]">
                {creator.tiktokUrl && <a href={creator.tiktokUrl} target="_blank" rel="noreferrer" className="hover:text-[var(--signal)]">TT @{creator.tiktokHandle}</a>}
                {creator.instagramUrl && <a href={creator.instagramUrl} target="_blank" rel="noreferrer" className="hover:text-[var(--signal)]">IG @{creator.instagramHandle}</a>}
                <span className="rounded bg-[var(--panel2)] px-1.5 py-0.5 text-[10px]">{SOURCE_LABEL[creator.source] ?? creator.source}{creator.sourceDetail ? ` · ${creator.sourceDetail}` : ""}</span>
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
            <PostActivity calendar={cadence.calendar} days={30} dot={16} gap={6} />
          </div>
          {creator.lastSyncError && <p className="mt-3 rounded-lg bg-[color:rgba(242,104,95,0.1)] px-3 py-2 text-xs text-[var(--bad)]">Last sync issue: {creator.lastSyncError}</p>}
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="card p-5 lg:col-span-1"><CommsPanel creator={creator} onSave={patch} busy={busy} /></div>
          <div className="card p-5 lg:col-span-2">
            <h2 className="mb-3 text-sm font-semibold">Recent posts <span className="text-[var(--muted)]">({posts.length})</span></h2>
            {posts.length === 0 ? (
              <p className="py-8 text-center text-sm text-[var(--muted)]">No posts tracked yet. They&apos;ll appear after the next sync.</p>
            ) : (
              <div className="max-h-[420px] space-y-1 overflow-y-auto pr-1">
                {posts.slice(0, 60).map((p) => <PostRow key={p.id} post={p} />)}
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

function PostRow({ post }: { post: PostDTO }) {
  const dt = new Date(post.postedAt);
  return (
    <a href={post.url ?? "#"} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-[var(--panel2)]">
      <span className="mono rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: post.platform === "tiktok" ? "rgba(255,255,255,0.08)" : "rgba(242,111,178,0.14)", color: post.platform === "tiktok" ? "var(--ink)" : "var(--ig)" }}>
        {post.platform === "tiktok" ? "TT" : "IG"}
      </span>
      <span className="mono w-24 shrink-0 text-[11px] text-[var(--muted)]">{dt.toLocaleDateString("en", { month: "short", day: "numeric", year: "2-digit" })}</span>
      <span className="min-w-0 flex-1 truncate text-sm">{post.caption || <span className="text-[var(--faint)]">(no caption)</span>}</span>
      <span className="mono shrink-0 text-[11px] text-[var(--muted)]">▶ {fmtNum(post.views)}</span>
      <span className="mono shrink-0 text-[11px] text-[var(--muted)]">♥ {fmtNum(post.likes)}</span>
      {post.source === "manual" && <span className="rounded bg-[var(--panel2)] px-1.5 py-0.5 text-[9px] text-[var(--faint)]">manual</span>}
    </a>
  );
}

function CommsPanel({ creator, onSave, busy }: { creator: CreatorDTO; onSave: (b: Record<string, unknown>) => Promise<void>; busy: boolean }) {
  const [notes, setNotes] = useState(creator.notes ?? "");
  const [followUp, setFollowUp] = useState(creator.followUpAt ? creator.followUpAt.slice(0, 10) : "");

  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold">Comms</h2>
      <dl className="space-y-2 text-sm">
        <Row label="Last contacted" value={timeAgo(creator.lastContactedAt)} />
        <Row label="Preferred" value={creator.preferredChannel || "—"} />
        <Row label="Phone" value={creator.phone || "—"} />
        <Row label="Handle" value={creator.contactHandle || "—"} />
        <Row label="Email" value={creator.email || "—"} />
      </dl>
      <button onClick={() => onSave({ markContactedNow: true })} disabled={busy} className="btn btn-primary mt-3 w-full justify-center disabled:opacity-60">Mark contacted now</button>

      <div className="mt-4">
        <label className="mb-1 block text-xs font-medium text-[var(--muted)]">Follow-up date</label>
        <div className="flex gap-2">
          <input type="date" value={followUp} onChange={(e) => setFollowUp(e.target.value)} className="min-w-0 flex-1 px-2.5 py-1.5 text-sm" />
          <button onClick={() => onSave({ followUpAt: followUp || null })} disabled={busy} className="btn px-3 py-1.5 text-sm disabled:opacity-60">Set</button>
        </div>
      </div>

      <div className="mt-4">
        <label className="mb-1 block text-xs font-medium text-[var(--muted)]">Notes</label>
        <textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full px-2.5 py-2 text-sm" placeholder="Reminders, preferences, deal terms…" />
        <button onClick={() => onSave({ notes })} disabled={busy || notes === (creator.notes ?? "")} className="btn mt-2 w-full justify-center py-1.5 text-sm disabled:opacity-50">Save notes</button>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-[var(--muted)]">{label}</dt>
      <dd className="truncate text-right">{value}</dd>
    </div>
  );
}

function EditPanel({ creator, onSave, onDelete, busy }: { creator: CreatorDTO; onSave: (b: Record<string, unknown>) => Promise<void>; onDelete: () => void; busy: boolean }) {
  const [f, setF] = useState({
    displayName: creator.displayName, tiktokUrl: creator.tiktokUrl ?? "", instagramUrl: creator.instagramUrl ?? "",
    source: creator.source, sourceDetail: creator.sourceDetail ?? "", expectedPerWeek: creator.expectedPerWeek,
    status: creator.status, phone: creator.phone ?? "", email: creator.email ?? "", contactHandle: creator.contactHandle ?? "", preferredChannel: creator.preferredChannel ?? "",
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
        <div><label className={label}>Source</label><select className={field} value={f.source} onChange={(e) => set("source", e.target.value)}>{["sideshift", "referral", "outreach", "agency", "other"].map((s) => <option key={s} value={s}>{SOURCE_LABEL[s] ?? s}</option>)}</select></div>
        <div><label className={label}>Source detail</label><input className={field} value={f.sourceDetail} onChange={(e) => set("sourceDetail", e.target.value)} /></div>
        <div><label className={label}>Target posts / week</label><input type="number" min={1} max={21} className={field} value={f.expectedPerWeek} onChange={(e) => set("expectedPerWeek", Number(e.target.value) || 7)} /></div>
        <div><label className={label}>Status</label><select className={field} value={f.status} onChange={(e) => set("status", e.target.value)}>{["active", "paused", "inactive"].map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
        <div><label className={label}>Preferred channel</label><select className={field} value={f.preferredChannel} onChange={(e) => set("preferredChannel", e.target.value)}>{["", "sms", "imessage", "instagram", "whatsapp", "email", "other"].map((s) => <option key={s} value={s}>{s || "—"}</option>)}</select></div>
        <div><label className={label}>Phone</label><input className={field} value={f.phone} onChange={(e) => set("phone", e.target.value)} /></div>
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
