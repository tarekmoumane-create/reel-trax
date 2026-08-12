"use client";

import { usePathname } from "next/navigation";
import { ClientsProvider } from "@/app/providers";
import { Sidebar } from "@/components/Sidebar";

// Wraps the authenticated app in the sidebar shell, but renders the login page
// (and any future standalone pages) bare — no sidebar, no data fetching.
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/login") return <>{children}</>;
  return (
    <ClientsProvider>
      <div className="flex h-screen overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </ClientsProvider>
  );
}
