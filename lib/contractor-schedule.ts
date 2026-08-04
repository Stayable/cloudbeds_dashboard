// Contractor schedule for /rob §6 — the weekly renovation crew plan from
// Smartsheet, split into Monday..Friday tabs.
//
// Source sheet (Kyle 08/05/26): "Contractor Schedule 08-03 to 08-07-26",
// id 1391340150542212. Read-only, like everything in lib/smartsheet.ts.
//
// Kyle asked for the tabs to come from the DATE column. The sheet also carries a
// text `Day` column holding "Monday".."Friday", but Date is the authoritative
// field and a derived weekday cannot drift out of sync with it, so `Day` is
// deliberately ignored.
//
// NOT guest data. Contractor names are vendor/crew names, not guests — this is
// unrelated to the /bea §3 guest-PII exception. The sheet does name individual
// workers, so /rob staying exec-gated matters; it already is.
//
// [!] WEEKLY ROLLOVER IS AN OPEN QUESTION. The sheet's NAME carries its date
// range, so either (a) Gerardo renames one long-lived sheet each week and this
// hardcoded ID keeps working, or (b) a new sheet is created weekly and this
// section silently shows a stale week. Not resolvable from one observation, so
// the UI prints the sheet's own name and each tab's real date — a stale week is
// visible rather than silent. Override with SMARTSHEET_CONTRACTOR_SHEET_ID.

import { getSheet, readSmartsheetToken, type RawSheet, type SmartsheetResult } from "@/lib/smartsheet";
import { easternToday } from "@/lib/dates";

export const CONTRACTOR_SHEET_ID =
  process.env.SMARTSHEET_CONTRACTOR_SHEET_ID?.trim() || "1391340150542212";

/** The five weekday tabs, in order. */
export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

// Sunday-indexed, matching Date.prototype.getUTCDay().
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/** Weekday name for a `YYYY-MM-DD` string. Parsed as UTC midnight so the answer
 *  never depends on the server's own timezone — the machine here runs Philippine
 *  time, which is exactly the trap this avoids. Returns null if unparseable. */
export function weekdayOf(ymd: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const t = Date.parse(`${ymd}T00:00:00Z`);
  if (Number.isNaN(t)) return null;
  return DAY_NAMES[new Date(t).getUTCDay()];
}

/** The five columns Rob asked for, in his order. */
export type ScheduleRow = {
  contractor: string;
  property: string;
  task: string;
  status: string;
  update: string; // "Latest WhatsApp Update"
  date: string; // kept for sorting / the tab's date label
};

export type ScheduleDay = {
  key: Weekday;
  date: string; // "" when the sheet has no rows for that weekday
  rows: ScheduleRow[];
};

export type ContractorSchedule = {
  sheetName: string;
  permalink: string; // Smartsheet deep link, for Rob to open the source
  days: ScheduleDay[]; // always 5, Monday..Friday, in order
  defaultKey: Weekday; // today (Eastern) when it has rows, else the first day that does
  todayWeekday: string; // today's Eastern weekday, even if it is Sat/Sun
  weekendRows: number; // rows dated Sat/Sun — surfaced, never silently dropped
  undatedRows: number; // rows with a missing/unparseable Date
  totalRows: number;
};

// Smartsheet's GET /sheets/{id} also returns a permalink; RawSheet omits it.
type SheetWithPermalink = RawSheet & { permalink?: string };

const COL = {
  contractor: "Contractor",
  date: "Date",
  property: "Property",
  task: "Task",
  status: "Status",
  update: "Latest WhatsApp Update", // note the capital A — verified against the live sheet
} as const;

/** Cell text for a column title.
 *
 *  `prefer` matters and is not cosmetic. For TEXT columns `displayValue` is the
 *  nicer string, but for a DATE column Smartsheet returns `displayValue`
 *  formatted to the user's locale ("08/03/26") while `value` stays ISO
 *  ("2026-08-03"). Reading displayValue for the Date column would make
 *  `weekdayOf` reject every row and empty all five tabs. */
function cellText(
  row: RawSheet["rows"][number],
  idByTitle: Map<string, number>,
  title: string,
  prefer: "display" | "raw" = "display",
): string {
  const id = idByTitle.get(title);
  if (id === undefined) return "";
  const cell = row.cells.find((c) => c.columnId === id);
  if (!cell) return "";
  const v = prefer === "raw" ? (cell.value ?? cell.displayValue) : (cell.displayValue ?? cell.value);
  return v === undefined || v === null ? "" : String(v).trim();
}

/** Group the sheet's rows into Monday..Friday tabs and pick the default tab.
 *  Pure: `sheet` + `todayYmd` in, view out — no network, no clock. */
export function foldSchedule(sheet: SheetWithPermalink, todayYmd: string): ContractorSchedule {
  const idByTitle = new Map(sheet.columns.map((c) => [c.title, c.id]));

  const byDay = new Map<Weekday, ScheduleRow[]>(WEEKDAYS.map((d) => [d, []]));
  let weekendRows = 0;
  let undatedRows = 0;

  for (const row of sheet.rows) {
    // "raw": the ISO value, never the locale-formatted displayValue (see cellText).
    const date = cellText(row, idByTitle, COL.date, "raw").slice(0, 10);
    const parsed = weekdayOf(date);
    const entry: ScheduleRow = {
      contractor: cellText(row, idByTitle, COL.contractor),
      property: cellText(row, idByTitle, COL.property),
      task: cellText(row, idByTitle, COL.task),
      status: cellText(row, idByTitle, COL.status),
      update: cellText(row, idByTitle, COL.update),
      date,
    };
    // A row with nothing in any of the five columns is sheet padding, not work.
    const empty = !entry.contractor && !entry.property && !entry.task && !entry.status;
    if (empty) continue;

    if (!parsed) {
      undatedRows++;
      continue;
    }
    if (parsed === "Saturday" || parsed === "Sunday") {
      weekendRows++;
      continue;
    }
    byDay.get(parsed as Weekday)!.push(entry);
  }

  const days: ScheduleDay[] = WEEKDAYS.map((key) => {
    const rows = byDay.get(key)!;
    // Contractor A→Z within a day, so the same person sits in the same place
    // across tabs. Property then task breaks ties deterministically.
    rows.sort(
      (a, b) =>
        a.contractor.localeCompare(b.contractor) ||
        a.property.localeCompare(b.property) ||
        a.task.localeCompare(b.task),
    );
    return { key, date: rows[0]?.date ?? "", rows };
  });

  // Default tab: today in Eastern. On a weekend — or if today's weekday has no
  // rows — fall back to the first day that has any, so Rob never lands on a
  // blank tab. Monday if the sheet is entirely empty.
  const todayWeekday = weekdayOf(todayYmd) ?? "";
  const todayHasRows = days.find((d) => d.key === todayWeekday && d.rows.length > 0);
  const defaultKey: Weekday =
    (todayHasRows?.key as Weekday | undefined) ??
    (days.find((d) => d.rows.length > 0)?.key as Weekday | undefined) ??
    "Monday";

  return {
    sheetName: sheet.name ?? "Contractor Schedule",
    permalink: sheet.permalink ?? "",
    days,
    defaultKey,
    todayWeekday,
    weekendRows,
    undatedRows,
    totalRows: days.reduce((n, d) => n + d.rows.length, 0),
  };
}

/** Fetch + fold the contractor schedule. `asOf` defaults to today (Eastern). */
export async function getContractorSchedule(
  asOf: string = easternToday(),
): Promise<SmartsheetResult<ContractorSchedule>> {
  const token = readSmartsheetToken();
  if (!token) {
    return { ok: false, status: 0, error: "SMARTSHEET_API_TOKEN is not set" };
  }
  const res = await getSheet(token, CONTRACTOR_SHEET_ID);
  if (!res.ok) return res;
  return { ok: true, data: foldSchedule(res.data as SheetWithPermalink, asOf) };
}
