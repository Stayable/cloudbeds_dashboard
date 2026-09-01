// The Daily Due-Out Room Walk List — which ROOMS are scheduled to check out on
// a given stay date, so PMs/PAs can schedule inspections.
//
// PII-FREE BY CONSTRUCTION. `primary_guest_full_name` is never requested.
//
// This survived the 09/01/26 widening of CLAUDE.md §5 rule 2 UNCHANGED and must
// keep surviving it. Guest names are now permitted on internal staff dashboards
// (lib/guest-pii.ts), but this list travels to a TEAMS CHANNEL, which is a
// weaker gate than the PIN and is not a "level" at all — no allowlist protects
// it. So the rule here is stricter than the app-wide one, on purpose. If you are
// tempted to add names for symmetry with Home §5: the audience is different.
//
// BALANCES ARE DELIBERATELY NOT ON THIS LIST. The same dataset-3 query returns
// `reservation_balance_due_amount`, and on 08/15/26 a Kissimmee East room due
// out was carrying $11,123.04. That is a real and useful signal, but it belongs
// to collections (/bea), not to an inspection roster: mixing it in changes who
// the message is for and quietly turns a housekeeping list into a debt list
// visible to everyone in the channel.
//
// TIMING IS LOAD-BEARING, MEASURED 08/14/26 — do not "improve" this by running
// it later in the day. The list is defined as reservations Cloudbeds still
// reports `In-House` with a checkout date of the stay date. As guests actually
// depart, their status flips to `Checked Out` and they leave this list. Probed
// on 08-14: Davenport had 4 due-outs that evening and every one of them read
// `Checked Out`, so the In-House list was ZERO. A late run does not report a
// quiet day, it reports nothing at all.
//
// WHY In-House RATHER THAN "any status": the walk list exists to find rooms
// that will need turning. A cancelled or no-show reservation never occupied the
// room, and a checked-out one has already been handled. Same reasoning as
// lib/balance-due.ts — trust Cloudbeds' own `reservation_status` over a date
// window.

import { PROPERTIES, type Property } from "@/config/properties";
import { readKey, type CloudbedsResult } from "@/lib/cloudbeds";

const DI_BASE = "https://api.cloudbeds.com/datainsights/v1.1";

/** A dataset-3 `details:true` result: one entry per reservation row, `dims` in
 *  the order the group columns were requested. Mirrors lib/balance-due.ts. */
type Dataset3Rows = { dims: string[][] };

export type DueOutProperty = {
  property: Property;
  /** Room numbers due out, ascending. `null` means the read FAILED — never an
   *  empty array. Zero due-outs is a completely plausible Tuesday, so a failed
   *  read banked as `[]` is indistinguishable from a real quiet day. That exact
   *  confusion produced months of wrong out-of-order figures (see the
   *  getRoomBlocks pagination note in lib/cloudbeds.ts). */
  rooms: string[] | null;
  /** Reservations behind those rooms. Lower than `rooms.length` whenever a stay
   *  holds more than one room — Jacksonville West was 12 reservations across 15
   *  rooms on 08/15/26, so counting reservations would have under-reported the
   *  walk by three doors. */
  reservations: number | null;
};

/**
 * Split, de-duplicate and order the room numbers behind a set of due-out
 * reservations. Pure — the network shape is the only input.
 *
 * `room_numbers` arrives comma-joined when a reservation holds several rooms.
 * De-duplication is across reservations too: a room can legitimately appear on
 * two rows (observed at Jacksonville West on 08/15/26, room 324), and a walk
 * list must name each door once.
 */
export function foldDueOutRooms(rows: Dataset3Rows): { rooms: string[]; reservations: number } {
  const rooms = new Set<string>();
  const seenRes = new Set<string>();

  for (const dims of rows.dims) {
    const [resNo, roomField] = dims;
    if (!resNo || seenRes.has(resNo)) continue;
    seenRes.add(resNo);
    for (const room of (roomField ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
      rooms.add(room);
    }
  }

  return {
    // Numeric-aware so 106 precedes 1102 and the walk runs in door order.
    // Non-numeric room names (Lakeland has an "APT1") fall back to string order
    // rather than becoming NaN and sorting arbitrarily.
    rooms: [...rooms].sort((a, b) => {
      const na = Number(a);
      const nb = Number(b);
      if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
      return a.localeCompare(b);
    }),
    reservations: seenRes.size,
  };
}

/** One dataset-3 read of the day's due-outs, grouped by `groupColumns`
 *  (max THREE — the API rejects a fourth). */
async function diDueOutRows(
  apiKey: string,
  apiPropertyId: string,
  day: string,
  groupColumns: string[],
): Promise<CloudbedsResult<Dataset3Rows>> {
  const body = {
    property_ids: [Number(apiPropertyId)],
    dataset_id: 3,
    // A MEASURE column is required even though the list only needs dimensions.
    // `reservation_balance_due_amount` is used because it is proven to exist on
    // dataset 3 (lib/balance-due.ts). The value is discarded — see the header on
    // why balances are not published here. Asking for `reservation_id` instead
    // makes the whole query 400: it is a dimension, not a measure.
    columns: [{ cdf: { column: "reservation_balance_due_amount" } }],
    group_rows: groupColumns.map((column) => ({ cdf: { column } })),
    filters: {
      and: [
        // `equals` on checkout_date verified against all 8 live properties
        // 08/14/26 — it was an open question whether dataset 3 accepted
        // anything but the range operators.
        { cdf: { column: "checkout_date" }, operator: "equals", value: day },
        { cdf: { column: "reservation_status" }, operator: "equals", value: "In-House" },
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
      cache: "no-store", // a walk list must never be served from a cache
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

/** Due-out rooms for one property on `day`. */
export async function getDueOuts(
  apiKey: string,
  apiPropertyId: string,
  day: string,
): Promise<CloudbedsResult<{ rooms: string[]; reservations: number }>> {
  const res = await diDueOutRows(apiKey, apiPropertyId, day, ["reservation_number", "room_numbers"]);
  if (!res.ok) return res;
  return { ok: true, data: foldDueOutRooms(res.data) };
}

/** One due-out reservation, with the fields the DDF Refund workbook tracks. */
export type DueOutReservation = {
  reservationNumber: string;
  rooms: string[];
  /** `checkin_date`, blank when the arrival query did not resolve. */
  arrival: string;
};

/** Due-out reservations for one property with arrival dates attached.
 *
 *  TWO queries joined on `reservation_number`, because dataset 3's `group_rows`
 *  caps at THREE columns and a blank third slot still costs a round trip — the
 *  same cap and the same join lib/balance-due.ts documents. A reservation
 *  missing from the arrivals query keeps its row with a blank arrival rather
 *  than being dropped: a room that needs walking still needs walking. */
export async function getDueOutDetail(
  apiKey: string,
  apiPropertyId: string,
  day: string,
): Promise<CloudbedsResult<DueOutReservation[]>> {
  const [main, arrivals] = await Promise.all([
    diDueOutRows(apiKey, apiPropertyId, day, ["reservation_number", "room_numbers"]),
    diDueOutRows(apiKey, apiPropertyId, day, ["reservation_number", "checkin_date"]),
  ]);
  if (!main.ok) return main;

  const arrivalByRes = new Map<string, string>();
  if (arrivals.ok) {
    for (const [resNo, checkin] of arrivals.data.dims) {
      if (resNo && !arrivalByRes.has(resNo)) arrivalByRes.set(resNo, checkin ?? "");
    }
  }

  const seen = new Set<string>();
  const out: DueOutReservation[] = [];
  for (const [resNo, roomField] of main.data.dims) {
    if (!resNo || seen.has(resNo)) continue;
    seen.add(resNo);
    out.push({
      reservationNumber: resNo,
      rooms: (roomField ?? "").split(",").map((s) => s.trim()).filter(Boolean),
      arrival: arrivalByRes.get(resNo) ?? "",
    });
  }
  return { ok: true, data: out };
}

/** Every property's due-out rooms for `day`. A property with no configured key,
 *  or whose read failed, reports `null` rather than an empty list. */
export async function getPortfolioDueOuts(day: string): Promise<DueOutProperty[]> {
  return Promise.all(
    PROPERTIES.map(async (property): Promise<DueOutProperty> => {
      const key = readKey(property.code);
      if (!key || !property.apiPropertyId) return { property, rooms: null, reservations: null };
      const result = await getDueOuts(key, property.apiPropertyId, day);
      if (!result.ok) return { property, rooms: null, reservations: null };
      return { property, rooms: result.data.rooms, reservations: result.data.reservations };
    }),
  );
}

/** en-US long date for a YYYY-MM-DD, rendered in UTC so the string cannot drift
 *  a day against the reader's own timezone. */
function prettyDate(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * The Adaptive Card posted to the "Daily Due Out or Departures" flow.
 *
 * Pure, so the wording and the failure presentation are unit-testable without a
 * network. Property IDs are on every row per CLAUDE.md §3/§7.
 */
export function buildDueOutCard(
  day: string,
  rows: DueOutProperty[],
  opts: {
    test?: boolean;
    /** Link to the DDF Refund workbook the team works the day in. Renders as a
     *  button. It opens the WORKBOOK, not a specific tab — a deep link to a
     *  sheet only resolves once that sheet exists, and the sheet is created by
     *  the flow, after this card is built. Never synthesise a tab link here. */
    workbookUrl?: string;
  } = {},
): object {
  const failed = rows.filter((r) => r.rooms === null);
  const read = rows.filter((r) => r.rooms !== null);
  const totalRooms = read.reduce((n, r) => n + (r.rooms?.length ?? 0), 0);

  const facts = rows.map((r) => ({
    title: `${r.property.name} (${r.property.id})`,
    value:
      r.rooms === null
        ? "unavailable — Cloudbeds did not respond"
        : r.rooms.length === 0
          ? "no rooms due out"
          : `${r.rooms.length} room${r.rooms.length === 1 ? "" : "s"} — ${r.rooms.join(", ")}`,
  }));

  const body: object[] = [
    {
      type: "TextBlock",
      text: opts.test ? "TEST — Due-Out Room Walk List" : "Due-Out Room Walk List",
      weight: "Bolder",
      size: "Large",
      wrap: true,
    },
  ];

  if (opts.test) {
    body.push({
      type: "TextBlock",
      text: "Test of an automated 9:00 AM delivery. **No action is required.**",
      wrap: true,
      color: "Attention",
    });
  }

  body.push(
    { type: "TextBlock", text: prettyDate(day), weight: "Bolder", wrap: true, spacing: "Medium" },
    {
      type: "TextBlock",
      text: `${totalRooms} room${totalRooms === 1 ? "" : "s"} scheduled to check out across ${read.length} propert${read.length === 1 ? "y" : "ies"}.`,
      wrap: true,
    },
    { type: "FactSet", facts },
    {
      type: "TextBlock",
      text:
        "Source: Cloudbeds — reservations still In-House with a checkout date of the day shown. " +
        "Rooms only, no guest details. A room already vacated before this was built does not appear." +
        // Named, not silently averaged away: a partial list must never read as a
        // complete one. Same rule the /report surfaces follow for partial counts.
        (failed.length
          ? ` **${failed.length} propert${failed.length === 1 ? "y" : "ies"} could not be read and ${failed.length === 1 ? "is" : "are"} shown as unavailable, not as zero.**`
          : ""),
      wrap: true,
      isSubtle: true,
      size: "Small",
      spacing: "Medium",
    },
  );

  return {
    type: "AdaptiveCard",
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    version: "1.4",
    body,
    ...(opts.workbookUrl
      ? {
          actions: [
            { type: "Action.OpenUrl", title: "Open DDF Refund workbook", url: opts.workbookUrl },
          ],
        }
      : {}),
  };
}
