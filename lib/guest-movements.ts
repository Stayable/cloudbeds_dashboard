// Arrivals & departures, per guest, for the Main Dashboard §5.
//
// CONTAINS GUEST NAMES — but only when the caller says so. `includeGuests`
// controls FETCHING, not rendering: when false the name query is never issued.
// That distinction is the whole point, see "WHY STRIPPING MUST BE SERVER-SIDE".
// Who may ask for names is decided in ONE place, lib/guest-pii.ts. Do not
// re-derive that judgement here or in any page.
//
// Authorised 09/01/26 by Kyle as the widening of CLAUDE.md §5 rule 2 from
// `/bea` §3 alone to all internal staff levels. `/elise` (external vendor),
// `/report` (unauthenticated file-token links), the MCP tool surface and
// anything posted to Teams are all excluded and keep their own guards.
//
// ── WHY STRIPPING MUST BE SERVER-SIDE ───────────────────────────────────────
// Props handed to a client component are serialized into the RSC payload and
// are readable in the browser. A `showGuests` flag that only hides a column
// would still ship every guest name to every viewer — the column would be
// invisible and the data would be right there in the page source. So the flag
// gates the QUERY. There is a test (`STRIPS NAMES when names is null`) that
// fails if a name survives with the flag off.
//
// ── WHY THERE IS NO reservation_status FILTER (deliberate, do not "fix") ─────
// lib/due-outs.ts filters `reservation_status = In-House`, and its header
// records the measurement behind that: probed 08/14/26, Davenport had 4
// due-outs that evening and every one already read `Checked Out`, so the
// In-House list was ZERO. "A late run does not report a quiet day, it reports
// nothing at all."
// A walk list wants that behaviour. A REPORT must not have it. This reader
// filters on DATE ONLY and carries the status as a column, so the list is
// stable from 00:00 to 23:59 and you can see who actually arrived versus who is
// still expected. Adding a status filter here would make the section empty by
// mid-afternoon. The two files disagree on purpose.
//
// ── THE `*` MARKER IN primary_guest_full_name (measured 09/01/26) ────────────
// Staff encode extra information into the guest-name field. Measured across all
// 8 live properties: of 945 names, 588 carried a trailing `*` marker —
// ML 599, D 73, WL 8, bare `*` 3, ` ML` 2, `ML Active Eviction` 2,
// `WL Active Eviction` 1.
//
// ML/WL/D almost certainly mean Monthly Lease / Weekly Lease / Daily, because
// they line up exactly with the rate classes in lib/lease.ts. THAT READING IS
// UNVERIFIED — it is an inference from correspondence, and Monica (who would
// have known) no longer produces the reports that were the external check. So:
//
//   - the marker is stripped for DISPLAY only, and never drives any logic;
//   - `lib/lease.ts` classifyRatePlan REMAINS THE SOLE AUTHORITY on
//     lease-vs-transient. Classifying from this marker would create a second
//     definition of one meaning, which is the failure mode recorded in
//     `duplicated-definitions-fail-silently`: green tests, wrong production;
//   - trailing FREE TEXT IS PRESERVED as `note`, because "Active Eviction" was
//     live on 3 reservations on 09/01/26 and a blind strip would delete a real
//     operational flag. An unrecognised marker also becomes a note rather than
//     being discarded — a new staff convention should appear on screen, not
//     vanish.
//
// PRE-EXISTING DEFECT FOUND, NOT FIXED HERE: nothing in the app strips this
// marker, so `/bea` §3 Balance due currently renders "Fafa Prestil*ML" verbatim.
// That is a display bug in lib/balance-due.ts / BeaBalanceExplorer.tsx. It was
// left alone deliberately rather than widening this change into a working
// collections surface — reported to Kyle 09/01/26.
//
// ── READ COUNT ──────────────────────────────────────────────────────────────
// 3 group-queries × 2 directions × 8 properties = 48 DI reads per refresh,
// covering BOTH days, cached 600s. A two-day RANGE filter is used rather than
// per-day `equals` queries, which would double it to 96.
// `greater_than_or_equal` on checkin_date/checkout_date was UNVERIFIED before
// this file; probed against Davenport (318197) on 09/01/26 and it works — the
// range returned rows on both 09-01 and 09-02 where `equals` returned only
// 09-01's.

import { PROPERTIES, type Property } from "@/config/properties";
import { readKey, type CloudbedsResult } from "@/lib/cloudbeds";

const DI_BASE = "https://api.cloudbeds.com/datainsights/v1.1";
const REVALIDATE_SECONDS = 600;

/** A dataset-3 `details:true` result: one entry per reservation row, `dims` in
 *  the order the group columns were requested. Mirrors lib/balance-due.ts and
 *  lib/due-outs.ts — a third copy, noted in the spec as worth extracting once
 *  it is not also shipping a feature. */
export type Dataset3Rows = { dims: string[][] };

export type MovementDirection = "arrivals" | "departures";

/** Where a reservation actually is, as opposed to what the calendar says.
 *  `expected` = not here yet · `arrived` = showed up · `due-out` = still here
 *  and leaving · `departed` = gone · `cancelled` = cancelled or no-show ·
 *  `other` = a status this code has never seen, shown verbatim. */
export type MovementState = "expected" | "arrived" | "due-out" | "departed" | "cancelled" | "other";

export type MovementRow = {
  reservationNumber: string;
  /** Cleaned display name. `""` when the caller was not permitted names — see
   *  the header. Never assume this is populated. */
  guest: string;
  /** Free text staff appended after the `*` marker, e.g. "Active Eviction".
   *  Empty whenever `guest` is empty — it comes out of the same field. */
  note: string;
  /** Raw rate marker (ML/WL/D) as typed. DISPLAY ONLY — never classify from it,
   *  lib/lease.ts is the authority. Empty when absent or unrecognised. */
  marker: string;
  /** guest_count. `null` when unknown or not permitted. */
  guests: number | null;
  /** Comma-joined when a reservation holds more than one room. */
  rooms: string;
  checkin: string;
  checkout: string;
  /** checkout − checkin. `null` when either date is missing or the pair is
   *  nonsense. Derived, never fetched (CLAUDE.md §6). */
  nights: number | null;
  /** `reservation_status` verbatim, so an unmapped status is still legible. */
  status: string;
  state: MovementState;
};

export type PropertyMovements = {
  property: Property;
  configured: boolean;
  /** Per requested day → rows. `null` means the READ FAILED — never an empty
   *  object. Zero movements is a completely plausible Tuesday, and a failed
   *  read banked as empty is indistinguishable from a real quiet day. That
   *  exact confusion produced months of wrong out-of-order figures (see the
   *  getRoomBlocks pagination note in lib/cloudbeds.ts). */
  arrivals: Record<string, MovementRow[]> | null;
  departures: Record<string, MovementRow[]> | null;
  error?: string | null;
};

// --- pure helpers ------------------------------------------------------------

const KNOWN_MARKERS = new Set(["ML", "WL", "D"]);

/**
 * Split a raw `primary_guest_full_name` into display name, rate marker and note.
 *
 * Splits on the LAST `*` so a name legitimately containing one survives. A
 * recognised marker (ML/WL/D) is separated out; anything else after the marker
 * — or an unrecognised marker entirely — is kept as `note` rather than dropped.
 * See the header for the measurement and for why nothing classifies from this.
 */
export function parseGuestName(raw: string): { name: string; marker: string; note: string } {
  const input = (raw ?? "").trim();
  if (input === "") return { name: "", marker: "", note: "" };

  let marker = "";
  const notes: string[] = [];
  let rest = input;

  // 1. Trailing `*` marker. Split on the LAST asterisk so a name containing one
  //    survives. A recognised ML/WL/D becomes the marker; anything following it
  //    (or an unrecognised marker entirely) is a note.
  const star = rest.lastIndexOf("*");
  if (star >= 0) {
    const tailRaw = rest.slice(star + 1).trim();
    rest = rest.slice(0, star).trim();
    if (tailRaw !== "") {
      const [first, ...tail] = tailRaw.split(/\s+/);
      if (KNOWN_MARKERS.has(first.toUpperCase())) {
        marker = first.toUpperCase();
        if (tail.length) notes.push(tail.join(" "));
      } else {
        notes.push(tailRaw);
      }
    }
  }

  // 2. An INLINE eviction phrase. Six of the nine live eviction flags on
  //    09/01/26 were written this way, with no `*` at all, so catching only the
  //    marker form would miss two thirds of them. Normalised to a consistent
  //    label so the chip reads the same regardless of how it was typed.
  const evictionMatch = rest.match(/\b(active\s+eviction|eviction)\b/i);
  if (evictionMatch) {
    notes.unshift(/active/i.test(evictionMatch[1]) ? "Active Eviction" : "Eviction");
    rest = rest.replace(evictionMatch[0], " ");
  }

  // 3. Bracketed and parenthetical tags — [LTG RATE] (34 live), [EMPLOYEE] (2),
  //    (SNOWBIRD) / (Employee) / (LTG - WEEKLY RATE) (5). None of these are
  //    names; all of them are staff categorisation worth showing separately.
  for (const re of [/\[([^\]]+)\]/g, /\(([^)]+)\)/g]) {
    for (const m of [...rest.matchAll(re)]) notes.push(m[1].trim());
    rest = rest.replace(re, " ");
  }

  const name = rest.replace(/\s+/g, " ").trim();

  return {
    // Never hand back a blank name just because the whole field was a flag —
    // an empty name column reads as broken data. Fall back to the raw input.
    name: name || input,
    marker,
    note: notes.filter(Boolean).join(" · "),
  };
}

/**
 * Nights between two ISO dates (`YYYY-MM-DD`), or null when that is not a
 * sensible question.
 *
 * Counted from calendar dates in UTC, NOT from a local-time hour difference.
 * An hours-based diff breaks across the DST switch: 2026-10-31 → 2026-11-02
 * spans 49 hours in Eastern, and dividing by 24 gives 2.04 — fine with floor,
 * but 2026-03-07 → 2026-03-09 spans 47 hours and floors to 1 instead of 2.
 * Parsing as UTC sidesteps the whole class of bug.
 */
export function nightsBetween(checkin: string, checkout: string): number | null {
  if (!checkin || !checkout) return null;
  const a = Date.parse(`${checkin}T00:00:00Z`);
  const b = Date.parse(`${checkout}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const nights = Math.round((b - a) / 86_400_000);
  return nights < 0 ? null : nights; // checkout before checkin is bad data, not negative nights
}

/**
 * What a `reservation_status` means for the list it appears on.
 *
 * Direction matters: `Checked Out` on an ARRIVALS list means the guest arrived
 * and left the same day (they did show up), while on a DEPARTURES list it means
 * they have gone. Same status, two different facts.
 *
 * Unknown statuses fall through to `other` rather than being guessed at — if
 * Cloudbeds adds one, it must not silently render as `arrived`.
 */
export function movementState(status: string, direction: MovementDirection): MovementState {
  switch ((status ?? "").trim().toLowerCase()) {
    case "cancelled":
    case "canceled":
    case "no show":
    case "no-show":
      return "cancelled";
    case "confirmed":
    case "not confirmed":
      return "expected";
    case "in-house":
    case "in house":
      return direction === "arrivals" ? "arrived" : "due-out";
    case "checked out":
      return direction === "arrivals" ? "arrived" : "departed";
    default:
      return "other";
  }
}

/** Numeric-aware door order, so 110 precedes 204 precedes 1102 and a
 *  non-numeric room name (Lakeland has an "APT1") falls back to string order
 *  rather than becoming NaN. Same comparator as foldDueOutRooms. */
function byRoom(a: MovementRow, b: MovementRow): number {
  const na = Number(a.rooms.split(",")[0]);
  const nb = Number(b.rooms.split(",")[0]);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  if (Number.isFinite(na) && !Number.isFinite(nb)) return -1;
  if (!Number.isFinite(na) && Number.isFinite(nb)) return 1;
  return a.rooms.localeCompare(b.rooms) || a.reservationNumber.localeCompare(b.reservationNumber);
}

/** First column of each row is always `reservation_number`; index the rest. */
function indexByReservation(rows: Dataset3Rows | null): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const dims of rows?.dims ?? []) {
    const resNo = dims[0];
    if (!resNo) continue; // a blank reservation number is not a row
    if (!out.has(resNo)) out.set(resNo, dims); // first wins — dataset 3 can repeat a reservation
  }
  return out;
}

function toCount(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Join the three group-queries on `reservation_number` into display rows.
 *
 * `names` null means the caller may not see guest PII — the name query was
 * never issued, and `guest`/`note`/`guests` stay empty. Everything else still
 * works, so the fallback remains a usable room-level movements list.
 *
 * The row set is the UNION of all supplied queries: a reservation present in one
 * and missing from another yields a row with blanks rather than disappearing.
 * Dropping it would hide exactly the partial-data cases worth seeing.
 */
export function joinMovementRows({
  names,
  dates,
  rooms,
  direction,
}: {
  names: Dataset3Rows | null;
  dates: Dataset3Rows;
  rooms: Dataset3Rows;
  direction: MovementDirection;
}): MovementRow[] {
  const nameIdx = indexByReservation(names);
  const dateIdx = indexByReservation(dates);
  const roomIdx = indexByReservation(rooms);

  const all = new Set<string>([...nameIdx.keys(), ...dateIdx.keys(), ...roomIdx.keys()]);

  const out: MovementRow[] = [];
  for (const resNo of all) {
    const nameDims = nameIdx.get(resNo);
    const dateDims = dateIdx.get(resNo);
    const roomDims = roomIdx.get(resNo);

    const parsed = nameDims ? parseGuestName(nameDims[1] ?? "") : { name: "", marker: "", note: "" };
    const checkin = dateDims?.[1] ?? "";
    const checkout = dateDims?.[2] ?? "";
    const status = roomDims?.[2] ?? "";

    out.push({
      reservationNumber: resNo,
      guest: parsed.name,
      note: parsed.note,
      marker: parsed.marker,
      guests: nameDims ? toCount(nameDims[2]) : null,
      rooms: roomDims?.[1] ?? "",
      checkin,
      checkout,
      nights: nightsBetween(checkin, checkout),
      status,
      state: status ? movementState(status, direction) : "other",
    });
  }

  return out.sort(byRoom);
}

/**
 * Bucket rows into the requested days — arrivals by check-in, departures by
 * checkout.
 *
 * EVERY requested day gets a key, so a quiet day reads as an empty list rather
 * than a missing one (the caller can then say "no arrivals" instead of
 * rendering nothing and looking broken). Rows whose date falls outside the
 * range, or which have no date at all, are dropped rather than bucketed
 * arbitrarily.
 */
export function splitByDate(
  rows: MovementRow[],
  days: string[],
  direction: MovementDirection,
): Record<string, MovementRow[]> {
  const out: Record<string, MovementRow[]> = {};
  for (const day of days) out[day] = [];
  for (const row of rows) {
    const key = direction === "arrivals" ? row.checkin : row.checkout;
    if (key && out[key]) out[key].push(row);
  }
  return out;
}

// --- the reads ---------------------------------------------------------------

/** One dataset-3 range read. `groupColumns` max THREE — the API rejects a
 *  fourth (lib/due-outs.ts:91, lib/balance-due.ts:85). */
async function diRangeRows(
  apiKey: string,
  apiPropertyId: string,
  dateColumn: "checkin_date" | "checkout_date",
  from: string,
  to: string,
  groupColumns: string[],
): Promise<CloudbedsResult<Dataset3Rows>> {
  const body = {
    property_ids: [Number(apiPropertyId)],
    dataset_id: 3,
    // A MEASURE column is required even though this only needs dimensions.
    // `reservation_balance_due_amount` is used because it is proven to exist on
    // dataset 3 (lib/balance-due.ts) and the value is DISCARDED — balances are
    // deliberately not on this report. Asking for `reservation_id` instead makes
    // the whole query 400: it is a dimension, not a measure.
    columns: [{ cdf: { column: "reservation_balance_due_amount" } }],
    group_rows: groupColumns.map((column) => ({ cdf: { column } })),
    filters: {
      and: [
        // Both operators probed against Davenport (318197) on 09/01/26.
        // NOTE: there is deliberately NO reservation_status clause — see header.
        { cdf: { column: dateColumn }, operator: "greater_than_or_equal", value: from },
        { cdf: { column: dateColumn }, operator: "less_than_or_equal", value: to },
      ],
    },
    settings: { totals: false, details: true },
  };

  let res: Response;
  try {
    res = await fetch(`${DI_BASE}/reports/query/data?mode=Run`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "X-PROPERTY-ID": apiPropertyId,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      next: { revalidate: REVALIDATE_SECONDS },
    });
  } catch (e) {
    return { ok: false, status: 0, error: `Network error reaching Data Insights: ${String(e)}` };
  }

  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* keep raw */
  }
  if (!res.ok) return { ok: false, status: res.status, error: `Data Insights HTTP ${res.status}`, body: parsed };

  const p = parsed as { index?: unknown[] };
  const dims = (Array.isArray(p?.index) ? p.index : []).map((row) =>
    Array.isArray(row) ? row.map((v) => String(v ?? "")) : [String(row ?? "")],
  );
  return { ok: true, data: { dims } };
}

/** Arrivals or departures for one property over one date range. */
async function getDirection(
  apiKey: string,
  apiPropertyId: string,
  direction: MovementDirection,
  days: string[],
  includeGuests: boolean,
): Promise<CloudbedsResult<Record<string, MovementRow[]>>> {
  const from = days[0];
  const to = days[days.length - 1];
  const dateColumn = direction === "arrivals" ? "checkin_date" : "checkout_date";

  // THE GROUPING IS CHOSEN SO THE PII QUERY IS CLEANLY DROPPABLE.
  // `room_numbers` sits with the status, NOT with the name: if rooms shared a
  // query with the guest name, withholding names would also destroy the room
  // column and leave the fallback with nothing but dates.
  const [namesRes, datesRes, roomsRes] = await Promise.all([
    includeGuests
      ? diRangeRows(apiKey, apiPropertyId, dateColumn, from, to, [
          "reservation_number",
          "primary_guest_full_name",
          "guest_count",
        ])
      : Promise.resolve(null),
    diRangeRows(apiKey, apiPropertyId, dateColumn, from, to, [
      "reservation_number",
      "checkin_date",
      "checkout_date",
    ]),
    diRangeRows(apiKey, apiPropertyId, dateColumn, from, to, [
      "reservation_number",
      "room_numbers",
      "reservation_status",
    ]),
  ]);

  // Dates and rooms are both load-bearing; either failing fails the direction,
  // so the caller banks `null` rather than a misleading empty list.
  if (!datesRes.ok) return datesRes;
  if (!roomsRes.ok) return roomsRes;
  // A failed NAME query does not fail the section — it degrades to the PII-free
  // view, which is strictly better than showing nothing.
  const names = namesRes && namesRes.ok ? namesRes.data : null;

  const rows = joinMovementRows({ names, dates: datesRes.data, rooms: roomsRes.data, direction });
  return { ok: true, data: splitByDate(rows, days, direction) };
}

/**
 * Arrivals and departures for every configured property over `days`.
 *
 * `includeGuests` must come from `canViewGuestPii(level)` — do not pass a
 * literal. When false the name query is never issued, so guest names cannot
 * reach the RSC payload at all.
 */
export async function getPortfolioMovements(
  days: string[],
  { includeGuests }: { includeGuests: boolean },
): Promise<PropertyMovements[]> {
  return Promise.all(
    PROPERTIES.map(async (property): Promise<PropertyMovements> => {
      const key = readKey(property.code);
      if (!key || !property.apiPropertyId) {
        return { property, configured: false, arrivals: null, departures: null };
      }
      const [arrivals, departures] = await Promise.all([
        getDirection(key, property.apiPropertyId, "arrivals", days, includeGuests),
        getDirection(key, property.apiPropertyId, "departures", days, includeGuests),
      ]);
      return {
        property,
        configured: true,
        arrivals: arrivals.ok ? arrivals.data : null,
        departures: departures.ok ? departures.data : null,
        error: arrivals.ok ? (departures.ok ? null : departures.error) : arrivals.error,
      };
    }),
  );
}
