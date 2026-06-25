// Evictions view model. Pure transform over the pre-aggregated Smartsheet
// "Evictions Metrics" sheet (CLAUDE.md data source) — NO network here, so it is
// unit-testable. The sheet is a matrix: one row per metric (keyed by the
// "Primary Column" label) × one column per property + a portfolio "Total"
// column. We read those already-aggregated values rather than recomputing, so
// the dashboard stays in lockstep with the sheet (the canonical source).
//
// Counts only — no tenant names or case detail ever pass through here.

import { PROPERTIES } from "@/config/properties";

// Primary-Column row labels → the four metrics we surface. These are the EXACT
// labels in the sheet (verified 2026-06-26). The sheet's own vocabulary differs
// from ours: its "Total" row = all currently-open cases (sum of every
// non-closed status), and "Grand Total" = open + closed all-time. They are
// internally consistent: open + closed = total.
export const ROW_LABELS = {
  open: "Total", // all non-closed statuses (Active + Inactive + Notice Sent + Ready to File…)
  closed: "Closed",
  total: "Grand Total", // open + closed, all-time
  avgDays: "Ave days (MTD)",
} as const;

// The portfolio (all-property) column title in the sheet.
const TOTAL_COLUMN = "Total";
// The row-identity column.
const PRIMARY_COLUMN = "Primary Column";

export type EvictionsMetrics = {
  open: number;
  closed: number;
  total: number;
  avgDays: number | null; // "Ave days (MTD)": complaint filed → completion, MTD
  avgDaysToFile: number | null; // app-computed: notice posted → complaint filed, all-time
};

export type EvictionsView = { key: string; label: string } & EvictionsMetrics;

/** Parse a sheet cell to a count (commas stripped; blank/non-numeric → 0). */
function num(v: string | undefined): number {
  if (!v) return 0;
  const n = Number(v.replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

/** Parse an average-days cell; "N/A"/blank/non-numeric → null. */
function avg(v: string | undefined): number | null {
  if (!v) return null;
  const n = Number(v.replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

/**
 * Map each property to its column title in the sheet by matching the leading
 * business ID embedded in the title (e.g. "44199 Davenport" → property 44199).
 * Robust to label drift ("Kiss East" vs "Kissimmee East").
 */
function propertyColumnTitle(columnTitles: string[], propertyId: string): string | null {
  for (const title of columnTitles) {
    const lead = title.trim().match(/^(\d+)/)?.[1];
    if (lead === propertyId) return title;
  }
  return null;
}

// --- Days to file (notice posted → complaint filed) -------------------------
// Computed by the app from the Closed case sheet, NOT the metrics rollup: the
// rollup's "Ave days (MTD)" is filing→completion, and a true days-to-file
// (notice→complaint) row can't be added as a live formula without a Smartsheet
// cross-sheet reference (UI-only). We read just Property + the two date columns
// (no tenant names) and average (complaint − notice) per property, all-time.

const MS_PER_DAY = 86_400_000;

export type ClosedCaseDates = {
  property: string; // e.g. "44199 Davenport"
  noticePosted: string;
  complaintFiled: string;
};

/** Mean days from notice posted → complaint filed, keyed "ALL" + per property
 *  business ID. Rows missing/!invalid either date, or with a negative span, are
 *  skipped. Returns null for any key with no valid rows. */
export function computeDaysToFile(cases: ClosedCaseDates[]): Map<string, number | null> {
  const acc = new Map<string, { sum: number; n: number }>();
  const add = (key: string, days: number) => {
    const a = acc.get(key) ?? { sum: 0, n: 0 };
    a.sum += days;
    a.n += 1;
    acc.set(key, a);
  };

  for (const c of cases) {
    const np = Date.parse(c.noticePosted);
    const cf = Date.parse(c.complaintFiled);
    if (!Number.isFinite(np) || !Number.isFinite(cf)) continue;
    const days = Math.round((cf - np) / MS_PER_DAY);
    if (days < 0) continue; // data error (filed before notice)
    const id = c.property?.trim().match(/^(\d+)/)?.[1];
    add("ALL", days);
    if (id) add(id, days);
  }

  const out = new Map<string, number | null>();
  for (const [key, { sum, n }] of acc) out.set(key, n > 0 ? sum / n : null);
  return out;
}

/**
 * Build the property selector views (All + one per property) from the flattened
 * metrics sheet. `rows` is the output of `rowsByTitle`; `columnTitles` is the
 * sheet's column titles (to resolve each property's column). `daysToFile` is the
 * app-computed notice→filing average keyed "ALL"/business-ID (optional).
 */
export function buildEvictionsViews(
  rows: Record<string, string>[],
  columnTitles: string[],
  daysToFile?: Map<string, number | null>,
): EvictionsView[] {
  // Index metric rows by their Primary-Column label.
  const byLabel = new Map<string, Record<string, string>>();
  for (const r of rows) {
    const label = r[PRIMARY_COLUMN]?.trim();
    if (label) byLabel.set(label, r);
  }

  const openRow = byLabel.get(ROW_LABELS.open);
  const closedRow = byLabel.get(ROW_LABELS.closed);
  const totalRow = byLabel.get(ROW_LABELS.total);
  const avgRow = byLabel.get(ROW_LABELS.avgDays);

  const metricsForColumn = (col: string, key: string): EvictionsMetrics => ({
    open: num(openRow?.[col]),
    closed: num(closedRow?.[col]),
    total: num(totalRow?.[col]),
    avgDays: avg(avgRow?.[col]),
    avgDaysToFile: daysToFile?.get(key) ?? null,
  });

  const views: EvictionsView[] = [
    { key: "ALL", label: "All properties", ...metricsForColumn(TOTAL_COLUMN, "ALL") },
  ];

  for (const p of PROPERTIES) {
    const col = propertyColumnTitle(columnTitles, p.id);
    if (!col) continue; // property not represented in the sheet
    views.push({ key: p.id, label: p.name, ...metricsForColumn(col, p.id) });
  }

  return views;
}
