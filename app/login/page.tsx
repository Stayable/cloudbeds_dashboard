"use client";

import { useState } from "react";

export default function LoginPage() {
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(false);
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin }),
    });
    if (res.ok) {
      // Hard navigation so the new cookie is applied before middleware runs.
      window.location.assign("/");
    } else {
      setLoading(false);
      setError(true);
      setPin("");
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-ink px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl sm:p-8"
      >
        <p className="text-xs font-medium uppercase tracking-widest text-slate-400">
          Stayable · Operating Dashboard
        </p>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">Enter PIN</h1>
        <p className="mt-1 text-sm text-slate-500">
          This dashboard is private to RISE8 / Stayable.
        </p>

        <input
          type="password"
          inputMode="text"
          autoComplete="off"
          autoFocus
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          placeholder="Enter PIN"
          className="mt-5 w-full rounded-lg border border-slate-300 px-4 py-3 text-center text-lg tracking-widest text-slate-900 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
        />

        {error && (
          <p className="mt-2 text-sm text-red-600">Incorrect PIN. Try again.</p>
        )}

        <button
          type="submit"
          disabled={loading || pin.length === 0}
          className="mt-5 w-full rounded-lg bg-ink py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {loading ? "Checking…" : "Unlock"}
        </button>
      </form>
    </main>
  );
}
