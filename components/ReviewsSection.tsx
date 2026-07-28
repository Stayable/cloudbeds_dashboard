"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ReviewsView } from "@/lib/reviews";

// Per-property grouped bar chart: previous segment vs current segment. The
// previous segment is the equal-length window immediately before the locked
// one (computed server-side in buildReviewsView), so a 7-day window compares to
// the prior 7 days, a 14-day window to the prior 14, etc. A property that
// dropped its 1-star count "improved"; one that rose "worsened".
function ReviewsTrendChart({ view, windowDays }: { view: ReviewsView; windowDays: number }) {
  // Largest single bar across both segments, used to scale bar heights. Floor at
  // 1 so an all-zero chart doesn't divide by zero.
  const max = Math.max(1, ...view.byProperty.map((p) => Math.max(p.count, p.priorCount)));
  const dayLabel = `${windowDays} day${windowDays === 1 ? "" : "s"}`;

  return (
    <div className="rounded-[10px] border border-line bg-surface p-4 shadow-card sm:p-5">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[10.5px] font-semibold uppercase tracking-[.08em] text-txt3">
          1-Star Reviews · Previous vs Current ({dayLabel})
        </p>
        <div className="flex items-center gap-4 text-xs text-txt2">
          <span className="flex items-center gap-1.5">
            <span className="h-[11px] w-[11px] rounded-[2px] bg-sky" /> Prior ({view.priorFrom} → {view.priorTo})
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-[11px] w-[11px] rounded-[2px] bg-navy" /> Current ({view.from} → {view.to})
          </span>
        </div>
      </div>

      {/* Vertical grouped bars: one column per property, two bars (prior, current). */}
      <div className="overflow-x-auto">
        <div className="flex min-w-fit items-end gap-5 px-1" style={{ height: "180px" }}>
          {view.byProperty.map((p) => {
            const delta = p.count - p.priorCount; // <0 improved, >0 worsened
            return (
              <div key={p.property} className="flex h-full flex-1 flex-col items-center justify-end gap-2">
                {/* bar pair, growing from the baseline */}
                <div className="flex w-full items-end justify-center gap-1.5">
                  <div className="flex flex-1 flex-col items-center justify-end" style={{ maxWidth: "28px" }}>
                    <span className="mb-0.5 text-[11px] tabular-nums text-txt3">
                      {p.priorCount}
                    </span>
                    <div
                      className="w-full rounded-t-[3px] bg-sky"
                      style={{ height: `${(p.priorCount / max) * 130}px`, minHeight: p.priorCount ? "3px" : 0 }}
                      title={`Prior: ${p.priorCount}`}
                    />
                  </div>
                  <div className="flex flex-1 flex-col items-center justify-end" style={{ maxWidth: "28px" }}>
                    <span className="mb-0.5 text-[11px] font-semibold tabular-nums text-txt">
                      {p.count}
                    </span>
                    <div
                      className="w-full rounded-t-[3px] bg-navy"
                      style={{ height: `${(p.count / max) * 130}px`, minHeight: p.count ? "3px" : 0 }}
                      title={`Current: ${p.count}`}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* x-axis: property name + improvement/regression badge under each column */}
      <div className="mt-2 flex min-w-fit gap-5 border-t border-line px-1 pt-2">
        {view.byProperty.map((p) => {
          const delta = p.count - p.priorCount;
          return (
            <div key={p.property} className="flex flex-1 flex-col items-center gap-1 text-center">
              <span className="max-w-[88px] truncate text-xs font-medium text-txt" title={p.property}>
                {p.property}
              </span>
              <span
                className={`whitespace-nowrap rounded-[5px] px-[7px] py-0.5 text-[11px] font-semibold ${
                  delta < 0
                    ? "bg-posbg text-pos"
                    : delta > 0
                      ? "bg-negbg text-neg"
                      : "bg-surface2 text-txt2"
                }`}
                title={delta < 0 ? "Improved" : delta > 0 ? "Worsened" : "No change"}
              >
                {delta < 0 ? `▼ ${Math.abs(delta)}` : delta > 0 ? `▲ ${delta}` : "—"}
              </span>
            </div>
          );
        })}
      </div>

      <p className="mt-3 text-xs text-txt2">
        Portfolio: <span className="font-semibold text-txt2">{view.priorTotal}</span> prior →{" "}
        <span className="font-semibold text-txt">{view.total}</span> current
        {view.total !== view.priorTotal && (
          <span className={view.total < view.priorTotal ? "text-pos" : "text-neg"}>
            {" "}
            ({view.total < view.priorTotal ? "▼" : "▲"} {Math.abs(view.total - view.priorTotal)})
          </span>
        )}
      </p>
    </div>
  );
}

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

  // Length of the locked window in days (inclusive), used to label the
  // previous segment ("Prior 7 days", etc.).
  const windowDays =
    Math.round((Date.parse(view.to) - Date.parse(view.from)) / 86_400_000) + 1;

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
      <div className="rounded-[10px] border border-dashed border-lineStrong bg-surface2 px-5 py-8 text-center">
        <p className="text-sm font-semibold text-txt">Smartsheet not connected</p>
        <p className="mt-1 text-xs text-txt2">
          Set <code className="rounded bg-surface3 px-1">SMARTSHEET_API_TOKEN</code> to load 1-star reviews.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Locked date window editor */}
      <div className="rounded-[10px] border border-line bg-surface p-4 shadow-card sm:p-5">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs font-medium text-txt2">
            From
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="mt-1 block rounded-lg border border-lineStrong px-3 py-2 text-sm text-txt outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
          </label>
          <label className="text-xs font-medium text-txt2">
            To
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="mt-1 block rounded-lg border border-lineStrong px-3 py-2 text-sm text-txt outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
          </label>
          <button
            onClick={save}
            disabled={!dirty || status === "saving"}
            className="rounded-lg bg-chrome px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {status === "saving" ? "Saving…" : "Save & lock"}
          </button>
          <span className="text-xs text-txt3">
            {saved ? "Locked window · shared" : "Default window — set & save to lock"}
          </span>
          {status === "error" && <span className="text-xs text-neg">{errorMsg}</span>}
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-warnbg px-4 py-3 text-sm text-warn">
          Couldn&apos;t load reviews: {error}
        </div>
      )}

      {/* Count headline */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-[10px] border border-line bg-surface p-4 shadow-card">
          <p className="text-[10.5px] font-semibold uppercase tracking-[.08em] text-txt3">1-Star Reviews</p>
          <p className="mt-2 text-3xl font-semibold text-txt sm:text-4xl">{view.total}</p>
          <p className="mt-1 text-xs text-txt3">
            {view.from} → {view.to}
          </p>
        </div>
        <div className="rounded-[10px] border border-line bg-surface p-4 shadow-card">
          <p className="text-[10.5px] font-semibold uppercase tracking-[.08em] text-txt3">Manager Responded</p>
          <p className="mt-2 text-3xl font-semibold text-txt sm:text-4xl">{view.responded}</p>
          <p className="mt-1 text-xs text-txt3">
            {view.total > 0 ? Math.round((view.responded / view.total) * 100) : 0}% of 1-star reviews
          </p>
        </div>
      </div>

      {/* Per-property trend: previous segment vs current segment */}
      {view.byProperty.length > 0 && <ReviewsTrendChart view={view} windowDays={windowDays} />}

      {/* Per-property collapsible breakdown */}
      {view.byProperty.length === 0 ? (
        <p className="rounded-lg bg-surface2 px-4 py-8 text-center text-sm text-txt3">
          No 1-star reviews in this window.
        </p>
      ) : (
        <div className="space-y-2">
          {view.byProperty.map((p) => (
            <details key={p.property} className="group rounded-[10px] border border-line bg-surface shadow-card">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
                <span className="flex items-center gap-2">
                  <svg
                    className="h-4 w-4 shrink-0 text-txt3 transition-transform duration-200 group-open:rotate-90"
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
                  <span className="text-sm font-semibold text-txt">{p.property}</span>
                </span>
                <span className="shrink-0 text-xs text-txt2">
                  <span className="font-semibold text-txt">{p.count}</span> review{p.count === 1 ? "" : "s"} ·{" "}
                  {p.responded} responded
                </span>
              </summary>
              <div className="overflow-x-auto border-t border-line">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b border-lineStrong bg-surface2 text-left text-[10px] font-semibold uppercase tracking-[.07em] text-txt3">
                      <th className="px-4 py-2.5 font-semibold">Date</th>
                      <th className="px-4 py-2.5 font-semibold">Source</th>
                      <th className="px-4 py-2.5 font-semibold">Review / Feedback</th>
                      <th className="px-4 py-2.5 font-semibold">Manager Response</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.reviews.map((r, i) => (
                      <tr key={i} className="border-t border-line align-top">
                        <td className="whitespace-nowrap px-4 py-2 text-txt2">{r.created || "—"}</td>
                        <td className="whitespace-nowrap px-4 py-2 text-txt2">{r.source || "—"}</td>
                        <td className="px-4 py-2 text-txt">{r.review || "—"}</td>
                        <td className="px-4 py-2 text-txt2">
                          {r.managerResponse ? (
                            r.managerResponse
                          ) : (
                            <span className="text-warn">No response</span>
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
