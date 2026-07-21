// PDF renderer for the daily occupancy/revenue report (Monica's layout).
// Consumes only lib/revenue-report.ts model types -- no network, no fs.
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
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

type Fmt = "count" | "currency" | "percent";

type MetricRow = {
  label: string;
  indent?: boolean;
  fmt: Fmt;
  get: (row: DerivedRow) => number | null;
};

const METRIC_ROWS: MetricRow[] = [
  { label: "Occupied", fmt: "count", get: (r) => r.occupied },
  { label: "Transient", indent: true, fmt: "count", get: (r) => r.transientNights },
  { label: "Lease", indent: true, fmt: "count", get: (r) => r.leaseNights },
  { label: "Other blocks", fmt: "count", get: (r) => r.otherBlocks },
  { label: "Out-of-Order", fmt: "count", get: (r) => r.ooo },
  { label: "Available", fmt: "count", get: (r) => r.available },
  { label: "Inventory", fmt: "count", get: (r) => r.inventory },
  { label: "% Occupied", fmt: "percent", get: (r) => r.pOcc },
  { label: "% Out-of-Order", fmt: "percent", get: (r) => r.pOoo },
  { label: PCT_AVAILABLE_LABEL, fmt: "percent", get: (r) => r.pAvail },
  {
    label: "% Occupied Adjusted (less 20 rms)",
    fmt: "percent",
    get: (r) => r.occAdjLess20,
  },
  { label: "Room Revenue", fmt: "currency", get: (r) => r.roomRev },
  { label: "Transient", indent: true, fmt: "currency", get: (r) => r.transientRev },
  { label: "Lease", indent: true, fmt: "currency", get: (r) => r.leaseRev },
  { label: "ADR Combined", fmt: "currency", get: (r) => r.adrCombined },
  { label: "ADR Transient", indent: true, fmt: "currency", get: (r) => r.adrTransient },
  { label: "ADR Lease", indent: true, fmt: "currency", get: (r) => r.adrLease },
  { label: "RevPar", fmt: "currency", get: (r) => r.revpar },
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

/** Metric rows applicable to a property, given whether any block has occAdjLess20. */
function applicableMetricRows(anyAdjusted: boolean): MetricRow[] {
  return METRIC_ROWS.filter(
    (m) => m.label !== "% Occupied Adjusted (less 20 rms)" || anyAdjusted
  );
}

const ACTUAL_HEAD = [
  "Metric",
  "Yesterday",
  "LY",
  "Var",
  "MTD",
  "LY",
  "Var",
  "YTD",
  "LY",
  "Var",
];

function actualBody(property: PropertyActual): string[][] {
  const groups: PeriodBlock[] = [property.yesterday, property.mtd, property.ytd];
  const anyAdjusted = groups.some((g) => g.actual.occAdjLess20 != null);
  const rows = applicableMetricRows(anyAdjusted);
  return rows.map((metric) => {
    const label = metric.indent ? `  ${metric.label}` : metric.label;
    const cells: string[] = [label];
    for (const g of groups) {
      const actualVal = metric.get(g.actual);
      const lastYearVal = g.lastYear ? metric.get(g.lastYear) : null;
      const varianceVal =
        actualVal == null || lastYearVal == null ? null : actualVal - lastYearVal;
      cells.push(fmtValue(metric.fmt, actualVal));
      cells.push(fmtValue(metric.fmt, lastYearVal));
      cells.push(fmtValue(metric.fmt, varianceVal));
    }
    return cells;
  });
}

function onTheBooksHead(property: PropertyOnTheBooks): string[] {
  return ["Metric", ...property.days.map((d) => d.date)];
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

const TABLE_STYLE = {
  theme: "grid" as const,
  styles: { fontSize: 7, cellPadding: 2 },
  headStyles: { fillColor: NAVY, textColor: [255, 255, 255] as [number, number, number], fontSize: 8 },
  margin: { left: 20, right: 20 },
};

export function renderReportPdf(report: RevenueReport): Buffer {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });

  doc.setFontSize(14);
  doc.text("Stayable - Occupancy/Revenue Report (Cloudbeds-sourced)", 20, 30);
  doc.setFontSize(9);
  doc.text(
    `As of ${report.asOf} - Generated ${report.generatedEastern}`,
    20,
    46
  );

  let cursorY = 60;

  const ensureRoom = (needed: number) => {
    const pageHeight = doc.internal.pageSize.getHeight();
    if (cursorY + needed > pageHeight - 40) {
      doc.addPage();
      cursorY = 30;
    }
  };

  if (report.actual.length > 0) {
    doc.setFontSize(11);
    ensureRoom(20);
    doc.text("ACTUAL", 20, cursorY);
    cursorY += 10;

    for (const property of report.actual) {
      ensureRoom(30);
      doc.setFontSize(10);
      doc.text(property.name, 20, cursorY + 10);
      cursorY += 16;

      autoTable(doc, {
        ...TABLE_STYLE,
        startY: cursorY,
        head: [ACTUAL_HEAD],
        body: actualBody(property),
        didParseCell: shadeAvailabilityRow,
        didDrawPage: () => {
          cursorY = 30;
        },
      });
      cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable
        .finalY + 20;
    }
  }

  if (report.onTheBooks.length > 0) {
    doc.addPage();
    cursorY = 30;
    doc.setFontSize(11);
    doc.text("ON-THE-BOOKS", 20, cursorY);
    cursorY += 10;

    for (const property of report.onTheBooks) {
      ensureRoom(30);
      doc.setFontSize(10);
      doc.text(property.name, 20, cursorY + 10);
      cursorY += 16;

      autoTable(doc, {
        ...TABLE_STYLE,
        startY: cursorY,
        head: [onTheBooksHead(property)],
        body: onTheBooksBody(property),
        didParseCell: shadeAvailabilityRow,
        didDrawPage: () => {
          cursorY = 30;
        },
      });
      cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable
        .finalY + 20;
    }
  }

  // --- Notes footer ---
  doc.addPage();
  cursorY = 30;
  doc.setFontSize(10);
  doc.text("Notes & Sources", 20, cursorY);
  cursorY += 18;
  doc.setFontSize(8);
  const noteLines = doc.splitTextToSize(report.sourceNote, 750);
  doc.text(noteLines, 20, cursorY);
  cursorY += noteLines.length * 10 + 8;

  const trackingSince = (report as unknown as { trackingSince?: string }).trackingSince;
  if (trackingSince) {
    doc.text(
      `MTD/YTD accumulate from daily snapshots starting ${trackingSince}.`,
      20,
      cursorY
    );
    cursorY += 14;
  }

  doc.text("Availability legend:", 20, cursorY);
  cursorY += 12;
  doc.text("Orange fill: % Available <= 20%", 20, cursorY);
  cursorY += 12;
  doc.text("Red fill: % Available <= 15%", 20, cursorY);
  cursorY += 12;
  doc.text("Purple text: % Available >= 40%", 20, cursorY);

  return Buffer.from(doc.output("arraybuffer"));
}
