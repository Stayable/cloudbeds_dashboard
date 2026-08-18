import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import Nav from "@/components/Nav";
import KbChatMount from "@/components/KbChatMount";
import "./globals.css";

// IBM Plex Sans — the design system's typeface. Self-hosted, and now served
// from a file IN THIS REPO rather than fetched from Google at build time.
//
// WHY: `next/font/google` downloads the font during `next build`. On 08/11/26
// Vercel's builder could not reach fonts.gstatic.com and every deploy failed
// with NextFontError — a third-party network call sitting in the critical path
// of every release, for an asset that never changes. The output was already
// self-hosted; only the fetch was remote. Committing the file removes the
// dependency entirely and the rendered result is identical.
//
// One file, not four: Google serves IBM Plex Sans as a single VARIABLE font and
// returned byte-identical bytes for each of the 400/500/600/700 requests
// (verified by hash). The `weight` range below is what makes those weights work
// off the one axis — shipping four copies would have been 137KB of duplicate.
const plex = localFont({
  src: "./fonts/IBMPlexSans-latin-var.woff2",
  weight: "100 700",
  style: "normal",
  display: "swap",
  variable: "--font-plex",
});

export const metadata: Metadata = {
  title: "Stayable — Operating Dashboard",
  description: "View-only Cloudbeds operating metrics for the Stayable portfolio.",
  robots: { index: false, follow: false }, // not for search indexing
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

// Applies the saved theme BEFORE first paint so a dark-mode user never sees a
// white flash. Kept deliberately tiny and dependency-free; ThemeToggle writes
// the same `sd_theme` key. Falls back to the OS preference on first visit.
const THEME_BOOTSTRAP = `(function(){try{var t=localStorage.getItem('sd_theme');if(!t)t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-theme="light" className={plex.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body className="min-h-screen font-sans">
        <Nav />
        {children}
        {/* Floating "Ask the knowledgebase" widget. Self-hides without a valid
            session, exactly like Nav — so it never appears on /login or /test. */}
        <KbChatMount />
      </body>
    </html>
  );
}
