// Report-specific lease/transient classification (Kyle's decision, 2026-07-22 —
// see .superpowers/sdd/briefs/task-3-brief.md). Deliberately NOT the same rule
// as lib/lease.ts `classifyRatePlan` (which treats weekly plans as lease for
// the in-house lease-mix widget). This report's Transient/Lease revenue split
// only recognizes genuine lease products; weekly-RATE promos are Transient.
// Verified live against Davenport 2026-07-19: reconciles Monica's exact split
// (Transient $492.05 / Lease $2,706.13).
const REPORT_LEASE_KEYWORDS = ["monthly lease", "weekly lease", "long term"];

/**
 * Classify a (possibly comma-joined multi-plan) rate-plan string for this
 * report. Lease iff any segment/keyword match contains "monthly lease",
 * "weekly lease", or "long term" (lease takes precedence on multi-plan
 * strings). Everything else — including "discounted weekly rate", "employee
 * weekly rate", bare "weekly rate", "base rate", "book direct" — is transient.
 */
export function classifyForReport(ratePlan: string): "lease" | "transient" {
  const s = (ratePlan ?? "").toLowerCase();
  return REPORT_LEASE_KEYWORDS.some((k) => s.includes(k)) ? "lease" : "transient";
}

export type RowInputs = {
  transientNights: number; leaseNights: number; otherBlocks: number; ooo: number;
  inventory: number; transientRev: number; leaseRev: number;
};
export type DerivedRow = RowInputs & {
  occupied: number; available: number; pOcc: number; pOoo: number; pAvail: number;
  roomRev: number; adrCombined: number; adrTransient: number; adrLease: number;
  revpar: number; occAdjLess20: number | null;
};
const div = (n: number, d: number) => (d ? n / d : 0);
export function derive(i: RowInputs, opts?: { keDays?: number }): DerivedRow {
  const occupied = i.transientNights + i.leaseNights + i.otherBlocks;
  const available = i.inventory - occupied - i.ooo;
  const roomRev = i.transientRev + i.leaseRev;
  const occAdjLess20 =
    opts?.keDays != null ? div(occupied, i.inventory - 20 * opts.keDays) : null;
  return {
    ...i, occupied, available, roomRev,
    pOcc: div(occupied, i.inventory), pOoo: div(i.ooo, i.inventory),
    pAvail: div(available, i.inventory),
    adrCombined: div(roomRev, occupied), adrTransient: div(i.transientRev, i.transientNights),
    adrLease: div(i.leaseRev, i.leaseNights), revpar: div(roomRev, i.inventory),
    occAdjLess20,
  };
}
export function variance(a: number | null, b: number | null): number | null {
  return a == null || b == null ? null : a - b;
}

export type PeriodBlock = { actual: DerivedRow; lastYear: DerivedRow | null };
export type PropertyActual = {
  code: string; name: string; yesterday: PeriodBlock; mtd: PeriodBlock; ytd: PeriodBlock;
};
export type OnTheBooksDay = { date: string; row: DerivedRow };
export type PropertyOnTheBooks = { code: string; name: string; days: OnTheBooksDay[] };
export type RevenueReport = {
  asOf: string; generatedEastern: string;
  actual: PropertyActual[]; onTheBooks: PropertyOnTheBooks[]; sourceNote: string;
};
export const SOURCE_NOTE =
  "Cloudbeds-sourced. Transient nights/revenue and OOO from Cloudbeds; lease classified by rate plan. " +
  "Differs from Monica's Yardi-blended lease figures for Jan-Aug. Room Revenue excludes taxes and adjustments.";
