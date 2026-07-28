import type { Config } from "tailwindcss";

// IB-clean aesthetic (CLAUDE.md §6 / org standard): dark headers, clean grid,
// no chartjunk. Every colour below resolves to a CSS variable declared in
// app/globals.css, so the light/dark pair lives in exactly one place and
// `bg-surface/60`-style alpha modifiers still work.
//
// Design source: "Property management dashboard system/Stayable Operating
// Dashboard.dc.html".
const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const config: Config = {
  // Dark mode is driven by data-theme="dark" on <html> (set by ThemeToggle),
  // which is also what the token block in globals.css keys off.
  darkMode: ["class", '[data-theme="dark"]'],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./config/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Surfaces
        canvas: token("canvas"),
        surface: token("surface"),
        surface2: token("surface-2"),
        surface3: token("surface-3"),
        // Lines
        line: token("line"),
        lineStrong: token("line-strong"),
        // Text
        txt: token("txt"),
        txt2: token("txt-2"),
        txt3: token("txt-3"),
        // Brand
        navy: token("navy"),
        navy2: token("navy-2"),
        accent: token("blue"), // Stayable bright blue — emphasis / active nav
        sky: token("sky"),
        gold: token("gold"),
        // Semantic status
        pos: token("pos"),
        posbg: token("pos-bg"),
        neg: token("neg"),
        negbg: token("neg-bg"),
        warn: token("warn"),
        warnbg: token("warn-bg"),
        // Chrome (top bar, navy hero cards) — navy in both themes
        chrome: token("chrome"),
        chromeText: token("chrome-text"),
        chromeLine: token("chrome-line"),
        // Legacy aliases kept so older markup keeps resolving to the system.
        ink: token("chrome"),
        skyLight: token("sky"),
      },
      fontFamily: {
        // Injected by next/font in app/layout.tsx.
        sans: ["var(--font-plex)", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica", "Arial", "sans-serif"],
      },
      boxShadow: {
        // The single card elevation used across the system.
        card: "var(--shadow)",
        seg: "0 1px 2px rgb(4 30 66 / 0.14)",
      },
    },
  },
  plugins: [],
};

export default config;
