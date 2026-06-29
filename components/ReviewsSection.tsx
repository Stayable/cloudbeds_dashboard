"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ReviewsView } from "@/lib/reviews";

// Operations Dashboard §5 — 1-Star Reviews. Shows the count + manager-responded
// count for a LOCKED date window (persisted in Neon, shared across viewers), a
// set-and-save editor (ops/exec), and a per-property collapsible breakdown.
// Counts + review text only; no reviewer names (column-restricted at fetch).
export default function ReviewsSection({
  configured,
  error,
  view,
  saved,
}: {
  configured: boolean;
  error: string | null;
  view: ReviewsView;
  saved: boolean; // true once a window has been explicitly saved (vs. default)
}) {
  const router = useRouter();
  const [from, setFrom] = useState(view.from);
  const [to, setTo] = useState(view.to);
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const dirty = from !== view.from || to !== view.to;

  async function save() {
    setStatus("saving");
    setErrorMsg("");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch("/api/reviews-window", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to }),
        signal: controller.signal,
      });
      if (res.ok) {
        setStatus("idle");
        router.refresh(); // re-fetch the page with the new locked window
      } else {
        const b = await res.json().catch(() => ({}));
        setErrorMsg(b?.error || "Could not save the window.");
        setStatus("error");
      }
    } catch {
      setErrorMsg("Could not reach the server. Try again.");
      setStatus("error");
    } finally {
      clearTimeout(timeout);
    }
  }

  if (!configured) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-center">
        <p className="text-sm font-semibold text-slate-700">Smartsheet not connected</p>
        <p className="mt-1 text-xs text-slate-500">
          Set <code className="rounded bg-slate-200 px-1">SMARTSHEET_API_TOKEN</code> to load 1-star reviews.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Locked date window editor */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs font-medium text-slate-600">
            From
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="mt-1 block rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
          </label>
          <label className="text-xs font-medium text-slate-600">
            To
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="mt-1 block rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
          </label>
          <button
            onClick={save}
            disabled={!dirty || status === "saving"}
            className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {status === "saving" ? "Saving…" : "Save & lock"}
          </button>
          <span className="text-xs text-slate-400">
            {saved ? "Locked window · shared" : "Default window — set & save to lock"}
          </span>
          {status === "error" && <span className="text-xs text-red-600">{errorMsg}</span>}
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Couldn&apos;t load reviews: {error}
        </div>
      )}

      {/* Count headline */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">1-Star Reviews</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900 sm:text-4xl">{view.total}</p>
          <p className="mt-1 text-xs text-slate-400">
            {view.from} → {view.to}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Manager Responded</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900 sm:text-4xl">{view.responded}</p>
          <p className="mt-1 text-xs text-slate-400">
            {view.total > 0 ? Math.round((view.responded / view.total) * 100) : 0}% of 1-star reviews
          </p>
        </div>
      </div>

      {/* Per-property collapsible breakdown */}
      {view.byProperty.length === 0 ? (
        <p className="rounded-lg bg-slate-50 px-4 py-8 text-center text-sm text-slate-400">
          No 1-star reviews in this window.
        </p>
      ) : (
        <div className="space-y-2">
          {view.byProperty.map((p) => (
            <details key={p.property} className="group rounded-xl border border-slate-200 bg-white shadow-sm">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
                <span className="flex items-center gap-2">
                  <svg
                    className="h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200 group-open:rotate-90"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path
                      fillRule="evenodd"
                      d="M7.21 14.77a.75.75 0 01.02-1.06L11.17 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <span className="text-sm font-semibold text-slate-900">{p.property}</span>
                </span>
                <span className="shrink-0 text-xs text-slate-500">
                  <span className="font-semibold text-slate-900">{p.count}</span> review{p.count === 1 ? "" : "s"} ·{" "}
                  {p.responded} responded
                </span>
              </summary>
              <div className="overflow-x-auto border-t border-slate-100">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                      <th className="px-4 py-2 font-medium">Date</th>
                      <th className="px-4 py-2 font-medium">Source</th>
                      <th className="px-4 py-2 font-medium">Review / Feedback</th>
                      <th className="px-4 py-2 font-medium">Manager Response</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.reviews.map((r, i) => (
                      <tr key={i} className="border-t border-slate-100 align-top">
                        <td className="whitespace-nowrap px-4 py-2 text-slate-500">{r.created || "—"}</td>
                        <td className="whitespace-nowrap px-4 py-2 text-slate-600">{r.source || "—"}</td>
                        <td className="px-4 py-2 text-slate-800">{r.review || "—"}</td>
                        <td className="px-4 py-2 text-slate-600">
                          {r.managerResponse ? (
                            r.managerResponse
                          ) : (
                            <span className="text-amber-600">No response</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
