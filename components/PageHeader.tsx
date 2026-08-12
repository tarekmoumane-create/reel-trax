"use client";

// Thin breadcrumb bar + page title block, matching the app's content shell.
export function TopBar({
  crumbs,
  right,
}: {
  crumbs: string[];
  right?: React.ReactNode;
}) {
  return (
    <div className="sticky top-0 z-20 flex h-[52px] items-center gap-2 border-b border-[var(--line)] bg-[var(--bg)]/85 px-6 backdrop-blur">
      <nav className="flex items-center gap-2 text-[13px]">
        {crumbs.map((c, i) => (
          <span key={i} className="flex items-center gap-2">
            {i > 0 && (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-[var(--faint)]">
                <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
            <span className={i === crumbs.length - 1 ? "font-medium text-[var(--ink)]" : "text-[var(--muted)]"}>
              {c}
            </span>
          </span>
        ))}
      </nav>
      {right && <div className="ml-auto flex items-center gap-2">{right}</div>}
    </div>
  );
}

export function PageTitle({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-5">
      <h1 className="font-display text-[26px] font-bold leading-none">{title}</h1>
      {sub && <p className="mt-2 text-[13px] text-[var(--muted)]">{sub}</p>}
    </div>
  );
}
