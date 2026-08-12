"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { CreatorDetailResponse, CreatorDTO, PostDTO } from "@/lib/types";
import { Heatmap } from "@/components/Heatmap";
import { StatusBadge } from "@/components/StatusBadge";
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
    await fetch(`/api/creators/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
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
    router.push("/");
  }

  if (loading)
    return <div className="py-16 text-center text-sm text-[var(--muted)]">Loading…</div>;
  if (!data)
    return (
      <div className="py-16 text-center text-sm text-[var(--muted)]">
        Creator not found. <Link href="/" className="text-[var(--accent)]">Back to dashboard</Link>
      </div>
    );

  const { creator, cadence } = data;
  const posts = creator.posts ?? [];

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 md:px-6">
      <Link
        href="/"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-[var(--muted)] hover:text-[var(--text)]"
      >
        ← Back to roster
      </Link>

      {/* header */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="grid h-14 w-14 place-items-center rounded-full bg-[var(--panel2)] text-lg font-semibold text-[var(--muted)]">
            {initials(creator.displayName)}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold">{creator.displayName}</h1>
              <StatusBadge status={cadence.status} />
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-[var(--muted)]">
              {creator.tiktokUrl && (
                <a href={creator.tiktokUrl} target="_blank" rel="noreferrer" className="hover:text-[var(--accent)]">
                  TikTok @{creator.tiktokHandle}
                </a>
              )}
              {creator.instagramUrl && (
                <a href={creator.instagramUrl} target="_blank" rel="noreferrer" className="hover:text-[var(--accent)]">
                  Instagram @{creator.instagramHandle}
                </a>
              )}
              <span className="rounded bg-[var(--panel2)] px-1.5 py-0.5 text-[11px]">
                {SOURCE_LABEL[creator.source] ?? creator.source}
                {creator.sourceDetail ? ` · ${creator.sourceDetail}` : ""}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={resync}
            disabled={busy}
            className="rounded-lg border px-3 py-2 text-sm hover:bg-[var(--panel2)] disabled:opacity-60"
          >
            {busy ? "…" : "Resync"}
          </button>
          <button
            onClick={() => setEditing((e) => !e)}
            className="rounded-lg border px-3 py-2 text-sm hover:bg-[var(--panel2)]"
          >
            {editing ? "Close" : "Edit"}
          </button>
        </div>
      </div>

      {editing && <EditPanel creator={creator} onSave={patch} onDelete={remove} busy={busy} />}

      {/* stats row */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Last post" value={daysLabel(cadence.daysSinceLastPost)} />
        <Stat label="Streak" value={cadence.currentStreakDays > 0 ? `🔥 ${cadence.currentStreakDays}d` : "—"} />
        <Stat label="Posts / 7d" value={`${cadence.postsLast7d}`} />
        <Stat label="Posts / 30d" value={`${cadence.postsLast30d}`} />
        <Stat label="Target / wk" value={`${cadence.expectedPerWeek}`} />
        <Stat label="Pace" value={`${Math.round(cadence.pace7d * 100)}%`} />
      </div>

      {/* posting calendar */}
      <div className="card mb-4 overflow-x-auto p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Posting cadence · last 12 weeks</h2>
          <span className="text-xs text-[var(--muted)]">
            synced {timeAgo(creator.lastSyncedAt)}
            {creator.lastSyncStatus && creator.lastSyncStatus !== "ok"
              ? ` · ${creator.lastSyncStatus}`
              : ""}
          </span>
        </div>
        <Heatmap calendar={cadence.calendar} cell={13} gap={3} showMonths showLegend />
        {creator.lastSyncError && (
          <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">
            Last sync issue: {creator.lastSyncError}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* comms */}
        <div className="card p-4 lg:col-span-1">
          <CommsPanel creator={creator} onSave={patch} busy={busy} />
        </div>

        {/* posts */}
        <div className="card p-4 lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold">
            Recent posts <span className="text-[var(--muted)]">({posts.length})</span>
          </h2>
          {posts.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--muted)]">
              No posts tracked yet. They&apos;ll appear here after the next sync.
            </p>
          ) : (
            <div className="max-h-[420px] space-y-1.5 overflow-y-auto pr-1">
              {posts.slice(0, 60).map((p) => (
                <PostRow key={p.id} post={p} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card px-3 py-2.5">
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-[var(--muted)]">{label}</div>
    </div>
  );
}

function PostRow({ post }: { post: PostDTO }) {
  const dt = new Date(post.postedAt);
  return (
    <a
      href={post.url ?? "#"}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-[var(--panel2)]"
    >
      <span
        className="rounded px-1.5 py-0.5 text-[10px] font-medium"
        style={{
          background: post.platform === "tiktok" ? "rgba(255,255,255,0.08)" : "rgba(225,48,108,0.14)",
          color: post.platform === "tiktok" ? "#e7eaf3" : "#f472b6",
        }}
      >
        {post.platform === "tiktok" ? "TT" : "IG"}
      </span>
      <span className="w-28 shrink-0 text-xs text-[var(--muted)]">
        {dt.toLocaleDateString("en", { month: "short", day: "numeric", year: "2-digit" })}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm">
        {post.caption || <span className="text-[var(--muted)]">(no caption)</span>}
      </span>
      <span className="shrink-0 text-xs text-[var(--muted)]">▶ {fmtNum(post.views)}</span>
      <span className="shrink-0 text-xs text-[var(--muted)]">♥ {fmtNum(post.likes)}</span>
      {post.source === "manual" && (
        <span className="shrink-0 rounded bg-[var(--panel2)] px-1.5 py-0.5 text-[10px] text-[var(--muted)]">manual</span>
      )}
    </a>
  );
}

function CommsPanel({
  creator,
  onSave,
  busy,
}: {
  creator: CreatorDTO;
  onSave: (b: Record<string, unknown>) => Promise<void>;
  busy: boolean;
}) {
  const [notes, setNotes] = useState(creator.notes ?? "");
  const [followUp, setFollowUp] = useState(
    creator.followUpAt ? creator.followUpAt.slice(0, 10) : ""
  );

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

      <button
        onClick={() => onSave({ markContactedNow: true })}
        disabled={busy}
        className="mt-3 w-full rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        Mark contacted now
      </button>

      <div className="mt-4">
        <label className="mb-1 block text-xs font-medium text-[var(--muted)]">
          Follow-up date
        </label>
        <div className="flex gap-2">
          <input
            type="date"
            value={followUp}
            onChange={(e) => setFollowUp(e.target.value)}
            className="flex-1 px-2.5 py-1.5 text-sm"
          />
          <button
            onClick={() => onSave({ followUpAt: followUp || null })}
            disabled={busy}
            className="rounded-lg border px-3 py-1.5 text-sm hover:bg-[var(--panel2)] disabled:opacity-60"
          >
            Set
          </button>
        </div>
      </div>

      <div className="mt-4">
        <label className="mb-1 block text-xs font-medium text-[var(--muted)]">Notes</label>
        <textarea
          rows={4}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full px-2.5 py-2 text-sm"
          placeholder="Reminders, preferences, deal terms…"
        />
        <button
          onClick={() => onSave({ notes })}
          disabled={busy || notes === (creator.notes ?? "")}
          className="mt-2 w-full rounded-lg border px-3 py-1.5 text-sm hover:bg-[var(--panel2)] disabled:opacity-50"
        >
          Save notes
        </button>
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

function EditPanel({
  creator,
  onSave,
  onDelete,
  busy,
}: {
  creator: CreatorDTO;
  onSave: (b: Record<string, unknown>) => Promise<void>;
  onDelete: () => void;
  busy: boolean;
}) {
  const [f, setF] = useState({
    displayName: creator.displayName,
    tiktokUrl: creator.tiktokUrl ?? "",
    instagramUrl: creator.instagramUrl ?? "",
    source: creator.source,
    sourceDetail: creator.sourceDetail ?? "",
    expectedPerWeek: creator.expectedPerWeek,
    status: creator.status,
    phone: creator.phone ?? "",
    email: creator.email ?? "",
    contactHandle: creator.contactHandle ?? "",
    preferredChannel: creator.preferredChannel ?? "",
  });
  const field = "w-full px-3 py-2 text-sm";
  const label = "mb-1 block text-xs font-medium text-[var(--muted)]";
  function set<K extends keyof typeof f>(k: K, v: (typeof f)[K]) {
    setF((p) => ({ ...p, [k]: v }));
  }

  return (
    <div className="card mb-4 p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label className={label}>Name</label>
          <input className={field} value={f.displayName} onChange={(e) => set("displayName", e.target.value)} />
        </div>
        <div>
          <label className={label}>TikTok URL</label>
          <input className={field} value={f.tiktokUrl} onChange={(e) => set("tiktokUrl", e.target.value)} />
        </div>
        <div>
          <label className={label}>Instagram URL</label>
          <input className={field} value={f.instagramUrl} onChange={(e) => set("instagramUrl", e.target.value)} />
        </div>
        <div>
          <label className={label}>Source</label>
          <select className={field} value={f.source} onChange={(e) => set("source", e.target.value)}>
            {["sideshift", "referral", "outreach", "agency", "other"].map((s) => (
              <option key={s} value={s}>
                {SOURCE_LABEL[s] ?? s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={label}>Source detail</label>
          <input className={field} value={f.sourceDetail} onChange={(e) => set("sourceDetail", e.target.value)} />
        </div>
        <div>
          <label className={label}>Target posts / week</label>
          <input type="number" min={1} max={21} className={field} value={f.expectedPerWeek} onChange={(e) => set("expectedPerWeek", Number(e.target.value) || 7)} />
        </div>
        <div>
          <label className={label}>Status</label>
          <select className={field} value={f.status} onChange={(e) => set("status", e.target.value)}>
            {["active", "paused", "inactive"].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={label}>Preferred channel</label>
          <select className={field} value={f.preferredChannel} onChange={(e) => set("preferredChannel", e.target.value)}>
            {["", "sms", "imessage", "instagram", "whatsapp", "email", "other"].map((s) => (
              <option key={s} value={s}>
                {s || "—"}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={label}>Phone</label>
          <input className={field} value={f.phone} onChange={(e) => set("phone", e.target.value)} />
        </div>
        <div>
          <label className={label}>Contact handle</label>
          <input className={field} value={f.contactHandle} onChange={(e) => set("contactHandle", e.target.value)} />
        </div>
        <div>
          <label className={label}>Email</label>
          <input className={field} value={f.email} onChange={(e) => set("email", e.target.value)} />
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between">
        <button onClick={onDelete} className="rounded-lg border border-red-500/40 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10">
          Delete creator
        </button>
        <button
          onClick={() => onSave(f)}
          disabled={busy}
          className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {busy ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}
