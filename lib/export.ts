// Shared, framework-agnostic export helpers. Pure (no DOM, no libs) so the
// matrix/CSV/filename logic is unit-tested; the actual Excel/PDF rendering and
// browser download live in the client <ExportMenu> via lazy-loaded libraries.
//
// Filenames follow the RISE8 convention (CLAUDE.md §7): Title_PropertyID_MMDDYY.
// When "All properties" is in view we substitute `AllProperties` for the ID.

export type ExportColumn<T> = {
  header: string;
  value: (row: T) => string | number;
};

/** [header row, ...data rows] from typed columns. */
export function buildMatrix<T>(columns: ExportColumn<T>[], rows: T[]): (string | number)[][] {
  return [columns.map((c) => c.header), ...rows.map((r) => columns.map((c) => c.value(r)))];
}

function csvCell(v: string | number): string {
  const s = v === null || v === undefined ? "" : String(v);
  // Quote if the cell contains a comma, quote, or newline; escape quotes by doubling.
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** RFC-4180-ish CSV (CRLF rows). Excel/Sheets open it directly. */
export function toCSV(matrix: (string | number)[][]): string {
  return matrix.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

/** "2026-06-27" -> "062726". Pass-through if not a YYYY-MM-DD string. */
export function ymdToMMDDYY(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  return m ? `${m[2]}${m[3]}${m[1].slice(2)}` : ymd;
}

/** Title_PropertyID_MMDDYY; `AllProperties` when propertyId is null/empty. */
export function exportFilename(title: string, propertyId: string | null, ymd: string): string {
  const scope = propertyId && propertyId.trim().length > 0 ? propertyId.trim() : "AllProperties";
  return `${title}_${scope}_${ymdToMMDDYY(ymd)}`;
}
