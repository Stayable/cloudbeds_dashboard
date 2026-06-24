"use client";

import { useState } from "react";

// Notes / comments box for the /crystal dashboard. Robust submit (try/catch +
// abort timeout) so it can never hang on "Sending…" the way the old /test form
// did — it always resolves to a success or an actionable error.
export default function CrystalNotes() {
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("saving");
    setErrorMsg("");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch("/api/crystal-note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
        signal: controller.signal,
      });
      if (res.ok) {
        setStatus("done");
        setNotes("");
      } else {
        const b = await res.json().catch(() => ({}));
        setErrorMsg(b?.error || "Could not send. Try again.");
        setStatus("error");
      }
    } catch (err) {
      setErrorMsg(
        err instanceof DOMException && err.name === "AbortError"
          ? "The request timed out. Please try again."
          : "Could not reach the server. Please try again.",
      );
      setStatus("error");
    } finally {
      clearTimeout(timeout);
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Notes &amp; comments</p>
      <h2 className="mt-1 text-lg font-semibold text-slate-900">Leave a note on this dashboard</h2>
      <p className="mt-1 text-sm text-slate-500">
        Anything to add, change, or flag? Drop it here — it goes straight to the team.
      </p>
      <form onSubmit={submit} className="mt-3 space-y-3">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="What would you change, add, or remove?"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
        />
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={!notes.trim() || status === "saving"}
            className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {status === "saving" ? "Sending…" : "Send note"}
          </button>
          {status === "done" && <span className="text-sm text-emerald-600">Thanks — recorded.</span>}
          {status === "error" && <span className="text-sm text-red-600">{errorMsg}</span>}
        </div>
      </form>
    </section>
  );
}
