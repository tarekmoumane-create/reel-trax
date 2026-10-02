"use client";

import { TopBar, PageTitle } from "@/components/PageHeader";

export function ComingSoon({
  crumbs,
  title,
  sub,
  bullets,
}: {
  crumbs: string[];
  title: string;
  sub: string;
  bullets: string[];
}) {
  return (
    <>
      <TopBar crumbs={crumbs} />
      <div className="px-6 py-6">
        <PageTitle title={title} sub={sub} />
        <div className="card mx-auto max-w-lg p-8 text-center">
          <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-xl bg-[var(--panel2)] text-[var(--signal)]">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
            </svg>
          </div>
          <h2 className="font-display text-lg font-bold">Coming next</h2>
          <p className="mx-auto mt-1.5 max-w-sm text-sm text-[var(--muted)]">
            This section is on the build list. Here&apos;s what it will do:
          </p>
          <ul className="mx-auto mt-4 max-w-sm space-y-2 text-left text-[14px] text-[var(--muted)]">
            {bullets.map((b, i) => (
              <li key={i} className="flex gap-2.5">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--signal)]" />
                {b}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>
  );
}
