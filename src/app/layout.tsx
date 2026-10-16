import type { Metadata, Viewport } from "next";
import { Instrument_Sans, JetBrains_Mono } from "next/font/google";
import { headers } from "next/headers";
import type { ReactNode } from "react";

import { Interactions } from "@/components/ui/interactions";
import { ToastProvider } from "@/components/ui/toast";
import { publicEnv } from "@/lib/env";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/site";

import "./globals.css";

/*
 * Two faces, self-hosted by next/font so no request leaves for Google: Instrument Sans,
 * the wordmark's face, for everything from titles to body text (titles are the same face,
 * heavier: the `font-display` utility), and JetBrains Mono for times and commands.
 */
const sans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-instrument-sans",
  display: "swap",
});
const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(publicEnv.NEXT_PUBLIC_SITE_URL),
  title: { default: `${SITE_NAME} · the AI meeting notetaker`, template: `%s · ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    locale: "en_US",
    title: `${SITE_NAME} · the AI meeting notetaker`,
    description: SITE_DESCRIPTION,
  },
  twitter: { card: "summary_large_image" },
  robots: { index: true, follow: true },
};

// Light by default; dark mode is the visitor's own choice (the app shell's sun/moon).
export const viewport: Viewport = { themeColor: "#fbf9f7" };

/**
 * Restores the stored choices before the first paint, so a dark page never flashes
 * light and a collapsed sidebar never flashes open. It runs as the first thing in the
 * body, under the request's CSP nonce; `suppressHydrationWarning` on <html> covers the
 * attributes it sets, which the server cannot know. The toggles themselves are
 * src/components/ui/theme-toggle.tsx and sidebar-toggle.tsx.
 */
const THEME_SCRIPT = `try{var d=document.documentElement.dataset;if(localStorage.getItem("afk-theme")==="dark")d.theme="dark";if(localStorage.getItem("afk-sidebar")==="rail")d.sidebar="rail"}catch(e){}`;

// Every HTML response carries a per-request script nonce (src/proxy.ts), which a page
// rendered at build time could not have. Everything under this layout renders per request.
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: ReactNode }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <body className="min-h-dvh font-sans">
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <ToastProvider>{children}</ToastProvider>
        <Interactions />
      </body>
    </html>
  );
}
