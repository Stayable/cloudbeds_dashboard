"use client";

import { useState } from "react";

export default function ExecFeedback() {
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">("idle");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("saving");
    const res = await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes }),
    });
    if (res.ok) {
      setStatus("done");
      setNotes("");
    } else {
      setStatus("error");
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Feedback</p>
      <h2 className="mt-1 text-lg font-semibold text-slate-900">Leave a note on this dashboard</h2>
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
            {status === "saving" ? "Sending…" : "Send feedback"}
          </button>
          {status === "done" && <span className="text-sm text-emerald-600">Thanks — recorded.</span>}
          {status === "error" && <span className="text-sm text-red-600">Could not send. Try again.</span>}
        </div>
      </form>
    </section>
  );
}
