"use client";

import { useState } from "react";

// Home-page affordance: enter your personal PIN to jump to your own dashboard.
// Reuses /api/auth, which re-issues the cookie for the matching level and returns
// the destination (/crystal, /monica, /bea, /rob, …). Robust submit (try/catch +
// timeout) so it can never hang.
export default function PersonalViewEntry() {
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(false);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin, next: "" }),
        signal: controller.signal,
      });
      if (res.ok) {
        const { redirect } = (await res.json().catch(() => ({}))) as { redirect?: string };
        window.location.assign(redirect || "/"); // hard nav so the new cookie applies
        return;
      }
      setError(true);
      setPin("");
      setLoading(false);
    } catch {
      setError(true);
      setLoading(false);
    } finally {
      clearTimeout(timeout);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="shrink-0 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/20"
      >
        Personal view →
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="flex shrink-0 items-center gap-2">
      <input
        type="password"
        inputMode="text"
        autoComplete="off"
        autoFocus
        value={pin}
        onChange={(e) => setPin(e.target.value)}
        placeholder="Your PIN"
        aria-label="Personal view PIN"
        className={
          "w-28 rounded-lg border bg-white/10 px-3 py-1.5 text-xs text-white placeholder-white/50 outline-none focus:bg-white/20 " +
          (error ? "border-red-400" : "border-white/20")
        }
      />
      <button
        type="submit"
        disabled={loading || pin.length === 0}
        className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-ink transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {loading ? "…" : "Go"}
      </button>
    </form>
  );
}
