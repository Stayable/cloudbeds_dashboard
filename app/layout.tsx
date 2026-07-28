import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans } from "next/font/google";
import Nav from "@/components/Nav";
import "./globals.css";

// IBM Plex Sans — the design system's typeface. Self-hosted by next/font, so
// there's no runtime request to Google and no layout shift on first paint.
const plex = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
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
      </body>
    </html>
  );
}
