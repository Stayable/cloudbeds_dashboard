// Rows for the daily sheet in `DDF Refund <year>.xlsx` — the damage-deposit
// refund tracker Operations keeps in SharePoint.
//
// HOW THAT WORKBOOK IS ACTUALLY USED (Kyle, 08/14/26 — do not re-derive from
// the historical sheets, which will mislead you):
// each sheet is named `MM.DD` and is SEEDED IN THE MORNING WITH THAT DAY'S DUE
// OUTS. During the day the team edits the rows in place — as a guest actually
// departs, Reservation Status becomes "Checked Out" and Refund Status is filled
// in. So every finished sheet reads "Checked Out" on every row. Reading those
// finished sheets and concluding the workbook is seeded with completed
// departures is wrong; it is the END state, not the starting state. Our job is
// only ever to write the STARTING state.
//
// THEREFORE THIS FILE ONLY EVER PRODUCES A NEW DAY'S SEED. It must never
// rewrite an existing sheet: the team's edits are the value in this workbook,
// and they are made by hand and cannot be reconstructed.
//
// GUEST NAMES ARE OPTIONAL AND DEFAULT OFF. The workbook's own Name column is
// load-bearing — a deposit refund is decided per guest, not per room. But no
// code in this app emits a guest name outside /bea §3 (CLAUDE.md §5 rule 2),
// and this workbook is shared by link, which is a weaker gate than the PIN.
// The exposure already exists (the team types those names in by hand today), so
// populating it widens nothing — but it is a decision, so it is a flag rather
// than a default.

import type { Property } from "@/config/properties";

/** The workbook's columns, in its own order. Header text copied verbatim from
 *  the live sheets so an appended sheet is indistinguishable from a hand-made
 *  one. */
export const DDF_HEADERS = [
  "Property",
  "Name",
  "Arrival Date",
  "Departure Date",
  "Room(s)",
  "Reservation Status",
  "Refund Status",
] as const;

/** Status seeded on a fresh row. The team overwrites it with "Checked Out" as
 *  each guest leaves, which is the whole point of the tracker — so the seed
 *  must NOT claim they have already gone. */
export const SEED_RESERVATION_STATUS = "Due Out";

/** Literal used on the live sheets for a property with nothing due out. Copied
 *  exactly, including the spacing, so filters and eyeballs treat our rows and
 *  theirs the same. */
export const NO_DUE_OUTS = (code: string) => `${code} - No due outs`;

export type DdfSourceRow = {
  property: Property;
  /** null = the read FAILED. Distinct from an empty array, which is a real
   *  "nothing due out today". Never collapse the two. */
  reservations: { rooms: string[]; arrival: string; guest?: string }[] | null;
};

export type DdfRow = [string, string, string, string, string, string, string];

/**
 * Build the seed rows for one day's sheet.
 *
 * One row per RESERVATION (not per room) — the workbook's `Room(s)` column is
 * plural and the live sheets carry comma-joined rooms there, because a refund
 * decision is made per reservation even when it holds two rooms.
 */
export function buildDdfRows(
  day: string,
  sources: DdfSourceRow[],
  opts: { includeGuestNames?: boolean } = {},
): DdfRow[] {
  const rows: DdfRow[] = [];

  for (const src of sources) {
    const code = src.property.code;

    if (src.reservations === null) {
      // An unread property gets a row that says so. Omitting it would make
      // "we could not read this property" look identical to "nothing due out",
      // and the second is a normal day while the first means someone should
      // check Cloudbeds by hand.
      rows.push([code, "", "", "", "", "READ FAILED", "Cloudbeds did not respond - verify manually"]);
      continue;
    }

    if (src.reservations.length === 0) {
      const marker = NO_DUE_OUTS(code);
      rows.push([marker, "", "", "", "", "", ""]);
      continue;
    }

    for (const r of src.reservations) {
      rows.push([
        code,
        opts.includeGuestNames ? (r.guest ?? "") : "",
        r.arrival,
        day,
        r.rooms.join(", "),
        SEED_RESERVATION_STATUS,
        "",
      ]);
    }
  }

  return rows;
}

/** Sheet name for a stay date: `MM.DD`, matching all 195 existing sheets. */
export function ddfSheetName(day: string): string {
  const [, m, d] = day.split("-");
  return `${m}.${d}`;
}
