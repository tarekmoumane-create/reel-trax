import type { Metadata } from "next";
import { Inter, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/AppShell";

const inter = Inter({
  variable: "--font-sans-app",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});
const plexMono = IBM_Plex_Mono({
  variable: "--font-mono-app",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Reel Trax",
  description:
    "Track every creator across every client — posting cadence, sourcing, payouts and invoices in one place.",
};

// Apply the saved theme before first paint so there's no flash of the wrong palette.
const themeInit = `(function(){try{var t=localStorage.getItem("rt-theme");if(t==="dark"||t==="light"){document.documentElement.setAttribute("data-theme",t);}}catch(e){}})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  // themeInit stamps data-theme on <html> before React hydrates, so the server
  // markup deliberately differs from the client's — suppress that one warning.
  return (
    <html lang="en" className={`${inter.variable} ${plexMono.variable} h-full`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body className="min-h-full">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
