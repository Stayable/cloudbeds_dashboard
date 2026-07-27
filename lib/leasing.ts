// Pure builder for the Operations "Leasing" section (§2). No I/O — the Neon
// reads live in lib/db.ts (getEliseFunnel / getElisePipeline), which return
// PII-free rollups synced from the EliseAI Snowflake data share. Here we shape
// them into a funnel + conversion rates + pipeline snapshot per property.
//
// Source: PROSPECT_EVENTS_RISE8 (activity-windowed by event date) for the
// funnel; PROSPECTS_RISE8 status counts for the current-pipeline snapshot.
// See memory `elise-data-share` for the event-type vocabulary.
import { PROPERTIES } from "@/config/properties";
import type { EliseFunnelRow, ElisePipelineRow } from "@/lib/db";

/** Ordered funnel stages mapped to PROSPECT_EVENTS `EVENT_TYPE` values. We use
 *  `lease_completed` (not `lease_started`, which Elise barely populates) as the
 *  lease milestone. Message-grain chatter (ai_sent, opt_out_*, etc.) is ignored. */
export const FUNNEL_STAGES = [
  { key: "prospect", label: "Leads" },
  { key: "prospect_engaged", label: "Engaged" },
  { key: "tour_booked", label: "Tours booked" },
  { key: "tour_attended", label: "Tours attended" },
  { key: "application_started", label: "Apps started" },
  { key: "application_approved", label: "Apps approved" },
  { key: "lease_completed", label: "Leased" },
] as const;

const CANCELLED_EVENT = "prospect_canceled";

export type Stage = { key: string; label: string; n: number };
export type PipelineStatus = { status: string; n: number };
export type LeasingView = {
  key: string; // "ALL" or property code
  label: string; // "All properties" or property name
  stages: Stage[]; // ordered funnel stages with counts
  cancelled: number; // prospect_canceled in the window
  leadToTour: number | null; // tour_booked / leads (%)
  /** lease_completed / tour_BOOKED (%). Deliberately NOT over tour_attended:
   *  Elise under-records attendance (last-30 portfolio: 399 booked, 93
   *  attended, 138 leased), so a rate over attended exceeded 100% — 148.4% was
   *  rendering live. Booked is the reliable denominator. */
  tourToLease: number | null;
  leadToLease: number | null; // lease_completed / leads (%)
  /** tour_attended / tour_booked (%) — exposes how much attendance data is
   *  actually captured, so the gap is visible instead of distorting a metric. */
  tourAttendanceRecorded: number | null;
  pipeline: PipelineStatus[]; // current status snapshot
};

/** 1-decimal percentage of a/b, or null when b <= 0. */
export function pct(a: number, b: number): number | null {
  if (!b || b <= 0) return null;
  return Math.round((a / b) * 1000) / 10;
}

const nameForCode = (code: string) => PROPERTIES.find((p) => p.code === code)?.name ?? code;

type Acc = { counts: Map<string, number>; pipeline: Map<string, number> };

function emptyAcc(): Acc {
  return { counts: new Map(), pipeline: new Map() };
}

function stagesFrom(counts: Map<string, number>): Stage[] {
  return FUNNEL_STAGES.map((s) => ({ key: s.key, label: s.label, n: counts.get(s.key) ?? 0 }));
}

function viewFrom(key: string, label: string, acc: Acc): LeasingView {
  const stages = stagesFrom(acc.counts);
  const leads = acc.counts.get("prospect") ?? 0;
  const toursBooked = acc.counts.get("tour_booked") ?? 0;
  const toursAttended = acc.counts.get("tour_attended") ?? 0;
  const leased = acc.counts.get("lease_completed") ?? 0;
  const pipeline = [...acc.pipeline.entries()]
    .map(([status, n]) => ({ status, n }))
    .sort((a, b) => b.n - a.n || a.status.localeCompare(b.status));
  return {
    key,
    label,
    stages,
    cancelled: acc.counts.get(CANCELLED_EVENT) ?? 0,
    leadToTour: pct(toursBooked, leads),
    tourToLease: pct(leased, toursBooked),
    leadToLease: pct(leased, leads),
    tourAttendanceRecorded: pct(toursAttended, toursBooked),
    pipeline,
  };
}

/** Build [ALL, ...perProperty] leasing views from already-windowed funnel rows
 *  plus the current pipeline snapshot. Per-property views are ordered by leads
 *  desc; a property with only pipeline data (no funnel rows) still appears.
 *  Returns [] when there is no data at all. */
export function buildLeasingViews(
  funnel: EliseFunnelRow[],
  pipeline: ElisePipelineRow[],
): LeasingView[] {
  if (funnel.length === 0 && pipeline.length === 0) return [];

  const byCode = new Map<string, Acc>();
  const all = emptyAcc();
  const ensure = (code: string): Acc => {
    let a = byCode.get(code);
    if (!a) { a = emptyAcc(); byCode.set(code, a); }
    return a;
  };
  const add = (m: Map<string, number>, key: string, n: number) => m.set(key, (m.get(key) ?? 0) + n);

  for (const r of funnel) {
    add(ensure(r.code).counts, r.eventType, r.n);
    add(all.counts, r.eventType, r.n);
  }
  for (const p of pipeline) {
    add(ensure(p.code).pipeline, p.status, p.n);
    add(all.pipeline, p.status, p.n);
  }

  const perProperty = [...byCode.entries()]
    .map(([code, acc]) => viewFrom(code, nameForCode(code), acc))
    .sort((a, b) => {
      const la = a.stages.find((s) => s.key === "prospect")!.n;
      const lb = b.stages.find((s) => s.key === "prospect")!.n;
      return lb - la || a.label.localeCompare(b.label);
    });

  return [viewFrom("ALL", "All properties", all), ...perProperty];
}
