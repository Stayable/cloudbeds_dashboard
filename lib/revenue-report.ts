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
  /** Room-nights whose room-rate transactions net to $0 — employee or
   *  complimentary stays. ALREADY INCLUDED in `otherBlocks` (Monica reports
   *  comps there, not as paid nights); carried separately only so the
   *  drill-down can explain the composition. Optional: absent on rows banked
   *  before 07/28/26 and in tests that predate it. */
  compNights?: number;
  /** Cloudbeds `roomBlockType` → room-nights over the period. Optional for the
   *  same reason. `out_of_service` maps to the OOO line; every other type rolls
   *  into Other blocks. */
  blocksByType?: Record<string, number>;
  /** Where the OOO figure came from: `cloudbeds` = summed `out_of_service`
   *  blocks; `override` = a `sellableOverrides` entry in config/properties.ts
   *  exceeded the Cloudbeds blocks (rooms unsellable but not blocked). Drives
   *  the report's source badge — an override is never blended silently. */
  oooSource?: "cloudbeds" | "override";
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
      compNights: (acc.compNights ?? 0) + (r.compNights ?? 0),
      blocksByType: mergeBlockTypes(acc.blocksByType, r.blocksByType),
      // An override anywhere in the range taints the whole range's OOO figure,
      // so the badge must survive the roll-up.
      oooSource: acc.oooSource === "override" || r.oooSource === "override" ? "override" : "cloudbeds",
    }),
    {
      transientNights: 0, leaseNights: 0, otherBlocks: 0, ooo: 0, inventory: 0,
      transientRev: 0, leaseRev: 0, compNights: 0, blocksByType: {}, oooSource: "cloudbeds",
    },
  );
}

/** Element-wise sum of two `roomBlockType` → room-nights maps. */
export function mergeBlockTypes(
  a: Record<string, number> | undefined,
  b: Record<string, number> | undefined,
): Record<string, number> {
  const out: Record<string, number> = { ...(a ?? {}) };
  for (const [type, nights] of Object.entries(b ?? {})) out[type] = (out[type] ?? 0) + nights;
  return out;
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
  /** Trailing daily occupancy (oldest→newest) for this property's sparkline.
   *  Only days with a real capture are included, so a cron gap is a gap in the
   *  line rather than a dip to zero. Empty when nothing is banked yet. */
  spark?: { day: string; pOcc: number }[];
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
  /** Latest stay_date whose figures are FINAL (its month closed and the
   *  restatement pass has stopped touching it). Days after this are
   *  preliminary: the room-revenue ledger keeps posting for several days, so a
   *  fresh day can move in either direction. Undefined = nothing final yet. */
  finalThrough?: string;
  /** Human-readable reasons any property's out-of-order figure came from a
   *  config override rather than Cloudbeds blocks. Empty = all Cloudbeds. */
  oooOverrideNotes?: string[];
  /** When the snapshot store was last written and what it last captured, so a
   *  reader can tell a quiet day from a broken cron. */
  freshness?: {
    lastBankedAt: string | null;
    latestCapturedDate: string | null;
    /** Properties with a real capture on `latestCapturedDate`. */
    propertiesOnLatest: number;
    /** ACTIVE properties we expect a capture from. Deliberately NOT
     *  `actual.length` — that only counts properties with a configured
     *  Cloudbeds key in the current environment, which made the stamp read
     *  "8 of 1" in local dev. */
    propertiesExpected: number;
  };
};
export const SOURCE_NOTE =
  "Cloudbeds-sourced. Transient nights/revenue and OOO from Cloudbeds; lease classified by rate plan. " +
  "Differs from Monica's Yardi-blended lease figures for Jan-Aug. Room Revenue excludes taxes and adjustments.";

/** Methodology confirmed by Monica Oco (Revenue Management) — 2026-07-24, with
 *  the rate-plan classification re-confirmed 2026-07-27 after a full audit of
 *  all 57 rate plans in use. Mirrors outputs/RevenueReportMethodology_Stayable_
 *  072426.md so the page, the Excel/PDF exports and the Teams card all state the
 *  same rules. Keep this the single source of that wording. */
export const METHODOLOGY: { heading: string; points: string[] }[] = [
  {
    heading: "Source & scope",
    points: [
      "Cloudbeds, read-only, aggregate metrics only — no guest data.",
      "Per property, per day. Figures key off the Cloudbeds service date.",
    ],
  },
  {
    heading: "Room Revenue",
    points: [
      'Transaction type "Room Rate" only — excludes the separate "Room Revenue" type, Items & Services, Tax, Cancellation, Fee, Adjustment and Payment.',
      "Cancelled reservations carry $0 room rate, so they drop out automatically.",
      "Exact for all past days (backfilled Jan–Jul 2026).",
    ],
  },
  {
    heading: "Lease vs. Transient",
    points: [
      'Lease = the "Monthly Lease" and "Weekly Lease" rate plans. Everything else is Transient.',
      'Confirmed by Monica 07/27: "Discounted Monthly Rate", "Discounted Weekly Rate" and "Employee Weekly Rate" are all TRANSIENT — employee stays count in transient nights and revenue because they are paid.',
      "2026 forward is 100% Cloudbeds — the Yardi-blended lease applied only to the 2024–2025 transition.",
    ],
  },
  {
    heading: "ADR & RevPAR",
    points: [
      "ADR = room rate only — excludes extra-person, early check-in, late check-out and cancellation/no-show fees.",
      "RevPAR = room revenue ÷ available room inventory.",
    ],
  },
  {
    heading: "Room-nights",
    points: [
      "Transient and lease nights are counted from the SAME query as revenue: one room-night per distinct reservation-room with a Room Rate transaction on that service date.",
      "Nothing depends on a reservation's current status, so a past day reproduces faithfully. The previous in-house-status count dropped guests who checked out before the morning capture — Davenport 07/26 read 7 transient nights instead of 18.",
      "Room-nights whose room rate nets to $0 (employee / complimentary) are reported under Other blocks, not as paid nights.",
    ],
  },
  {
    heading: "Out-of-Order vs. Other blocks",
    points: [
      "Out-of-Order (not sellable, e.g. floor repair) is reported separately from",
      "Other / grey blocks (contractor, complimentary/employee, room transfers — occupied but not paid), counted from yesterday onward.",
      "Composition is stored per Cloudbeds block type, so either line can be broken down.",
      "Where rooms are unsellable but not blocked in Cloudbeds, a config override supplies the figure and the report says so explicitly — currently Jacksonville North.",
    ],
  },
  {
    heading: "Preliminary vs. final",
    points: [
      "The room-revenue ledger keeps posting for days after a stay, so a recent day is a flash, not a close: one Davenport day moved +48% on re-query and another -1.7%.",
      "Every non-final day is re-derived nightly over a trailing 31-day window; a month freezes permanently five days after it closes.",
      "The first captured figure is retained, so the restatement can always be quantified.",
      "Inventory counts only days a property was in service, and reflects the room count in effect on each day rather than today's.",
    ],
  },
  {
    heading: "Periods",
    points: [
      "Actual: Yesterday · Month-to-date · Year-to-date, each with a Last-Year column and variance.",
      "On-the-Books: the next 7 days from today (the daily pickup view).",
    ],
  },
  {
    heading: "Accuracy",
    points: [
      "Year-to-date room revenue reconciles to Monica's manual report within ~0.1% portfolio-wide.",
      "Historical DAILY counts are point-in-time: Cloudbeds re-classifies past nights when a reservation's rate plan changes later, so a re-queried past day can drift. MTD/YTD and yesterday are accurate.",
    ],
  },
];
