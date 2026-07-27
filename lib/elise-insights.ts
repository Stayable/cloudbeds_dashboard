// Pure builders that turn the generic `elise_metric_daily` rows into the
// view-models rendered by the Leasing enrichment, Voice-AI and AI-performance
// sections. No I/O, no PII — input is already aggregated counts + labels.
//
// Scope note: this covers what the Elise share actually populates. Renewals,
// evictions (DEMAND_NOTICES), work orders, turns and inspections are EMPTY for
// this org (probed 2026-07-27), so there are deliberately no builders for them.

import type { EliseMetricRow } from "@/lib/db";

export type Slice = { label: string; n: number; pct: number };
export type MetricBreakdown = {
  metric: string;
  total: number;
  slices: Slice[];
};

/** Human labels for the raw dimension values Elise emits. Anything unmapped
 *  falls back to a title-cased version of the raw value. */
const LABELS: Record<string, string> = {
  ai: "AI-booked",
  human: "Human-booked",
  after_hours: "After hours",
  business_hours: "Business hours",
  voice_ai: "Voice AI",
  leasing_office: "Leasing office",
  unanswered: "Unanswered",
  ESCORTED: "Escorted",
  VIRTUAL_TOUR: "Virtual",
  SELF_GUIDED: "Self-guided",
};

export function prettyLabel(raw: string): string {
  if (LABELS[raw]) return LABELS[raw];
  const spaced = raw.replace(/[_-]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Collapse rows for one metric (optionally one property) into ranked slices
 *  with percentages. `codes` empty/undefined = all properties. */
export function breakdown(
  rows: EliseMetricRow[],
  metric: string,
  opts?: { code?: string; limit?: number },
): MetricBreakdown {
  const byDim = new Map<string, number>();
  for (const r of rows) {
    if (r.metric !== metric) continue;
    if (opts?.code && r.code !== opts.code) continue;
    byDim.set(r.dimension, (byDim.get(r.dimension) ?? 0) + r.n);
  }
  const total = [...byDim.values()].reduce((s, n) => s + n, 0);
  let slices = [...byDim.entries()]
    .map(([dimension, n]) => ({ label: prettyLabel(dimension), n, pct: total ? n / total : 0 }))
    .sort((a, b) => b.n - a.n);

  // Long tails (lead sources, cancellation reasons) collapse into "Other" so
  // the UI stays readable without hiding volume.
  const limit = opts?.limit;
  if (limit && slices.length > limit) {
    const head = slices.slice(0, limit);
    const tailN = slices.slice(limit).reduce((s, x) => s + x.n, 0);
    slices = [...head, { label: "Other", n: tailN, pct: total ? tailN / total : 0 }];
  }
  return { metric, total, slices };
}

/** Share of one dimension within a metric (e.g. AI-booked % of booked tours).
 *  Returns null when the metric has no rows — the caller renders "—" rather
 *  than a misleading 0%. */
export function shareOf(
  rows: EliseMetricRow[],
  metric: string,
  dimension: string,
  opts?: { code?: string },
): number | null {
  let hit = 0;
  let total = 0;
  for (const r of rows) {
    if (r.metric !== metric) continue;
    if (opts?.code && r.code !== opts.code) continue;
    total += r.n;
    if (r.dimension === dimension) hit += r.n;
  }
  return total ? hit / total : null;
}

/** Average call length in seconds across `voice_answered` rows (total column
 *  carries summed CALL_DURATION_SEC). Null when there are no calls. */
export function avgCallSeconds(rows: EliseMetricRow[], opts?: { code?: string }): number | null {
  let calls = 0;
  let seconds = 0;
  for (const r of rows) {
    if (r.metric !== "voice_answered") continue;
    if (opts?.code && r.code !== opts.code) continue;
    calls += r.n;
    seconds += r.total;
  }
  return calls ? seconds / calls : null;
}

/** Task resolution rate — `total` on task_type rows carries the resolved count. */
export function taskResolutionRate(rows: EliseMetricRow[], opts?: { code?: string }): number | null {
  let tasks = 0;
  let resolved = 0;
  for (const r of rows) {
    if (r.metric !== "task_type") continue;
    if (opts?.code && r.code !== opts.code) continue;
    tasks += r.n;
    resolved += r.total;
  }
  return tasks ? resolved / tasks : null;
}

/** Per-property totals for one metric, ranked — drives the leaderboard tables. */
export function byProperty(rows: EliseMetricRow[], metric: string): { code: string; n: number }[] {
  const byCode = new Map<string, number>();
  for (const r of rows) {
    if (r.metric !== metric) continue;
    byCode.set(r.code, (byCode.get(r.code) ?? 0) + r.n);
  }
  return [...byCode.entries()].map(([code, n]) => ({ code, n })).sort((a, b) => b.n - a.n);
}

/** Daily series for one metric (all dimensions summed) — for sparklines. */
export function dailySeries(
  rows: EliseMetricRow[],
  metric: string,
  opts?: { code?: string },
): { day: string; n: number }[] {
  const byDay = new Map<string, number>();
  for (const r of rows) {
    if (r.metric !== metric) continue;
    if (opts?.code && r.code !== opts.code) continue;
    byDay.set(r.day, (byDay.get(r.day) ?? 0) + r.n);
  }
  return [...byDay.entries()].map(([day, n]) => ({ day, n })).sort((a, b) => a.day.localeCompare(b.day));
}
