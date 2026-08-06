// Pure builder for the Operations "Leasing" section (§2). No I/O — the Neon
// reads live in lib/db.ts (getEliseFunnel / getElisePipeline), which return
// PII-free rollups synced from the EliseAI Snowflake data share. Here we shape
// them into a funnel + conversion rates + pipeline snapshot per property.
//
// Source: EVENTS_LEASING_RISE8 for the funnel — the view EliseAI's own Leasing
// Dashboard reads (Steph, 08/07/26), replacing PROSPECT_EVENTS_RISE8; and
// PROSPECTS_RISE8 status counts for the current-pipeline snapshot. The dedupe /
// interest / timezone rules that make our numbers match hers live in
// lib/snowflake.ts (LEASING_FUNNEL_SQL) — read that before changing a stage key.
import { PROPERTIES } from "@/config/properties";
import type { EliseFunnelRow, ElisePipelineRow } from "@/lib/db";

/** Ordered funnel stages, keyed by `EVENTS_LEASING_RISE8.EVENT_TYPE`.
 *
 *  Renamed wholesale on 08/07/26 — the old keys (`prospect`, `prospect_engaged`,
 *  `application_started`, `lease_completed`) belong to PROSPECT_EVENTS_RISE8 and
 *  counted different things. June 2026 measured both ways: 2,260 `prospect` vs
 *  1,863 deduped leads, and 373 `tour_booked` vs 223. Message-grain chatter
 *  (ai_sent, lead_replied, message_handoff …) is ignored, as before. */
/** Stage keys by ROLE, so no consumer hardcodes a raw Elise event name.
 *
 *  The 08/07/26 rename found the same seven literals copied across
 *  LeasingSection, ops-pdf-leasing, ops-insights and this file — and because the
 *  tests for those layers build their own stage arrays, every one of them would
 *  have rendered ZERO in production with a green suite. Reference `STAGE.leads`,
 *  never `"state"`. */
export const STAGE = {
  leads: "state",
  engaged: "first_lead_engagement",
  toursBooked: "tour_booked",
  toursAttended: "tour_attended",
  appsStarted: "lease_applied",
  appsApproved: "application_approved",
  leased: "lease_signed",
} as const;

export const FUNNEL_STAGES = [
  { key: STAGE.leads, label: "Leads" },
  { key: STAGE.engaged, label: "Engaged" },
  { key: STAGE.toursBooked, label: "Tours booked" },
  { key: STAGE.toursAttended, label: "Tours attended" },
  { key: STAGE.appsStarted, label: "Apps started" },
  { key: STAGE.appsApproved, label: "Apps approved" },
  { key: STAGE.leased, label: "Leased" },
] as const;

/** EVENTS_LEASING_RISE8 has no cancellation event, so this one row is still
 *  synced from PROSPECT_EVENTS_RISE8 (see lib/snowflake.ts). Kept rather than
 *  dropped so /ops §2 does not silently lose its Cancelled figure — but it is a
 *  DIFFERENT source from the seven stages above and is not deduped the same way,
 *  so do not compute a rate against them. */
const CANCELLED_EVENT = "prospect_canceled";

/** MEASURED 08/07/26 and worth knowing before trusting the last two stages:
 *  in EVENTS_LEASING_RISE8, `application_approved` and `lease_signed` are
 *  ALWAYS emitted together — 671 / 671 rows and 667 / 667 distinct sessions
 *  all-time, and 146 / 146 in June. `lease_signed` therefore carries no
 *  information `application_approved` does not, and any approved→leased
 *  conversion would read 100% by construction. Deliberately not computed. */
export type Stage = { key: string; label: string; n: number };
export type PipelineStatus = { status: string; n: number };
export type LeasingView = {
  key: string; // "ALL" or property code
  label: string; // "All properties" or property name
  stages: Stage[]; // ordered funnel stages with counts
  cancelled: number; // prospect_canceled in the window
  leadToTour: number | null; // tour_booked / leads (%)
  /** lease_signed / tour_BOOKED (%). Deliberately NOT over tour_attended:
   *  Elise under-records attendance, so a rate over attended exceeded 100% —
   *  148.4% was once rendering live. Booked is the reliable denominator, and the
   *  problem did NOT go away with the new source: all-time EVENTS_LEASING reads
   *  1,660 booked against 566 attended (34%). */
  tourToLease: number | null;
  leadToLease: number | null; // lease_signed / leads (%)
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
  const leads = acc.counts.get(STAGE.leads) ?? 0;
  const toursBooked = acc.counts.get(STAGE.toursBooked) ?? 0;
  const toursAttended = acc.counts.get(STAGE.toursAttended) ?? 0;
  const leased = acc.counts.get(STAGE.leased) ?? 0;
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

  const LEADS_KEY = STAGE.leads;
  const perProperty = [...byCode.entries()]
    .map(([code, acc]) => viewFrom(code, nameForCode(code), acc))
    .sort((a, b) => {
      const la = a.stages.find((s) => s.key === LEADS_KEY)!.n;
      const lb = b.stages.find((s) => s.key === LEADS_KEY)!.n;
      return lb - la || a.label.localeCompare(b.label);
    });

  return [viewFrom("ALL", "All properties", all), ...perProperty];
}
