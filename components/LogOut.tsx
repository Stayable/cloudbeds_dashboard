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
      className="h-[30px] shrink-0 rounded-md border border-chromeLine bg-transparent px-2.5 text-[11.5px] font-semibold text-[#8FB3DD] transition-colors hover:border-[#2A5C9E] hover:text-white disabled:opacity-50"
    >
      {loading ? "…" : "Log out"}
    </button>
  );
}
