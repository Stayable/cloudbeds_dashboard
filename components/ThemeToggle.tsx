"use client";

import { useEffect, useState } from "react";

// Light/dark switch for the top chrome. The active theme lives as
// data-theme="light|dark" on <html> (which is what the token block in
// globals.css keys off) and is persisted to localStorage under `sd_theme`.
// The pre-paint bootstrap script in app/layout.tsx reads the same key, so a
// dark-mode user never sees a white flash on navigation.
//
// Renders its label only after mount: on the server we don't know the saved
// theme, and guessing would produce a hydration mismatch.
export default function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);

  useEffect(() => {
    const attr = document.documentElement.getAttribute("data-theme");
    setTheme(attr === "dark" ? "dark" : "light");
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("sd_theme", next);
    } catch {
      // private mode / storage disabled — the theme still applies for this page
    }
    setTheme(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      className="h-[30px] w-[54px] shrink-0 rounded-md border border-chromeLine bg-white/[.05] text-[11.5px] font-semibold text-chromeText transition-colors hover:bg-white/[.12]"
    >
      {/* Fixed width above, so the label appearing after mount doesn't reflow. */}
      {theme === null ? "" : theme === "dark" ? "Light" : "Dark"}
    </button>
  );
}
