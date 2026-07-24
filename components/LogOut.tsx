"use client";

import { useState } from "react";

// Log Out button for the persistent top nav. Clears the auth cookie server-side
// (/api/logout), then hard-navigates to /login so middleware re-gates the app
// with the cleared cookie. Hard nav (not router.push) so the Set-Cookie applies
// before the next request is evaluated.
export default function LogOut() {
  const [loading, setLoading] = useState(false);

  async function onClick() {
    setLoading(true);
    try {
      await fetch("/api/logout", { method: "POST" });
    } catch {
      // even if the network call fails, still send them to /login
    }
    window.location.assign("/login");
  }

  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="shrink-0 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/20 disabled:opacity-50"
    >
      {loading ? "…" : "Log Out"}
    </button>
  );
}
