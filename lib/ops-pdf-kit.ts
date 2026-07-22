// Shared jsPDF drawing primitives for the four ops category PDFs (Occupancy,
// Leasing, Reviews, OOO -- lib/ops-pdf-t2..t5). Drawing only -- NO data logic.
// Each category's renderer (later tasks) composes these primitives; the pure,
// unit-tested insight strings live in lib/ops-insights.ts. Style follows
// lib/report-pdf.ts (dark navy header, jspdf-autotable grid, ASCII-safe text).
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

type RGB = [number, number, number];

const NAVY: RGB = [15, 30, 51];
const WHITE: RGB = [255, 255, 255];
const INK: RGB = [30, 30, 30];
const MUTED: RGB = [100, 105, 115];
const PANEL_BG: RGB = [244, 245, 247];
const PANEL_BORDER: RGB = [210, 213, 219];

const MARGIN = 24;
const PAGE_BOTTOM_GUARD = 40;

const TILE_W = 150;
const TILE_H = 50;
const TILE_GAP = 12;

function pageHeight(doc: jsPDF): number {
  return doc.internal.pageSize.getHeight();
}
function pageWidth(doc: jsPDF): number {
  return doc.internal.pageSize.getWidth();
}

/** Adds a page and resets to the top margin if `needed` pt would overflow the
 *  current page; otherwise returns `y` unchanged. Callers use this before any
 *  block-level draw so tiles/insights/tables never split across pages. */
function ensureRoom(doc: jsPDF, y: number, needed: number): number {
  if (y + needed > pageHeight(doc) - PAGE_BOTTOM_GUARD) {
    doc.addPage();
    return MARGIN;
  }
  return y;
}

/** New landscape A4 doc (points) -- the shared canvas for all four category
 *  PDFs. */
export function newOpsDoc(): jsPDF {
  return new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
}

/** Dark navy title bar: title, subtitle, and an "As of" stamp. Returns the y
 *  to continue drawing at below the bar. */
export function pageHeader(
  doc: jsPDF,
  opts: { title: string; subtitle: string; asOf: string },
): number {
  const w = pageWidth(doc);
  const barHeight = 54;

  doc.setFillColor(...NAVY);
  doc.rect(0, 0, w, barHeight, "F");

  doc.setTextColor(...WHITE);
  doc.setFontSize(16);
  doc.text(opts.title, MARGIN, 24);
  doc.setFontSize(9);
  doc.text(opts.subtitle, MARGIN, 40);
  doc.setFontSize(8);
  doc.text(`As of ${opts.asOf}`, w - MARGIN, 40, { align: "right" });

  doc.setTextColor(...INK);
  return barHeight + 20;
}

/** A row of KPI tiles (label + big value). Wraps onto additional rows when
 *  the tiles would overflow the page width, and pages when they'd overflow
 *  the page height. Returns the y to continue drawing at. */
export function summaryTiles(
  doc: jsPDF,
  y: number,
  tiles: { label: string; value: string }[],
): number {
  if (tiles.length === 0) return y;

  const usable = pageWidth(doc) - MARGIN * 2;
  const perRow = Math.max(1, Math.floor((usable + TILE_GAP) / (TILE_W + TILE_GAP)));
  const rowCount = Math.ceil(tiles.length / perRow);

  let cursorY = y;
  for (let r = 0; r < rowCount; r++) {
    cursorY = ensureRoom(doc, cursorY, TILE_H + 10);
    const rowTiles = tiles.slice(r * perRow, (r + 1) * perRow);
    rowTiles.forEach((t, i) => {
      const x = MARGIN + i * (TILE_W + TILE_GAP);
      doc.setDrawColor(...PANEL_BORDER);
      doc.setFillColor(...PANEL_BG);
      doc.roundedRect(x, cursorY, TILE_W, TILE_H, 4, 4, "FD");

      doc.setTextColor(...MUTED);
      doc.setFontSize(7.5);
      doc.text(t.label.toUpperCase(), x + 8, cursorY + 16);

      doc.setTextColor(...INK);
      doc.setFontSize(14);
      doc.text(t.value, x + 8, cursorY + 36);
    });
    cursorY += TILE_H + 10;
  }
  return cursorY;
}

/** autotable-backed data grid: dark navy header, small (~8pt) grid body.
 *  `opts.shadeRule` optionally recolors a single column's body cells (e.g.
 *  availability/threshold coloring) based on the cell's numeric value.
 *  Returns the y to continue drawing at. */
export function propertyTable(
  doc: jsPDF,
  y: number,
  head: string[],
  rows: (string | number)[][],
  opts?: { shadeCol?: number; shadeRule?: (v: number) => RGB | null },
): number {
  const startY = ensureRoom(doc, y, 60);
  autoTable(doc, {
    startY,
    head: [head],
    body: rows,
    theme: "grid",
    styles: { fontSize: 8, cellPadding: 4, textColor: INK },
    headStyles: { fillColor: NAVY, textColor: WHITE, fontSize: 8 },
    margin: { left: MARGIN, right: MARGIN, bottom: PAGE_BOTTOM_GUARD },
    didParseCell: (data) => {
      if (!opts?.shadeRule || opts.shadeCol == null) return;
      if (data.section !== "body") return;
      if (data.column.index !== opts.shadeCol) return;
      const raw = String(data.cell.raw ?? "").replace(/[^0-9.-]/g, "");
      const n = parseFloat(raw);
      if (Number.isNaN(n)) return;
      const color = opts.shadeRule(n);
      if (color) data.cell.styles.fillColor = color;
    },
  });
  return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 16;
}

/** Titled "Insights" panel of "- " bullets (ASCII-safe; no bullet glyph),
 *  wrapping long lines and paging as needed. No-op when `bullets` is empty.
 *  Returns the y to continue drawing at. */
export function insightsBlock(doc: jsPDF, y: number, bullets: string[]): number {
  if (bullets.length === 0) return y;

  const width = pageWidth(doc) - MARGIN * 2;
  let cursorY = ensureRoom(doc, y, 30);

  doc.setTextColor(...INK);
  doc.setFontSize(10);
  doc.text("Insights", MARGIN, cursorY + 10);
  cursorY += 20;

  doc.setFontSize(8.5);
  for (const bullet of bullets) {
    const lines = doc.splitTextToSize(`- ${bullet}`, width - 8) as string[];
    const needed = lines.length * 11 + 4;
    cursorY = ensureRoom(doc, cursorY, needed);
    doc.text(lines, MARGIN + 6, cursorY + 8);
    cursorY += needed;
  }
  return cursorY + 4;
}

/** Small gray footer note pinned near the bottom of the CURRENT page (call
 *  once per page, after that page's content is drawn). */
export function opsFooter(doc: jsPDF, note: string): void {
  const h = pageHeight(doc);
  const w = pageWidth(doc);
  doc.setFontSize(7);
  doc.setTextColor(...MUTED);
  const lines = doc.splitTextToSize(note, w - MARGIN * 2) as string[];
  doc.text(lines, MARGIN, h - 16);
  doc.setTextColor(...INK);
}

/** Finalize the doc to a Buffer (route handlers stream this as the PDF body). */
export function finishPdf(doc: jsPDF): Buffer {
  return Buffer.from(doc.output("arraybuffer"));
}

// --- Formatters --------------------------------------------------------
// ASCII-safe only (no curly quotes, no bullet/dash glyphs beyond "-").

/** Fraction (0-1) -> "xx.x%". Callers whose source field is already on a
 *  0-100 scale (occupancy %, leasing conversion rates) must divide by 100
 *  first. */
export function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

/** "$#,##0.00", ASCII only. */
export function money(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Integer with thousands separators. */
export function int(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}
