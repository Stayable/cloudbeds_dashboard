// Excel renderer for the Daily Due-Out Room Walk List.
//
// This is a WORKING document, not a report: PMs/PAs open it, walk the rooms and
// fill in the right-hand columns. That drives every layout choice — one row per
// ROOM (not per reservation), an autofilter so a PA can isolate their property,
// a frozen header, and four deliberately empty columns sized to be typed into.
//
// PII-FREE. Room numbers only — no guest names, no balances (see the header of
// lib/due-outs.ts for why balances are excluded even though the query returns
// them). CLAUDE.md §5 rule 2; the /bea §3 exception does not reach a file that
// gets shared by link.
//
// Filename follows the RISE8 convention (CLAUDE.md §7) with the entity name in
// place of a property ID, because the workbook is portfolio-wide:
// `DueOutWalkList_Stayable_MMDDYY.xlsx`, stamped with the STAY DATE — the day
// being walked, not the day it was generated. Those differ whenever the file is
// produced the evening before.

import ExcelJS from "exceljs";
import type { DueOutProperty } from "@/lib/due-outs";

const FONT = "Arial";
const TITLE_FILL = "FF0F1E33"; // same navy as the revenue workbook's title bar
const HEADER_FILL = "FF1F3864";
const ENTRY_FILL = "FFFFF9E6"; // the columns a PM is meant to fill in
const WARN_FILL = "FFFCE4B6";
const BORDER: Partial<ExcelJS.Border> = { style: "thin", color: { argb: "FFBFBFBF" } };

/** `DueOutWalkList_Stayable_MMDDYY.xlsx` for a YYYY-MM-DD stay date. */
export function dueOutFileName(day: string): string {
  const [y, m, d] = day.split("-");
  return `DueOutWalkList_Stayable_${m}${d}${y.slice(2)}.xlsx`;
}

/** Long-form stay date, rendered in UTC so the string cannot shift a day
 *  against the reader's own timezone. */
function prettyDate(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** One row per room, ordered by property then door. Exported for testing —
 *  the flattening is where a multi-room reservation could silently lose doors. */
export function walkRows(rows: DueOutProperty[]): { name: string; id: string; room: string }[] {
  const out: { name: string; id: string; room: string }[] = [];
  for (const r of rows) {
    for (const room of r.rooms ?? []) {
      out.push({ name: r.property.name, id: r.property.id, room });
    }
  }
  return out;
}

/**
 * Build the walk-list workbook. `generatedEastern` is passed in rather than
 * read from the clock so the output is deterministic and unit-testable — and
 * so the caller is forced to supply an EASTERN timestamp (the harness/server
 * clock is UTC and runs a day ahead every evening).
 */
export async function renderDueOutXlsx(
  day: string,
  rows: DueOutProperty[],
  generatedEastern: string,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Stayable Operating Dashboard";
  wb.created = new Date(`${day}T12:00:00Z`);

  const ws = wb.addWorksheet("Walk List", {
    views: [{ state: "frozen", ySplit: 5 }],
    pageSetup: { orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  ws.columns = [
    { key: "property", width: 24 },
    { key: "id", width: 10 },
    { key: "room", width: 10 },
    { key: "inspected", width: 12 },
    { key: "by", width: 18 },
    { key: "condition", width: 16 },
    { key: "notes", width: 46 },
  ];

  const data = walkRows(rows);
  const failed = rows.filter((r) => r.rooms === null);
  const lastCol = 7;

  // --- Title bar -----------------------------------------------------------
  ws.mergeCells(1, 1, 1, lastCol);
  const title = ws.getCell(1, 1);
  title.value = `Stayable — Due-Out Room Walk List — ${prettyDate(day)}`;
  title.font = { name: FONT, size: 14, bold: true, color: { argb: "FFFFFFFF" } };
  title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TITLE_FILL } };
  title.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  ws.getRow(1).height = 26;

  ws.mergeCells(2, 1, 2, lastCol);
  const sub = ws.getCell(2, 1);
  sub.value =
    `${data.length} room${data.length === 1 ? "" : "s"} across ` +
    `${rows.filter((r) => r.rooms !== null).length} propert${rows.filter((r) => r.rooms !== null).length === 1 ? "y" : "ies"}` +
    ` · generated ${generatedEastern} Eastern`;
  sub.font = { name: FONT, size: 10, italic: true, color: { argb: "FF444444" } };
  sub.alignment = { indent: 1 };

  // --- Source / caveat line ------------------------------------------------
  // A partial read is stated on the face of the document, never averaged away.
  // A short walk list that looks complete is the failure mode that matters here:
  // a room nobody walks is a room nobody turns.
  ws.mergeCells(3, 1, 3, lastCol);
  const note = ws.getCell(3, 1);
  note.value =
    "Source: Cloudbeds — reservations still In-House with a checkout date of the day above. " +
    "Rooms only; no guest details. A room already vacated before this file was generated does not appear." +
    (failed.length
      ? `  ⚠ ${failed.map((r) => `${r.property.name} (${r.property.id})`).join(", ")} could not be read — shown as UNAVAILABLE below, NOT as zero.`
      : "");
  note.font = { name: FONT, size: 9, color: { argb: "FF444444" } };
  note.alignment = { wrapText: true, vertical: "top", indent: 1 };
  ws.getRow(3).height = failed.length ? 30 : 22;
  if (failed.length) {
    note.fill = { type: "pattern", pattern: "solid", fgColor: { argb: WARN_FILL } };
  }

  // --- Header row (row 5; row 4 is a spacer) -------------------------------
  const headers = ["Property", "Property ID", "Room", "Inspected", "Inspected by", "Condition", "Notes"];
  const headerRow = ws.getRow(5);
  headers.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    cell.alignment = { vertical: "middle", horizontal: i >= 2 ? "center" : "left", indent: i < 2 ? 1 : 0 };
    cell.border = { top: BORDER, left: BORDER, bottom: BORDER, right: BORDER };
  });
  headerRow.height = 20;

  // --- Body ----------------------------------------------------------------
  let r = 6;
  for (const row of data) {
    const line = ws.getRow(r++);
    line.getCell(1).value = row.name;
    line.getCell(2).value = row.id;
    line.getCell(3).value = row.room;
    for (let c = 1; c <= lastCol; c++) {
      const cell = line.getCell(c);
      cell.font = { name: FONT, size: 10 };
      cell.border = { top: BORDER, left: BORDER, bottom: BORDER, right: BORDER };
      cell.alignment = { vertical: "middle", horizontal: c >= 2 && c <= 4 ? "center" : "left", indent: c === 1 ? 1 : 0 };
      // Tint the four columns the walker fills in, so the document reads as
      // something to complete rather than something to file.
      if (c >= 4) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ENTRY_FILL } };
    }
  }

  // Properties that could not be read get an explicit row. Omitting them would
  // make an unread property indistinguishable from one with nothing due out.
  for (const f of failed) {
    const line = ws.getRow(r++);
    line.getCell(1).value = f.property.name;
    line.getCell(2).value = f.property.id;
    line.getCell(3).value = "UNAVAILABLE";
    ws.mergeCells(line.number, 4, line.number, lastCol);
    line.getCell(4).value = "Cloudbeds did not respond — this property's due-outs are UNKNOWN, not zero. Check Cloudbeds directly.";
    for (let c = 1; c <= lastCol; c++) {
      const cell = line.getCell(c);
      cell.font = { name: FONT, size: 10, bold: c === 3 };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: WARN_FILL } };
      cell.border = { top: BORDER, left: BORDER, bottom: BORDER, right: BORDER };
      cell.alignment = { vertical: "middle", horizontal: c >= 2 && c <= 3 ? "center" : "left", indent: c === 1 ? 1 : 0 };
    }
  }

  if (data.length === 0 && failed.length === 0) {
    const line = ws.getRow(r++);
    ws.mergeCells(line.number, 1, line.number, lastCol);
    line.getCell(1).value = "No rooms are scheduled to check out on this date.";
    line.getCell(1).font = { name: FONT, size: 10, italic: true };
    line.getCell(1).alignment = { indent: 1 };
  }

  if (data.length > 0) {
    ws.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5 + data.length, column: lastCol } };
  }

  const arrayBuffer = await wb.xlsx.writeBuffer();
  // `as ArrayBuffer` matches lib/report-xlsx.ts:498 — without it the result is
  // Buffer<ArrayBufferLike>, which this @types/node does not accept as Buffer.
  return Buffer.from(arrayBuffer as ArrayBuffer);
}
