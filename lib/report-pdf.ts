// PDF renderer for the daily occupancy/revenue report.
//
// This is a deliberate reproduction of Monica Oco's published daily PDF
// ("Occupancy Report as of <Month D, YYYY>"), because it replaces her manual
// post and the two have to be readable side by side. Verified against her
// 2026-07-27 file, which is laid out as:
//   pages 1-4  ACTUAL, two properties per page, in REPORT_PROPERTY_ORDER
//   page  5    Sources / Notes / Legend
//   pages 6-9  ON-THE-BOOKS, the same two-per-page order, 7 forward days
// Each ACTUAL table has a two-row header: the period name over
// value/Last Year/Variance, then the concrete date range under it.
//
// Consumes only lib/revenue-report.ts model types -- no network, no fs.
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import {
  isCountDependentRow,
  METHODOLOGY,
  periodHeaderLabels,
  weekdayName,
  fmtDayHeader,
} from "./revenue-report";
import type {
  RevenueReport,
  PropertyActual,
  PropertyOnTheBooks,
  PeriodBlock,
  DerivedRow,
} from "./revenue-report";

const NAVY = [31, 56, 100] as [number, number, number];
const RED = [244, 176, 176] as [number, number, number];
const ORANGE = [252, 228, 182] as [number, number, number];
const PURPLE = [112, 48, 160] as [number, number, number];

const PCT_AVAILABLE_LABEL = "% Available";

/** A4 landscape, points. Her report is the same size and orientation. */
const PAGE_W = 842;
const PAGE_H = 595;
const MARGIN_X = 20;
const MARGIN_BOTTOM = 28;
const PAGE_TOP = 26;

type Fmt = "count" | "currency" | "percent";

type MetricRow = {
  label: string;
  indent?: boolean;
  fmt: Fmt;
  key: keyof DerivedRow;
  get: (row: DerivedRow) => number | null;
};

const METRIC_ROWS: MetricRow[] = [
  { label: "Occupied", fmt: "count", key: "occupied", get: (r) => r.occupied },
  { label: "Transient", indent: true, fmt: "count", key: "transientNights", get: (r) => r.transientNights },
  { label: "Lease", indent: true, fmt: "count", key: "leaseNights", get: (r) => r.leaseNights },
  { label: "Other blocks", fmt: "count", key: "otherBlocks", get: (r) => r.otherBlocks },
  { label: "Out-of-Order", fmt: "count", key: "ooo", get: (r) => r.ooo },
  { label: "Available", fmt: "count", key: "available", get: (r) => r.available },
  { label: "Inventory", fmt: "count", key: "inventory", get: (r) => r.inventory },
  { label: "% Occupied", fmt: "percent", key: "pOcc", get: (r) => r.pOcc },
  { label: "% Out-of-Order", fmt: "percent", key: "pOoo", get: (r) => r.pOoo },
  { label: PCT_AVAILABLE_LABEL, fmt: "percent", key: "pAvail", get: (r) => r.pAvail },
  {
    label: "% Occupied Adjusted (less 20 rms)",
    fmt: "percent",
    key: "occAdjLess20",
    get: (r) => r.occAdjLess20,
  },
  { label: "Room Revenue", fmt: "currency", key: "roomRev", get: (r) => r.roomRev },
  { label: "Transient", indent: true, fmt: "currency", key: "transientRev", get: (r) => r.transientRev },
  { label: "Lease", indent: true, fmt: "currency", key: "leaseRev", get: (r) => r.leaseRev },
  { label: "ADR Combined", fmt: "currency", key: "adrCombined", get: (r) => r.adrCombined },
  { label: "ADR Transient", indent: true, fmt: "currency", key: "adrTransient", get: (r) => r.adrTransient },
  { label: "ADR Lease", indent: true, fmt: "currency", key: "adrLease", get: (r) => r.adrLease },
  { label: "RevPar", fmt: "currency", key: "revpar", get: (r) => r.revpar },
];

function fmtCount(n: number): string {
  return n.toLocaleString("en-US");
}
function fmtCurrency(n: number): string {
  return (
    "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  );
}
function fmtPercent(n: number): string {
  return (n * 100).toFixed(1) + "%";
}
function fmtValue(fmt: Fmt, n: number | null): string {
  if (n == null) return "";
  if (fmt === "count") return fmtCount(n);
  if (fmt === "currency") return fmtCurrency(n);
  return fmtPercent(n);
}
/** "—" for a count-dependent cell blanked by a partial MTD/YTD block —
 *  Kyle's decision, partial-counts-brief.md. */
const BLANKED = "—";

/** Metric rows applicable to a property, given whether any block has occAdjLess20. */
function applicableMetricRows(anyAdjusted: boolean): MetricRow[] {
  return METRIC_ROWS.filter(
    (m) => m.label !== "% Occupied Adjusted (less 20 rms)" || anyAdjusted
  );
}

/** Two-row ACTUAL header, matching hers: period name over value/LY/Variance,
 *  then the concrete dates. */
export function actualHead(asOf: string): string[][] {
  const l = periodHeaderLabels(asOf);
  return [
    [
      "",
      "Yesterday", "Last Year", "Variance",
      "Month-to-date", "Last Year", "Variance",
      "Year-to-date", "Last Year", "Variance",
    ],
    [
      "History",
      l.yesterday.current, l.yesterday.lastYear, "",
      l.mtd.current, l.mtd.lastYear, "",
      l.ytd.current, l.ytd.lastYear, "",
    ],
  ];
}

function actualBody(property: PropertyActual): string[][] {
  const groups: PeriodBlock[] = [property.yesterday, property.mtd, property.ytd];
  const anyAdjusted = groups.some((g) => g.actual.occAdjLess20 != null);
  const rows = applicableMetricRows(anyAdjusted);
  return rows.map((metric) => {
    const label = metric.indent ? `  ${metric.label}` : metric.label;
    const cells: string[] = [label];
    for (const g of groups) {
      // Kyle's decision, partial-counts-brief.md: blank count-dependent
      // Actual/Variance cells for a partial MTD/YTD block; LY stays intact.
      const blanked = g.countsPartial === true && isCountDependentRow(metric.key);
      const actualVal = metric.get(g.actual);
      const lastYearVal = g.lastYear ? metric.get(g.lastYear) : null;
      const varianceVal =
        actualVal == null || lastYearVal == null ? null : actualVal - lastYearVal;
      cells.push(blanked ? BLANKED : fmtValue(metric.fmt, actualVal));
      cells.push(fmtValue(metric.fmt, lastYearVal));
      cells.push(blanked ? BLANKED : fmtValue(metric.fmt, varianceVal));
    }
    return cells;
  });
}

/** Two-row ON-THE-BOOKS header: weekday names over the forward dates. */
export function onTheBooksHead(property: PropertyOnTheBooks): string[][] {
  return [
    ["", ...property.days.map((d) => weekdayName(d.date))],
    ["On-the-books", ...property.days.map((d) => fmtDayHeader(d.date))],
  ];
}

function onTheBooksBody(property: PropertyOnTheBooks): string[][] {
  const anyAdjusted = property.days.some((d) => d.row.occAdjLess20 != null);
  const rows = applicableMetricRows(anyAdjusted);
  return rows.map((metric) => {
    const label = metric.indent ? `  ${metric.label}` : metric.label;
    const cells: string[] = [label];
    for (const d of property.days) {
      cells.push(fmtValue(metric.fmt, metric.get(d.row)));
    }
    return cells;
  });
}

function shadeAvailabilityRow(cell: {
  section: string;
  row: { index: number; raw: unknown };
  cell: { raw: unknown; styles: { fillColor?: unknown; textColor?: unknown } };
}) {
  if (cell.section !== "body") return;
  const raw = cell.row.raw as unknown[];
  const firstCol = String(raw?.[0] ?? "").trim();
  if (firstCol !== PCT_AVAILABLE_LABEL) return;
  const text = String(cell.cell.raw ?? "").trim();
  if (!text || !text.endsWith("%")) return;
  const pct = parseFloat(text) / 100;
  if (Number.isNaN(pct)) return;
  if (pct <= 0.15) {
    cell.cell.styles.fillColor = RED;
  } else if (pct <= 0.2) {
    cell.cell.styles.fillColor = ORANGE;
  } else if (pct >= 0.4) {
    cell.cell.styles.textColor = PURPLE;
  }
}

/** Compact enough that two property tables fit one landscape page, as in hers. */
const TABLE_STYLE = {
  theme: "grid" as const,
  styles: { fontSize: 6, cellPadding: 1.6, overflow: "hidden" as const },
  headStyles: {
    fillColor: NAVY,
    textColor: [255, 255, 255] as [number, number, number],
    fontSize: 6,
    halign: "center" as const,
  },
  columnStyles: { 0: { cellWidth: 108, halign: "left" as const } },
  bodyStyles: { halign: "right" as const },
  margin: { left: MARGIN_X, right: MARGIN_X, bottom: MARGIN_BOTTOM },
  pageBreak: "avoid" as const,
};

function finalY(doc: jsPDF): number {
  return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
}

/** Draw one property block (name + table) at `top`; returns the y after it. */
function drawBlock(
  doc: jsPDF,
  top: number,
  name: string,
  head: string[][],
  body: string[][]
): number {
  doc.setFontSize(8.5);
  doc.setTextColor(31, 56, 100);
  doc.text(name, MARGIN_X, top);
  doc.setTextColor(0, 0, 0);
  autoTable(doc, { ...TABLE_STYLE, startY: top + 4, head, body, didParseCell: shadeAvailabilityRow });
  return finalY(doc);
}

/** Chunk into the pairs that become one page each. */
function pairs<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += 2) out.push(items.slice(i, i + 2));
  return out;
}

export function renderReportPdf(report: RevenueReport): Buffer {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const head = actualHead(report.asOf);
  let firstPage = true;

  const startPage = (sectionLabel?: string): number => {
    if (!firstPage) doc.addPage();
    firstPage = false;
    let y = PAGE_TOP;
    if (sectionLabel) {
      doc.setFontSize(10);
      doc.text(sectionLabel, MARGIN_X, y);
      y += 14;
    }
    return y;
  };

  // --- ACTUAL: two properties per page ---
  pairs(report.actual).forEach((page, pageIndex) => {
    let y = startPage(pageIndex === 0 ? "ACTUAL" : undefined);
    page.forEach((property) => {
      y = drawBlock(doc, y, property.name, head, actualBody(property)) + 18;
    });
  });

  // --- Sources / Notes / Legend (her page 5) ---
  renderNotesPage(report, startPage());

  // --- ON-THE-BOOKS: two properties per page, same order ---
  pairs(report.onTheBooks).forEach((page, pageIndex) => {
    let y = startPage(pageIndex === 0 ? "ON-THE-BOOKS" : undefined);
    page.forEach((property) => {
      y =
        drawBlock(doc, y, property.name, onTheBooksHead(property), onTheBooksBody(property)) +
        18;
    });
  });

  // --- Methodology (ours; no counterpart in hers) ---
  renderMethodologyPages(doc, startPage("Methodology (confirmed by Monica Oco, Revenue Management)"));

  return Buffer.from(doc.output("arraybuffer"));

  /** Sources / Notes / Legend, in her wording where it still holds. The Yardi
   *  line from her file is deliberately NOT reproduced: 2026 lease figures are
   *  100% Cloudbeds (see METHODOLOGY, "Lease vs. Transient"), so copying it
   *  would be stating a source we don't use. */
  function renderNotesPage(rep: RevenueReport, top: number) {
    let y = top;
    const line = (text: string, opts: { bold?: boolean; indent?: number } = {}) => {
      doc.setFontSize(opts.bold ? 9 : 8);
      const lines = doc.splitTextToSize(text, PAGE_W - 2 * MARGIN_X - (opts.indent ?? 0));
      if (y + lines.length * 10 > PAGE_H - MARGIN_BOTTOM) {
        doc.addPage();
        y = PAGE_TOP;
      }
      doc.text(lines, MARGIN_X + (opts.indent ?? 0), y);
      y += lines.length * 10 + (opts.bold ? 4 : 2);
    };

    line(
      `Stayable - Occupancy & Revenue. Data through ${rep.asOf}. ` +
        `Generated ${rep.generatedEastern} Eastern.`,
      { bold: true }
    );
    y += 4;

    line("Sources:", { bold: true });
    line("- Transient room nights / revenue and out-of-order counts are from Cloudbeds.", { indent: 8 });
    line(
      "- Lease room nights / revenue are from Cloudbeds, classified by rate plan (Monthly Lease and Weekly Lease).",
      { indent: 8 }
    );
    line(`- ${rep.sourceNote}`, { indent: 8 });
    y += 4;

    line("Notes:", { bold: true });
    line(
      "- Other blocks - blocked or occupied rooms other than paid lease / transient rooms (e.g. PM rooms, rooms held for an ongoing leasing contract).",
      { indent: 8 }
    );
    line("- Room Revenue (Transient & Lease) excludes taxes and adjustments.", { indent: 8 });
    line(
      "- Results for past dates still change depending on updates in blocks and out-of-order rooms.",
      { indent: 8 }
    );
    if (rep.trackingSince) {
      line(`- MTD / YTD accumulate from daily snapshots starting ${rep.trackingSince}.`, { indent: 8 });
    }
    if (rep.finalThrough) {
      line(
        `- Figures are final through ${rep.finalThrough}; later days are preliminary and are re-derived nightly.`,
        { indent: 8 }
      );
    }
    for (const note of rep.oooOverrideNotes ?? []) {
      line(`- ${note}`, { indent: 8 });
    }
    const f = rep.freshness;
    if (f?.latestCapturedDate) {
      const current = f.latestCapturedDate >= rep.asOf;
      line(
        `- Data freshness: last captured day ${f.latestCapturedDate} ` +
          `(${f.propertiesOnLatest} of ${f.propertiesExpected} properties); ` +
          `snapshot last written ${f.lastBankedAt ?? "unknown"}.` +
          (current
            ? ""
            : ` NOTE: this report is for ${rep.asOf}; the daily capture had not landed.`),
        { indent: 8 }
      );
    }
    y += 4;

    line("Legend:", { bold: true });
    line("- ADR - Average Daily Rate / Average Room Rate", { indent: 8 });
    line("- RevPar - Revenue per Available Room", { indent: 8 });
    line("- Highlighted in orange are dates at 20% or less availability left.", { indent: 8 });
    line("- Highlighted in red are dates at 15% or less availability left.", { indent: 8 });
    line("- In purple text are dates with at least 40% of the inventory available to sell.", { indent: 8 });
  }

  function renderMethodologyPages(d: jsPDF, top: number) {
    let y = top;
    d.setFontSize(8);
    for (const sec of METHODOLOGY) {
      if (y > PAGE_H - MARGIN_BOTTOM - 30) {
        d.addPage();
        y = PAGE_TOP;
      }
      d.setFontSize(9);
      d.text(sec.heading, MARGIN_X, y);
      y += 12;
      d.setFontSize(8);
      for (const pt of sec.points) {
        const lines = d.splitTextToSize(`- ${pt}`, PAGE_W - 2 * MARGIN_X - 10);
        if (y + lines.length * 10 > PAGE_H - MARGIN_BOTTOM) {
          d.addPage();
          y = PAGE_TOP;
        }
        d.text(lines, MARGIN_X + 10, y);
        y += lines.length * 10 + 2;
      }
      y += 6;
    }
  }
}
