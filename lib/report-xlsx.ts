// Excel renderer for the daily occupancy/revenue report (Monica's layout).
// Consumes only lib/revenue-report.ts model types -- no network, no fs.
import ExcelJS from "exceljs";
import { isCountDependentRow, METHODOLOGY } from "./revenue-report";
import type {
  RevenueReport,
  PropertyActual,
  PropertyOnTheBooks,
  PeriodBlock,
  DerivedRow,
} from "./revenue-report";

const FONT = "Arial";
const TITLE_BAR_FILL = "FF0F1E33";
const GROUP_HEADER_FILL = "FF1F3864";
const LABEL_ROW_FILL = "FFD9E1F2";
const BANNER_FILL = "FFFFF2CC";
const RED_FILL = "FFF4B0B0";
const ORANGE_FILL = "FFFCE4B6";
const PURPLE_FONT = "FF7030A0";

const BANNER_TEXT =
  "SAMPLE / Cloudbeds-sourced - differs from Monica's Yardi-blended lease for Jan-Aug. " +
  "MTD/YTD counts accumulate from daily snapshots.";

const COUNT_FMT = "#,##0";
const CURRENCY_FMT = "$#,##0.00;[Red]($#,##0.00)";
const PCT_FMT = "0.0%";

const THIN_GREY_BORDER: Partial<ExcelJS.Border> = {
  style: "thin",
  color: { argb: "FFBFBFBF" },
};

type MetricRow = {
  label: string;
  indent?: boolean;
  fmt: string;
  key: keyof DerivedRow;
  get: (row: DerivedRow) => number | null;
};

const METRIC_ROWS: MetricRow[] = [
  { label: "Occupied", fmt: COUNT_FMT, key: "occupied", get: (r) => r.occupied },
  { label: "Transient", indent: true, fmt: COUNT_FMT, key: "transientNights", get: (r) => r.transientNights },
  { label: "Lease", indent: true, fmt: COUNT_FMT, key: "leaseNights", get: (r) => r.leaseNights },
  { label: "Other blocks", fmt: COUNT_FMT, key: "otherBlocks", get: (r) => r.otherBlocks },
  { label: "Out-of-Order", fmt: COUNT_FMT, key: "ooo", get: (r) => r.ooo },
  { label: "Available", fmt: COUNT_FMT, key: "available", get: (r) => r.available },
  { label: "Inventory", fmt: COUNT_FMT, key: "inventory", get: (r) => r.inventory },
  { label: "% Occupied", fmt: PCT_FMT, key: "pOcc", get: (r) => r.pOcc },
  { label: "% Out-of-Order", fmt: PCT_FMT, key: "pOoo", get: (r) => r.pOoo },
  { label: "% Available", fmt: PCT_FMT, key: "pAvail", get: (r) => r.pAvail },
  {
    label: "% Occupied Adjusted (less 20 rms)",
    fmt: PCT_FMT,
    key: "occAdjLess20",
    get: (r) => r.occAdjLess20,
  },
  { label: "Room Revenue", fmt: CURRENCY_FMT, key: "roomRev", get: (r) => r.roomRev },
  { label: "Transient", indent: true, fmt: CURRENCY_FMT, key: "transientRev", get: (r) => r.transientRev },
  { label: "Lease", indent: true, fmt: CURRENCY_FMT, key: "leaseRev", get: (r) => r.leaseRev },
  { label: "ADR Combined", fmt: CURRENCY_FMT, key: "adrCombined", get: (r) => r.adrCombined },
  { label: "ADR Transient", indent: true, fmt: CURRENCY_FMT, key: "adrTransient", get: (r) => r.adrTransient },
  { label: "ADR Lease", indent: true, fmt: CURRENCY_FMT, key: "adrLease", get: (r) => r.adrLease },
  { label: "RevPar", fmt: CURRENCY_FMT, key: "revpar", get: (r) => r.revpar },
];

function applyBanner(ws: ExcelJS.Worksheet, colCount: number) {
  ws.mergeCells(1, 1, 1, colCount);
  const cell = ws.getCell(1, 1);
  cell.value = BANNER_TEXT;
  cell.font = { name: FONT, bold: true };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BANNER_FILL } };
  cell.alignment = { vertical: "middle", wrapText: true };
  ws.getRow(1).height = 30;
}

function applyPageSetup(ws: ExcelJS.Worksheet) {
  ws.pageSetup.orientation = "landscape";
  ws.pageSetup.fitToPage = true;
  ws.pageSetup.fitToWidth = 1;
  ws.pageSetup.fitToHeight = 0;
}

function styledCell(
  ws: ExcelJS.Worksheet,
  row: number,
  col: number,
  value: unknown,
  opts: {
    fmt?: string;
    bold?: boolean;
    italic?: boolean;
    fill?: string;
    fontColor?: string;
    align?: ExcelJS.Alignment["horizontal"];
    border?: boolean;
  } = {}
) {
  const cell = ws.getCell(row, col);
  cell.value = value as ExcelJS.CellValue;
  cell.font = {
    name: FONT,
    bold: !!opts.bold,
    italic: !!opts.italic,
    color: opts.fontColor ? { argb: opts.fontColor } : undefined,
  };
  if (opts.fmt) cell.numFmt = opts.fmt;
  if (opts.fill) {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: opts.fill } };
  }
  cell.alignment = { horizontal: opts.align ?? "left", vertical: "middle" };
  if (opts.border) {
    cell.border = {
      top: THIN_GREY_BORDER,
      bottom: THIN_GREY_BORDER,
      left: THIN_GREY_BORDER,
      right: THIN_GREY_BORDER,
    };
  }
  return cell;
}

/**
 * Render one property's block onto the ACTUAL sheet: title bar, group headers
 * (Yesterday / Month-to-date / Year-to-date), sub-labels (Actual / Last Year /
 * Variance), and metric rows. Returns the next free row.
 */
function renderActualBlock(
  ws: ExcelJS.Worksheet,
  startRow: number,
  property: PropertyActual
): number {
  const totalCols = 1 + 3 * 3; // label col + 3 groups x 3 cols
  let row = startRow;

  // Title bar
  ws.mergeCells(row, 1, row, totalCols);
  styledCell(ws, row, 1, property.name, {
    bold: true,
    fill: TITLE_BAR_FILL,
    fontColor: "FFFFFFFF",
    align: "left",
  });
  ws.getRow(row).height = 20;
  row++;

  // Group header row: Yesterday / Month-to-date / Year-to-date
  const groups: Array<{ label: string; block: PeriodBlock }> = [
    { label: "Yesterday", block: property.yesterday },
    { label: "Month-to-date", block: property.mtd },
    { label: "Year-to-date", block: property.ytd },
  ];
  styledCell(ws, row, 1, "", { fill: GROUP_HEADER_FILL });
  groups.forEach((g, gi) => {
    const startCol = 2 + gi * 3;
    ws.mergeCells(row, startCol, row, startCol + 2);
    styledCell(ws, row, startCol, g.label, {
      bold: true,
      fill: GROUP_HEADER_FILL,
      fontColor: "FFFFFFFF",
      align: "center",
    });
  });
  row++;

  // Date/label row: "History" then Actual / Last Year / Variance per group
  styledCell(ws, row, 1, "History", { bold: true, fill: LABEL_ROW_FILL });
  groups.forEach((_, gi) => {
    const startCol = 2 + gi * 3;
    ["Actual", "Last Year", "Variance"].forEach((label, li) => {
      styledCell(ws, row, startCol + li, label, {
        bold: true,
        fill: LABEL_ROW_FILL,
        align: "center",
      });
    });
  });
  row++;

  // Metric rows
  for (const metric of METRIC_ROWS) {
    // Skip the KE-only adjusted row when not applicable to this property/period.
    const anyAdjusted = groups.some((g) => g.block.actual.occAdjLess20 != null);
    if (metric.label === "% Occupied Adjusted (less 20 rms)" && !anyAdjusted) {
      continue;
    }

    styledCell(ws, row, 1, metric.indent ? `  ${metric.label}` : metric.label, {
      italic: !!metric.indent,
      border: true,
    });

    groups.forEach((g, gi) => {
      const startCol = 2 + gi * 3;
      // Kyle's decision, partial-counts-brief.md: a count-dependent MTD/YTD
      // cell whose counts aren't a complete period yet renders as a genuinely
      // blank cell (empty string, NOT 0 / "$0.00") — LY stays intact (it's a
      // complete historical period), so only Actual/Variance are blanked.
      const blanked = g.block.countsPartial === true && isCountDependentRow(metric.key);
      const rawActualVal = metric.get(g.block.actual);
      const actualVal: number | string | null = blanked ? "" : rawActualVal;
      const lastYearVal = g.block.lastYear ? metric.get(g.block.lastYear) : null;
      const varianceVal: number | string | null = blanked
        ? ""
        : rawActualVal == null || lastYearVal == null
          ? null
          : rawActualVal - lastYearVal;

      styledCell(ws, row, startCol, actualVal, {
        fmt: blanked ? undefined : metric.fmt,
        align: "right",
        border: true,
      });
      styledCell(ws, row, startCol + 1, lastYearVal, {
        fmt: metric.fmt,
        align: "right",
        border: true,
      });
      styledCell(ws, row, startCol + 2, varianceVal, {
        fmt: blanked ? undefined : metric.fmt,
        align: "right",
        border: true,
      });
    });
    row++;
  }

  row++; // blank spacer row between property blocks
  return row;
}

/**
 * Render one property's block onto the ON-THE-BOOKS sheet: title bar, a
 * header row of day-of labels, and the metric rows (no LY/variance).
 */
function renderOnTheBooksBlock(
  ws: ExcelJS.Worksheet,
  startRow: number,
  property: PropertyOnTheBooks
): number {
  const dayCount = property.days.length;
  const totalCols = 1 + dayCount;
  let row = startRow;

  ws.mergeCells(row, 1, row, Math.max(totalCols, 2));
  styledCell(ws, row, 1, property.name, {
    bold: true,
    fill: TITLE_BAR_FILL,
    fontColor: "FFFFFFFF",
    align: "left",
  });
  ws.getRow(row).height = 20;
  row++;

  // Header row: day labels
  styledCell(ws, row, 1, "Date", { bold: true, fill: LABEL_ROW_FILL });
  property.days.forEach((d, di) => {
    styledCell(ws, row, 2 + di, d.date, {
      bold: true,
      fill: LABEL_ROW_FILL,
      align: "center",
    });
  });
  row++;

  const anyAdjusted = property.days.some((d) => d.row.occAdjLess20 != null);

  for (const metric of METRIC_ROWS) {
    if (metric.label === "% Occupied Adjusted (less 20 rms)" && !anyAdjusted) {
      continue;
    }
    styledCell(ws, row, 1, metric.indent ? `  ${metric.label}` : metric.label, {
      italic: !!metric.indent,
      border: true,
    });
    property.days.forEach((d, di) => {
      const val = metric.get(d.row);
      styledCell(ws, row, 2 + di, val, {
        fmt: metric.fmt,
        align: "right",
        border: true,
      });
    });
    row++;
  }

  row++;
  return row;
}

function addAvailabilityConditionalFormatting(
  ws: ExcelJS.Worksheet,
  ranges: string[]
) {
  if (ranges.length === 0) return;
  // exceljs's `CellIsOperators` TS union only lists 'equal' | 'greaterThan' |
  // 'lessThan' | 'between', but the OOXML cellIs spec (and exceljs's runtime
  // XML writer) also accepts 'lessThanOrEqual' / 'greaterThanOrEqual' -- the
  // operator string is written through as-is. Cast to bypass the incomplete
  // type union while keeping the correct runtime operator.
  ws.addConditionalFormatting({
    ref: ranges.join(" "),
    rules: [
      {
        type: "cellIs",
        operator: "lessThanOrEqual",
        formulae: [0.15],
        priority: 1,
        style: {
          fill: { type: "pattern", pattern: "solid", fgColor: { argb: RED_FILL } },
        },
      },
      {
        type: "cellIs",
        operator: "between",
        formulae: [0.150001, 0.2],
        priority: 2,
        style: {
          fill: { type: "pattern", pattern: "solid", fgColor: { argb: ORANGE_FILL } },
        },
      },
      {
        type: "cellIs",
        operator: "greaterThanOrEqual",
        formulae: [0.4],
        priority: 3,
        style: {
          font: { bold: true, color: { argb: PURPLE_FONT } },
        },
      },
    ] as unknown as ExcelJS.ConditionalFormattingRule[],
  });
}

export async function renderReportXlsx(report: RevenueReport): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Cloudbeds Dashboard";
  wb.created = new Date();

  // --- ACTUAL sheet ---
  const actualCols = 1 + 3 * 3;
  const wsActual = wb.addWorksheet("ACTUAL");
  applyBanner(wsActual, actualCols);
  applyPageSetup(wsActual);

  let row = 2;
  const actualPctAvailRanges: string[] = [];
  for (const property of report.actual) {
    const blockStart = row;
    row = renderActualBlock(wsActual, row, property);
    // Locate the "% Available" row for conditional formatting ranges (Actual col only
    // per group, i.e. columns 2, 5, 8 -- but we highlight the whole Actual/LY/Variance
    // trio's Actual cell set for simplicity: all numeric % Available cells).
    const pctAvailRowIndex = findMetricRowIndex(property, "% Available");
    if (pctAvailRowIndex != null) {
      const pctAvailRow = blockStart + 3 + pctAvailRowIndex; // title bar + group header + label row, then metric rows
      // groups occupy cols 2..10 (3 groups x 3 cols); all of them can hold % Available values
      actualPctAvailRanges.push(`B${pctAvailRow}:J${pctAvailRow}`);
    }
  }
  addAvailabilityConditionalFormatting(wsActual, actualPctAvailRanges);
  wsActual.columns.forEach((col, idx) => {
    col.width = idx === 0 ? 34 : 14;
  });

  // --- ON-THE-BOOKS sheet ---
  const wsOtb = wb.addWorksheet("ON-THE-BOOKS");
  const maxDays = Math.max(1, ...report.onTheBooks.map((p) => p.days.length));
  applyBanner(wsOtb, 1 + maxDays);
  applyPageSetup(wsOtb);

  row = 2;
  const otbPctAvailRanges: string[] = [];
  for (const property of report.onTheBooks) {
    const blockStart = row;
    row = renderOnTheBooksBlock(wsOtb, row, property);
    const pctAvailRowIndex = findMetricRowIndexOtb(property, "% Available");
    if (pctAvailRowIndex != null) {
      const pctAvailRow = blockStart + 2 + pctAvailRowIndex;
      const lastCol = colLetter(1 + property.days.length);
      otbPctAvailRanges.push(`B${pctAvailRow}:${lastCol}${pctAvailRow}`);
    }
  }
  addAvailabilityConditionalFormatting(wsOtb, otbPctAvailRanges);
  wsOtb.columns.forEach((col, idx) => {
    col.width = idx === 0 ? 34 : 14;
  });

  // --- Notes & Sources sheet ---
  const wsNotes = wb.addWorksheet("Notes & Sources");
  wsNotes.getColumn(1).width = 100;
  let nrow = 1;
  styledCell(wsNotes, nrow, 1, BANNER_TEXT, {
    bold: true,
    fill: BANNER_FILL,
  });
  wsNotes.getRow(nrow).height = 30;
  wsNotes.getCell(nrow, 1).alignment = { wrapText: true, vertical: "middle" };
  nrow += 2;

  styledCell(wsNotes, nrow, 1, report.sourceNote, {});
  wsNotes.getCell(nrow, 1).alignment = { wrapText: true, vertical: "top" };
  nrow += 2;

  const { trackingSince, freshness } = report;
  if (trackingSince) {
    styledCell(
      wsNotes,
      nrow,
      1,
      `MTD/YTD accumulate from daily snapshots starting ${trackingSince}.`,
      {}
    );
    nrow += 2;
  }

  // Freshness — same stamp the page shows, so a stale export is not mistaken
  // for a quiet day once the file is off the dashboard and in an inbox.
  if (freshness?.latestCapturedDate) {
    const current = freshness.latestCapturedDate >= report.asOf;
    styledCell(wsNotes, nrow, 1, "Data freshness:", { bold: true });
    nrow++;
    styledCell(
      wsNotes,
      nrow,
      1,
      `Last captured day ${freshness.latestCapturedDate} (${freshness.propertiesOnLatest} of ` +
        `${freshness.propertiesExpected} properties). Snapshot last written ${freshness.lastBankedAt ?? "unknown"}.` +
        (current ? "" : ` NOTE: this report is for ${report.asOf}; the daily capture had not landed.`),
      current ? {} : { bold: true }
    );
    wsNotes.getCell(nrow, 1).alignment = { wrapText: true, vertical: "top" };
    nrow += 2;
  }

  // Monica-confirmed methodology (lib/revenue-report METHODOLOGY) — identical
  // wording on the page, in the PDF and in the Teams card.
  styledCell(wsNotes, nrow, 1, "Methodology (confirmed by Monica Oco, Revenue Management)", { bold: true });
  nrow += 1;
  for (const sec of METHODOLOGY) {
    styledCell(wsNotes, nrow, 1, sec.heading, { bold: true });
    nrow++;
    for (const pt of sec.points) {
      styledCell(wsNotes, nrow, 1, `\u2022 ${pt}`, {});
      wsNotes.getCell(nrow, 1).alignment = { wrapText: true, vertical: "top" };
      nrow++;
    }
    nrow++;
  }

  styledCell(wsNotes, nrow, 1, "Availability legend:", { bold: true });
  nrow++;
  styledCell(wsNotes, nrow, 1, "Orange fill: % Available <= 20%", {
    fill: ORANGE_FILL,
  });
  nrow++;
  styledCell(wsNotes, nrow, 1, "Red fill: % Available <= 15%", {
    fill: RED_FILL,
  });
  nrow++;
  styledCell(wsNotes, nrow, 1, "Purple bold: % Available >= 40%", {
    fontColor: PURPLE_FONT,
    bold: true,
  });

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer as ArrayBuffer);
}

function findMetricRowIndex(property: PropertyActual, label: string): number | null {
  const anyAdjusted =
    property.yesterday.actual.occAdjLess20 != null ||
    property.mtd.actual.occAdjLess20 != null ||
    property.ytd.actual.occAdjLess20 != null;
  let idx = 0;
  for (const metric of METRIC_ROWS) {
    if (metric.label === "% Occupied Adjusted (less 20 rms)" && !anyAdjusted) continue;
    if (metric.label === label) return idx;
    idx++;
  }
  return null;
}

function findMetricRowIndexOtb(
  property: PropertyOnTheBooks,
  label: string
): number | null {
  const anyAdjusted = property.days.some((d) => d.row.occAdjLess20 != null);
  let idx = 0;
  for (const metric of METRIC_ROWS) {
    if (metric.label === "% Occupied Adjusted (less 20 rms)" && !anyAdjusted) continue;
    if (metric.label === label) return idx;
    idx++;
  }
  return null;
}

function colLetter(col: number): string {
  let letter = "";
  let n = col;
  while (n > 0) {
    const rem = (n - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    n = Math.floor((n - 1) / 26);
  }
  return letter;
}
