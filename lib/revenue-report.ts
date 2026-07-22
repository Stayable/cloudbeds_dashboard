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

/** Element-wise sum of daily snapshot rows into a single RowInputs (e.g. for
 *  MTD/YTD rollups over stored days). Empty input → all-zero row. */
export function sumSnapshotRows(rows: RowInputs[]): RowInputs {
  return rows.reduce<RowInputs>(
    (acc, r) => ({
      transientNights: acc.transientNights + r.transientNights,
      leaseNights: acc.leaseNights + r.leaseNights,
      otherBlocks: acc.otherBlocks + r.otherBlocks,
      ooo: acc.ooo + r.ooo,
      inventory: acc.inventory + r.inventory,
      transientRev: acc.transientRev + r.transientRev,
      leaseRev: acc.leaseRev + r.leaseRev,
    }),
    { transientNights: 0, leaseNights: 0, otherBlocks: 0, ooo: 0, inventory: 0, transientRev: 0, leaseRev: 0 },
  );
}

export type PeriodBlock = {
  actual: DerivedRow;
  lastYear: DerivedRow | null;
  /** True when this block's ACTUAL counts (Occupied/Transient/Lease/Other
   *  blocks/OOO/Available/%s/ADRs) are not yet a complete period — i.e. the
   *  block sums stored count-snapshots that don't cover the whole range
   *  (revenue-only backfill, counts still accumulating forward from the daily
   *  cron). Revenue/RevPAR/Inventory remain correct and are never blanked.
   *  Undefined/false = complete (e.g. Yesterday, a live single-day pull, is
   *  always complete). Set by getRevenueReportInputs; renderers read it to
   *  decide whether to blank count-dependent cells — see isCountDependentRow. */
  countsPartial?: boolean;
};

/** The DerivedRow fields whose values are undermined when a period's counts
 *  are partial (see PeriodBlock.countsPartial) — everything that depends on
 *  Occupied/Transient/Lease/Other/OOO/Available nights. Kyle's decision,
 *  .superpowers/sdd/briefs/partial-counts-brief.md: renderers blank exactly
 *  these keys (display "—"/blank) when a block is partial; Inventory,
 *  Room Revenue, Transient/Lease REVENUE, and RevPar are always shown — they
 *  come from the exact revenue backfill, not accumulating counts. */
const COUNT_DEPENDENT_KEYS: ReadonlySet<string> = new Set([
  "occupied",
  "transientNights",
  "leaseNights",
  "otherBlocks",
  "ooo",
  "available",
  "pOcc",
  "pOoo",
  "pAvail",
  "occAdjLess20",
  "adrCombined",
  "adrTransient",
  "adrLease",
]);

/** True iff `key` (a DerivedRow field name) is one of the count-dependent
 *  cells that must be blanked when its PeriodBlock.countsPartial is true.
 *  Pure/no I/O — unit-tested directly; renderers key their metric-row tables
 *  off DerivedRow field names precisely so this stays unambiguous (two rows
 *  are both LABELED "Transient"/"Lease" — one nights, one revenue — so the
 *  blanking decision must key off the field, not the display label). */
export function isCountDependentRow(key: keyof DerivedRow): boolean {
  return COUNT_DEPENDENT_KEYS.has(key);
}
export type PropertyActual = {
  code: string; name: string; yesterday: PeriodBlock; mtd: PeriodBlock; ytd: PeriodBlock;
};
export type OnTheBooksDay = { date: string; row: DerivedRow };
export type PropertyOnTheBooks = { code: string; name: string; days: OnTheBooksDay[] };
export type RevenueReport = {
  asOf: string; generatedEastern: string;
  actual: PropertyActual[]; onTheBooks: PropertyOnTheBooks[]; sourceNote: string;
  /** Earliest banked report_daily_snapshot date (portfolio-wide), or undefined
   *  if no snapshots exist yet. MTD/YTD accumulate from stored snapshots since
   *  this date + the live "today" figure — see getRevenueReportInputs. */
  trackingSince?: string;
};
export const SOURCE_NOTE =
  "Cloudbeds-sourced. Transient nights/revenue and OOO from Cloudbeds; lease classified by rate plan. " +
  "Differs from Monica's Yardi-blended lease figures for Jan-Aug. Room Revenue excludes taxes and adjustments.";
