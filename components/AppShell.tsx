"use client";

import { usePathname } from "next/navigation";
import { ClientsProvider } from "@/app/providers";
import { Sidebar } from "@/components/Sidebar";
import { Copilot } from "@/components/Copilot";

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
      {/* Floating copilot bubble — present on every page of the app shell. */}
      <Copilot />
    </ClientsProvider>
  );
}
