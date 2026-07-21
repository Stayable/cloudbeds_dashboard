// Server-side Cloudbeds API client. NEVER import this from a client component.
// API keys live in server-only env vars and must never reach the browser
// (CLAUDE.md §5 rule 1). This module is read-only — it never writes to Cloudbeds.
//
// Auth (verified against Cloudbeds docs 2026-06-18):
//   Base URL : https://hotels.cloudbeds.com/api/v1.3
//   Header   : Authorization: Bearer cbat_...   (alt: x-api-key: cbat_...)
//   Scope    : one scoped key per property. Each key resolves its own property,
//              so we do NOT pass propertyID. Env var: CLOUDBEDS_API_KEY_<CODE>.

import { PROPERTIES, type Property } from "@/config/properties";
import { classifyRatePlan } from "@/lib/lease";
import { dayCount, easternToday, monthStart, shiftYmd } from "@/lib/dates";
import { getEarliestSnapshotDate, getReportSnapshots, upsertReportSnapshot, type ReportSnapshotRow } from "@/lib/db";
import {
  classifyForReport,
  derive,
  sumSnapshotRows,
  SOURCE_NOTE,
  type DerivedRow,
  type PeriodBlock,
  type PropertyActual,
  type PropertyOnTheBooks,
  type RevenueReport,
  type RowInputs,
} from "@/lib/revenue-report";

const BASE_URL = "https://hotels.cloudbeds.com/api/v1.3";

// Cache server-side to stay within rate limits and keep the page fast
// (CLAUDE.md §5 rule 4). 10-minute TTL.
const REVALIDATE_SECONDS = 600;

export type CloudbedsResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string; body?: unknown };

/** Read a property's scoped key from env. Davenport keeps a legacy fallback. */
export function readKey(code: string): string | null {
  const direct = process.env[`CLOUDBEDS_API_KEY_${code}`];
  if (direct && direct.trim().length > 0) return direct.trim();
  // Migration cushion: Davenport may still use the original unsuffixed var.
  if (code === "DP") {
    const legacy = process.env.CLOUDBEDS_API_KEY;
    if (legacy && legacy.trim().length > 0) return legacy.trim();
  }
  return null;
}

async function cbGet<T = unknown>(
  apiKey: string,
  path: string,
  params: Record<string, string> = {},
): Promise<CloudbedsResult<T>> {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      next: { revalidate: REVALIDATE_SECONDS },
    });
  } catch (e) {
    return { ok: false, status: 0, error: `Network error reaching Cloudbeds: ${String(e)}` };
  }

  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* leave as raw text */
  }

  if (!res.ok) {
    return { ok: false, status: res.status, error: `Cloudbeds returned HTTP ${res.status}`, body: parsed };
  }

  // Cloudbeds wraps every response in a { success, data, message } envelope and
  // returns success:false WITH HTTP 200 for logical errors (e.g. property-ID
  // mismatch). Treat success:false as an error, and unwrap the inner `data`.
  if (parsed && typeof parsed === "object" && "success" in parsed) {
    const env = parsed as { success: boolean; data?: unknown; message?: string };
    if (!env.success) {
      return { ok: false, status: res.status, error: env.message ?? "Cloudbeds returned success:false", body: parsed };
    }
    return { ok: true, data: env.data as T };
  }

  return { ok: true, data: parsed as T };
}

/** Property record from getHotels (subset of fields we rely on). */
export type Hotel = {
  propertyID: string;
  organizationID: string;
  propertyName: string;
  propertyTimezone: string;
  propertyCurrency?: { currencyCode: string; currencySymbol: string; currencyPosition: string };
};

/**
 * getDashboard response (verified against the live Davenport response
 * 2026-06-18). Note: `arrivals`/`departures` come back as STRINGS. ADR/RevPAR/
 * revenue are NOT in this endpoint — those need the Data Insights endpoints.
 */
export type DashboardData = {
  property_now: string;
  timezone: string;
  gmt_offset_hours: number;
  roomsOccupied: number;
  percentageOccupied: number;
  arrivals: string;
  departures: string;
  inHouse: number;
  guestsInHouse: number;
  arrivalsConfirmed: number;
  departuresConfirmed: number;
  bookings: number;
  stayovers: number;
  cancellations: number;
  roomsBlocked: number;
  roomBlocks: { blocked_dates: number; out_of_service: number };
  percentageBlocked: number;
  capacity: number;
};

/** Properties this key can access (use to verify a property's real API ID). */
export function getHotels(apiKey: string) {
  return cbGet<Hotel[]>(apiKey, `/getHotels`);
}

/** Current operating snapshot. Key resolves its own property — no propertyID. */
export function getDashboard(apiKey: string) {
  return cbGet<DashboardData>(apiKey, `/getDashboard`);
}

export type PropertyDashboard = {
  property: Property;
  configured: boolean; // a key is set for this property
  result: CloudbedsResult<DashboardData> | null;
};

/** Fetch every configured property's dashboard in parallel. */
export async function getPortfolio(): Promise<PropertyDashboard[]> {
  return Promise.all(
    PROPERTIES.map(async (property): Promise<PropertyDashboard> => {
      const key = readKey(property.code);
      if (!key) return { property, configured: false, result: null };
      return { property, configured: true, result: await getDashboard(key) };
    }),
  );
}

// --- Out-of-service rooms (which rooms, not just the count) ------------------
// getRoomBlocks lists out_of_service blocks (room + reason + dates); getRooms
// maps roomID → room name/type. Room identifiers are inventory, not guest PII.

/** Human room identity from getRooms: the room CODE (roomName, e.g. "133"),
 *  the type ("Single Studio") and the type short-code ("1DS") — the same
 *  code+type pairing the lock-app keys on. The Cloudbeds-internal roomID
 *  (`<roomTypeID>-<seq>`, e.g. "673007-30") is deliberately NOT a fallback
 *  identity: it is meaningless to ops and looks like a room number. */
export type OooRoomInfo = { roomName: string; roomTypeName: string; roomTypeCode: string };
type RawRooms = {
  propertyID: string;
  rooms: { roomID: string; roomName: string; roomTypeName: string; roomTypeNameShort?: string }[];
}[];
type RawBlock = {
  roomBlockType: string;
  roomBlockReason: string;
  startDate: string;
  endDate: string;
  rooms: { roomID: string }[];
};
type RawBlocks = { roomBlocks: RawBlock[] };

export type OooRoom = {
  room: string; // room code (roomName); "" when the name map could not resolve it
  roomType: string;
  roomTypeCode: string;
  reason: string;
  startDate: string;
  endDate: string;
};

/** All rooms for a property → roomID → code/type. getRooms is paginated
 *  (~20–100/page), so page through until a short/empty page. `loaded` is true
 *  iff getRooms answered at least once — distinguishes "no rooms" from "the key
 *  lacks the Room scope" (Roomblock-only keys would otherwise render raw IDs). */
async function getRoomNameMap(apiKey: string): Promise<{ map: Map<string, OooRoomInfo>; loaded: boolean }> {
  const map = new Map<string, OooRoomInfo>();
  let loaded = false;
  const PAGE = 100;
  for (let page = 1; page <= 20; page++) {
    const res = await cbGet<RawRooms>(apiKey, `/getRooms`, {
      pageNumber: String(page),
      pageSize: String(PAGE),
    });
    if (!res.ok) break;
    loaded = true;
    const batch = (res.data ?? []).flatMap((p) => p.rooms ?? []);
    for (const r of batch)
      map.set(r.roomID, {
        roomName: r.roomName,
        roomTypeName: r.roomTypeName,
        roomTypeCode: r.roomTypeNameShort ?? "",
      });
    if (batch.length < PAGE) break;
  }
  return { map, loaded };
}

/** Map out-of-service blocks → rooms using the name map. Pure (no I/O) so the
 *  no-raw-id guarantee is unit-tested. Unresolved roomIDs get a blank `room`
 *  (the UI shows a placeholder + a "Room scope" notice) — never the raw id. */
export function buildOooRooms(nameById: Map<string, OooRoomInfo>, roomBlocks: RawBlock[]): OooRoom[] {
  const out: OooRoom[] = [];
  for (const b of roomBlocks ?? []) {
    if (b.roomBlockType !== "out_of_service") continue;
    for (const r of b.rooms ?? []) {
      const info = nameById.get(r.roomID);
      out.push({
        room: info?.roomName ?? "",
        roomType: info?.roomTypeName ?? "",
        roomTypeCode: info?.roomTypeCode ?? "",
        reason: b.roomBlockReason || "—",
        startDate: b.startDate,
        endDate: b.endDate,
      });
    }
  }
  // Stable sort by room code (numeric-aware); unresolved ("") sort last.
  out.sort((a, b) => {
    if (!a.room) return 1;
    if (!b.room) return -1;
    return a.room.localeCompare(b.room, undefined, { numeric: true });
  });
  return out;
}

/** Out-of-service rooms active on `asOf` (YYYY-MM-DD) for one property, with
 *  room codes + types. Errors if the room-name source is unavailable while
 *  blocks exist (key missing the Room scope) so the UI surfaces that rather
 *  than rendering internal roomIDs as fake room numbers. */
async function getOooRooms(apiKey: string, asOf: string): Promise<CloudbedsResult<OooRoom[]>> {
  const [nameRes, blocksRes] = await Promise.all([
    getRoomNameMap(apiKey),
    cbGet<RawBlocks>(apiKey, `/getRoomBlocks`, { startDate: asOf, endDate: asOf }),
  ]);
  if (!blocksRes.ok) return blocksRes;

  const blocks = blocksRes.data?.roomBlocks ?? [];
  const hasOos = blocks.some((b) => b.roomBlockType === "out_of_service");
  // Roomblock scope works but Room scope does not: we have blocks but no names.
  if (!nameRes.loaded && hasOos) {
    return {
      ok: false,
      status: 403,
      error: "Room scope missing on this property's key — re-issue it with the Room scope to show room numbers.",
    };
  }
  return { ok: true, data: buildOooRooms(nameRes.map, blocks) };
}

export type PropertyOoo = {
  property: Property;
  configured: boolean;
  result: CloudbedsResult<OooRoom[]> | null;
};

/** Out-of-service rooms per configured property, as of `asOf`. */
export async function getPortfolioOoo(asOf: string): Promise<PropertyOoo[]> {
  return Promise.all(
    PROPERTIES.map(async (property): Promise<PropertyOoo> => {
      const key = readKey(property.code);
      if (!key) return { property, configured: false, result: null };
      return { property, configured: true, result: await getOooRooms(key, asOf) };
    }),
  );
}

// --- Room inventory with OOO overlay (for the zone view) --------------------
// All rooms for a property (code + type), each flagged if it is out_of_service
// on `asOf`. Room codes are inventory identifiers, not guest PII.

export type RoomStatus = {
  name: string;
  type: string;
  ooo: boolean; // out of service on asOf (room block)
  occupied: boolean; // In-House reservation overlaps asOf
  reason?: string; // OOO reason
};

/** Room numbers occupied (reservation status In-House, stay overlaps `asOf`) for
 *  one property, from DI Reservations dataset 3. PII-FREE: groups on room_numbers
 *  + reservation_status with a room_count measure — no guest fields requested.
 *  Best-effort overlay: any failure returns an empty set (rooms still list). */
async function getOccupiedRoomNumbers(apiKey: string, apiPropertyId: string, asOf: string): Promise<Set<string>> {
  const occupied = new Set<string>();
  const body = {
    property_ids: [Number(apiPropertyId)],
    dataset_id: 3,
    columns: [{ cdf: { column: "room_count" } }],
    group_rows: [{ cdf: { column: "room_numbers" } }, { cdf: { column: "reservation_status" } }],
    filters: {
      and: [
        { cdf: { column: "checkin_date" }, operator: "less_than_or_equal", value: asOf },
        { cdf: { column: "checkout_date" }, operator: "greater_than_or_equal", value: asOf },
      ],
    },
    settings: { totals: false, details: true },
  };
  try {
    const res = await fetch(`${DI_BASE}/reports/query/data?mode=Run`, {
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
    if (!res.ok) return occupied;
    const parsed = (await res.json()) as { index?: unknown[] };
    for (const row of Array.isArray(parsed.index) ? parsed.index : []) {
      if (!Array.isArray(row)) continue;
      if (String(row[1] ?? "") !== "In-House") continue;
      // room_numbers can be a comma/space-joined list for multi-room bookings.
      for (const rn of String(row[0] ?? "").split(/[\s,]+/)) {
        const t = rn.trim();
        if (t) occupied.add(t);
      }
    }
  } catch {
    /* best-effort overlay — leave the set empty */
  }
  return occupied;
}

/** Every room for one property + OOO and occupied overlays as of `asOf`. Fails
 *  only if the key lacks the Room scope (no room-name source) so the UI can
 *  surface that rather than showing internal roomIDs as fake room numbers.
 *  `apiPropertyId` (null when unverified) enables the occupied overlay. */
async function getRoomsWithStatus(
  apiKey: string,
  apiPropertyId: string | null,
  asOf: string,
): Promise<CloudbedsResult<RoomStatus[]>> {
  const [nameRes, blocksRes, occupied] = await Promise.all([
    getRoomNameMap(apiKey),
    cbGet<RawBlocks>(apiKey, `/getRoomBlocks`, { startDate: asOf, endDate: asOf }),
    apiPropertyId ? getOccupiedRoomNumbers(apiKey, apiPropertyId, asOf) : Promise.resolve(new Set<string>()),
  ]);
  if (!nameRes.loaded) {
    return {
      ok: false,
      status: 403,
      error: "Room scope missing on this property's key — re-issue it with the Room scope to list rooms.",
    };
  }
  // roomID → reason for out_of_service blocks active on asOf (blocks are a
  // nice-to-have overlay; if that call failed we still list the rooms).
  const oooById = new Map<string, string>();
  for (const b of blocksRes.ok ? blocksRes.data?.roomBlocks ?? [] : []) {
    if (b.roomBlockType !== "out_of_service") continue;
    for (const r of b.rooms ?? []) oooById.set(r.roomID, b.roomBlockReason || "—");
  }

  const rooms: RoomStatus[] = [];
  for (const [roomID, info] of nameRes.map) {
    if (!info.roomName) continue; // never surface an internal id as a room number
    rooms.push({
      name: info.roomName,
      type: info.roomTypeName,
      ooo: oooById.has(roomID),
      occupied: occupied.has(info.roomName),
      reason: oooById.get(roomID),
    });
  }
  return { ok: true, data: rooms };
}

export type PropertyRooms = {
  property: Property;
  configured: boolean;
  result: CloudbedsResult<RoomStatus[]> | null;
};

/** Full room inventory (OOO + occupied overlays) per configured property. */
export async function getPortfolioRooms(asOf: string): Promise<PropertyRooms[]> {
  return Promise.all(
    PROPERTIES.map(async (property): Promise<PropertyRooms> => {
      const key = readKey(property.code);
      if (!key) return { property, configured: false, result: null };
      return {
        property,
        configured: true,
        result: await getRoomsWithStatus(key, property.apiPropertyId, asOf),
      };
    }),
  );
}

// --- Data Insights (date-ranged occupancy / ADR / RevPAR) -------------------
// Confirmed query shape (see memory data-insights-occupancy). occupancy/adr/
// revpar auto-aggregate; counts/currency are not requested (no aggregation key
// in public docs) — revenue is derived as RevPAR × capacity by the caller.

const DI_BASE = "https://api.cloudbeds.com/datainsights/v1.1";

export type OccupancyRow = {
  date: string; // YYYY-MM-DD
  occupancy: number; // %
  adr: number;
  revpar: number;
};

/** Daily occupancy/ADR/RevPAR for a property over [start, end] (YYYY-MM-DD). */
export async function getInsightsOccupancy(
  apiKey: string,
  apiPropertyId: string,
  start: string,
  end: string,
): Promise<CloudbedsResult<OccupancyRow[]>> {
  const body = {
    property_ids: [Number(apiPropertyId)],
    dataset_id: 7,
    columns: [
      { cdf: { column: "occupancy" } },
      { cdf: { column: "adr" } },
      { cdf: { column: "revpar" } },
    ],
    group_rows: [{ cdf: { column: "stay_date" }, modifier: "day" }],
    filters: {
      and: [
        { cdf: { column: "stay_date" }, operator: "greater_than_or_equal", value: start },
        { cdf: { column: "stay_date" }, operator: "less_than_or_equal", value: end },
      ],
    },
    settings: { totals: false, details: false },
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
  if (!res.ok) {
    return { ok: false, status: res.status, error: `Data Insights HTTP ${res.status}`, body: parsed };
  }

  const records = (parsed as { records?: Record<string, Record<string, { aggregated?: number }>> })?.records ?? {};
  const agg = (cell?: { aggregated?: number }) =>
    typeof cell?.aggregated === "number" ? cell.aggregated : 0;
  const rows: OccupancyRow[] = Object.keys(records)
    .sort()
    .map((date) => {
      const r = records[date] ?? {};
      return { date, occupancy: agg(r.occupancy), adr: agg(r.adr), revpar: agg(r.revpar) };
    });
  return { ok: true, data: rows };
}

export type PropertyInsights = {
  property: Property;
  configured: boolean;
  result: CloudbedsResult<OccupancyRow[]> | null;
};

/** Date-ranged occupancy for every configured property, in parallel. */
export async function getPortfolioInsights(start: string, end: string): Promise<PropertyInsights[]> {
  return Promise.all(
    PROPERTIES.map(async (property): Promise<PropertyInsights> => {
      const key = readKey(property.code);
      if (!key || !property.apiPropertyId) return { property, configured: false, result: null };
      return {
        property,
        configured: true,
        result: await getInsightsOccupancy(key, property.apiPropertyId, start, end),
      };
    }),
  );
}

// --- Reservation aggregates (date-ranged, PII-free) -------------------------
// For the /crystal §4 view. Dataset 3 (Reservations) is FULL of guest PII
// (primary_guest_email/full_name/document_number/birth_date/…). We request ONLY
// aggregate-safe numeric measures + a category dimension, with details:true (the
// proven shape: index[i]=[dimensionValue], records[col][i]=value per reservation
// row), and sum CLIENT-SIDE into totals/breakdowns. No per-reservation rows are
// ever exposed. Column names verified live against Davenport (318197) 2026-06-25
// via scripts/probe-reservation-fields.mjs.
//
// Scope: reservations whose stay OVERLAPS [start,end]
//   checkin_date <= end AND checkout_date >= start.
// Currency/night/guest TOTALS exclude Cancelled and No-Show (not on the books);
// the status mix still reports every status so they're visible.

const RES_CANCELLED_STATUSES = new Set(["Cancelled", "Canceled", "No-Show", "No Show"]);

export type ReservationAggregates = {
  // Totals over on-the-books (non-cancelled/no-show) reservations active in range.
  rooms: number;
  roomNights: number;
  guests: number;
  grandTotal: number;
  paid: number;
  balanceDue: number;
  fees: number; // Σ fees_value_amount
  taxes: number; // Σ taxes_value_amount
  commission: number; // Σ channel_commission_amount
  // Breakdowns of rooms-on-books.
  statusMix: Record<string, number>; // ALL statuses, rooms by status
  leaseMix: LeaseMix; // monthly/weekly/transient (rooms), via classifyRatePlan
  roomTypeCategoryMix: Record<string, number>; // rooms by category (private/shared)
};

type Dataset3Grouped = { index: string[]; records: Record<string, number[]> };

async function diDataset3Grouped(
  apiKey: string,
  apiPropertyId: string,
  groupColumn: string,
  measureColumns: string[],
  start: string,
  end: string,
): Promise<CloudbedsResult<Dataset3Grouped>> {
  const body = {
    property_ids: [Number(apiPropertyId)],
    dataset_id: 3,
    columns: measureColumns.map((column) => ({ cdf: { column } })),
    group_rows: [{ cdf: { column: groupColumn } }],
    filters: {
      and: [
        { cdf: { column: "checkin_date" }, operator: "less_than_or_equal", value: end },
        { cdf: { column: "checkout_date" }, operator: "greater_than_or_equal", value: start },
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

  const p = parsed as { index?: unknown[]; records?: Record<string, unknown[]> };
  const index = (Array.isArray(p?.index) ? p.index : []).map((row) =>
    Array.isArray(row) ? String(row[0] ?? "") : String(row ?? ""),
  );
  const records: Record<string, number[]> = {};
  for (const col of measureColumns) {
    const arr = Array.isArray(p?.records?.[col]) ? p.records![col] : [];
    records[col] = arr.map((x) => (typeof x === "number" ? x : 0));
  }
  return { ok: true, data: { index, records } };
}

/** PII-free reservation aggregates for one property over [start, end]. */
async function getReservationAggregates(
  apiKey: string,
  apiPropertyId: string,
  start: string,
  end: string,
): Promise<CloudbedsResult<ReservationAggregates>> {
  // One query carries totals + status mix; two more carry the breakdowns.
  const [byStatus, byPlan, byCategory] = await Promise.all([
    diDataset3Grouped(
      apiKey,
      apiPropertyId,
      "reservation_status",
      [
        "room_count",
        "room_nights_count",
        "guest_count",
        "grand_total_amount",
        "reservation_paid_amount",
        "reservation_balance_due_amount",
        "fees_value_amount",
        "taxes_value_amount",
        "channel_commission_amount",
      ],
      start,
      end,
    ),
    diDataset3Grouped(apiKey, apiPropertyId, "public_rate_plan", ["room_count"], start, end),
    diDataset3Grouped(apiKey, apiPropertyId, "room_type_categories", ["room_count"], start, end),
  ]);

  if (!byStatus.ok) return byStatus;

  const agg: ReservationAggregates = {
    rooms: 0,
    roomNights: 0,
    guests: 0,
    grandTotal: 0,
    paid: 0,
    balanceDue: 0,
    fees: 0,
    taxes: 0,
    commission: 0,
    statusMix: {},
    leaseMix: { monthly: 0, weekly: 0, transient: 0, total: 0 },
    roomTypeCategoryMix: {},
  };

  const s = byStatus.data;
  for (let i = 0; i < s.index.length; i++) {
    const status = s.index[i] || "Unknown";
    const rooms = s.records.room_count[i] ?? 0;
    agg.statusMix[status] = (agg.statusMix[status] ?? 0) + rooms;
    if (RES_CANCELLED_STATUSES.has(status)) continue; // exclude from on-the-books totals
    agg.rooms += rooms;
    agg.roomNights += s.records.room_nights_count[i] ?? 0;
    agg.guests += s.records.guest_count[i] ?? 0;
    agg.grandTotal += s.records.grand_total_amount[i] ?? 0;
    agg.paid += s.records.reservation_paid_amount[i] ?? 0;
    agg.balanceDue += s.records.reservation_balance_due_amount[i] ?? 0;
    agg.fees += s.records.fees_value_amount[i] ?? 0;
    agg.taxes += s.records.taxes_value_amount[i] ?? 0;
    agg.commission += s.records.channel_commission_amount[i] ?? 0;
  }

  if (byPlan.ok) {
    for (let i = 0; i < byPlan.data.index.length; i++) {
      const rooms = byPlan.data.records.room_count[i] ?? 0;
      const cls = classifyRatePlan(byPlan.data.index[i]);
      if (cls === "lease-monthly") agg.leaseMix.monthly += rooms;
      else if (cls === "lease-weekly") agg.leaseMix.weekly += rooms;
      else agg.leaseMix.transient += rooms;
      agg.leaseMix.total += rooms;
    }
  }

  if (byCategory.ok) {
    for (let i = 0; i < byCategory.data.index.length; i++) {
      const cat = byCategory.data.index[i] || "Uncategorized";
      agg.roomTypeCategoryMix[cat] = (agg.roomTypeCategoryMix[cat] ?? 0) + (byCategory.data.records.room_count[i] ?? 0);
    }
  }

  return { ok: true, data: agg };
}

export type PropertyReservations = {
  property: Property;
  configured: boolean;
  result: CloudbedsResult<ReservationAggregates> | null;
};

/** Reservation aggregates for every configured property over [start, end]. */
export async function getPortfolioReservations(start: string, end: string): Promise<PropertyReservations[]> {
  return Promise.all(
    PROPERTIES.map(async (property): Promise<PropertyReservations> => {
      const key = readKey(property.code);
      if (!key || !property.apiPropertyId) return { property, configured: false, result: null };
      return {
        property,
        configured: true,
        result: await getReservationAggregates(key, property.apiPropertyId, start, end),
      };
    }),
  );
}

// --- Finance transactions (date-ranged, PII-free) ---------------------------
// DI dataset 1 (Finances). Like dataset 3 it carries guest PII
// (primary_guest_full_name, invoice_guest_name, …) — we request ONLY numeric
// measures + safe dimensions and sum client-side. Verified live against
// Davenport 2026-06-25:
//   measures: debit_amount (charges), credit_amount (payments/credits),
//             balance_due_amount (net transaction amount).
//   dims: transaction_type, payment_method. Date filter: service_date in range.
//
// Dataset 1 only returns measure values with settings.details:true, which
// Cloudbeds HARD-CAPS at 1500 detail rows per query (response
// `aggregated_count: 1500`); details:false/totals:true return empty `records`.
// Finance is transaction-level, so a whole-range query can exceed 1500 and a
// naive sum would silently undercount. FIX (verified live 2026-06-25): chunk the
// query PER DAY — each day returns far fewer rows than the cap (Davenport peak
// ~250/day) and the per-day sums reconcile exactly to the true total. We still
// flag `capped:true` if any single day hits 1500, so the UI can warn rather than
// quietly undercount.

export type FinanceAggregates = {
  charges: number; // Σ debit_amount
  paymentsCredits: number; // Σ credit_amount
  net: number; // Σ balance_due_amount
  typeMix: Record<string, number>; // charges by transaction_type
  paymentMethodMix: Record<string, number>; // payments by payment_method
  capped: boolean; // true if any day hit the 1500-row cap (totals may undercount)
};

async function diDataset1Grouped(
  apiKey: string,
  apiPropertyId: string,
  groupColumn: string,
  measureColumns: string[],
  start: string,
  end: string,
  // Additive, optional: extra AND-ed filters beyond the service_date range
  // (e.g. transaction_type="Room Rate" for the revenue-report split). Existing
  // callers (getFinanceAggregates) omit this and are unaffected.
  extraFilters: { cdf: { column: string }; operator: string; value: string }[] = [],
): Promise<CloudbedsResult<Dataset3Grouped>> {
  const body = {
    property_ids: [Number(apiPropertyId)],
    dataset_id: 1,
    columns: measureColumns.map((column) => ({ cdf: { column } })),
    group_rows: [{ cdf: { column: groupColumn } }],
    filters: {
      and: [
        { cdf: { column: "service_date" }, operator: "greater_than_or_equal", value: start },
        { cdf: { column: "service_date" }, operator: "less_than_or_equal", value: end },
        ...extraFilters,
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

  const p = parsed as { index?: unknown[]; records?: Record<string, unknown[]> };
  const index = (Array.isArray(p?.index) ? p.index : []).map((row) =>
    Array.isArray(row) ? String(row[0] ?? "") : String(row ?? ""),
  );
  const records: Record<string, number[]> = {};
  for (const col of measureColumns) {
    const arr = Array.isArray(p?.records?.[col]) ? p.records![col] : [];
    records[col] = arr.map((x) => (typeof x === "number" ? x : 0));
  }
  return { ok: true, data: { index, records } };
}

const FINANCE_ROW_CAP = 1500;

async function getFinanceAggregates(
  apiKey: string,
  apiPropertyId: string,
  start: string,
  end: string,
): Promise<CloudbedsResult<FinanceAggregates>> {
  // Per-day chunking to stay under the 1500 detail-row cap (see note above).
  const n = dayCount(start, end);
  const days = Array.from({ length: n }, (_, i) => shiftYmd(start, i));

  const perDay = await Promise.all(
    days.map(async (d) => {
      const [byType, byMethod] = await Promise.all([
        diDataset1Grouped(apiKey, apiPropertyId, "transaction_type", ["debit_amount", "credit_amount", "balance_due_amount"], d, d),
        diDataset1Grouped(apiKey, apiPropertyId, "payment_method", ["credit_amount"], d, d),
      ]);
      return { byType, byMethod };
    }),
  );

  // If every day failed, surface the first error.
  const firstErr = perDay.find((r) => !r.byType.ok)?.byType;
  if (firstErr && perDay.every((r) => !r.byType.ok)) return firstErr as CloudbedsResult<FinanceAggregates>;

  const agg: FinanceAggregates = {
    charges: 0,
    paymentsCredits: 0,
    net: 0,
    typeMix: {},
    paymentMethodMix: {},
    capped: false,
  };

  for (const { byType, byMethod } of perDay) {
    if (byType.ok) {
      const t = byType.data;
      if (t.index.length >= FINANCE_ROW_CAP) agg.capped = true;
      for (let i = 0; i < t.index.length; i++) {
        const type = t.index[i] || "Other";
        const debit = t.records.debit_amount[i] ?? 0;
        agg.charges += debit;
        agg.paymentsCredits += t.records.credit_amount[i] ?? 0;
        agg.net += t.records.balance_due_amount[i] ?? 0;
        if (debit !== 0) agg.typeMix[type] = (agg.typeMix[type] ?? 0) + debit;
      }
    }
    if (byMethod.ok) {
      if (byMethod.data.index.length >= FINANCE_ROW_CAP) agg.capped = true;
      for (let i = 0; i < byMethod.data.index.length; i++) {
        const method = byMethod.data.index[i] || "Unspecified";
        const credit = byMethod.data.records.credit_amount[i] ?? 0;
        if (credit !== 0) agg.paymentMethodMix[method] = (agg.paymentMethodMix[method] ?? 0) + credit;
      }
    }
  }
  return { ok: true, data: agg };
}

export type PropertyFinance = {
  property: Property;
  configured: boolean;
  result: CloudbedsResult<FinanceAggregates> | null;
};

/** Finance aggregates for every configured property over [start, end]. */
export async function getPortfolioFinance(start: string, end: string): Promise<PropertyFinance[]> {
  return Promise.all(
    PROPERTIES.map(async (property): Promise<PropertyFinance> => {
      const key = readKey(property.code);
      if (!key || !property.apiPropertyId) return { property, configured: false, result: null };
      return { property, configured: true, result: await getFinanceAggregates(key, property.apiPropertyId, start, end) };
    }),
  );
}

// --- Lease mix (in-house monthly / weekly / transient) ----------------------
// Probe-verified against live Davenport (318197) on 2026-06-24 via
// scripts/probe-lease-query.mjs. Verified column names (the plan's guesses were
// wrong — corrected here):
//   - in-house overlap bounds: `checkin_date` <= asOf AND `checkout_date` > asOf
//     (NOT `check_in_date`/`check_out_date` — those 400 "Cdf not found").
//   - room measure: `room_count` (rooms per reservation; summed per rate plan).
//   - NO `modifier: "sum"` — DI dataset 3 rejects it ("Unknown field"); the
//     measure is requested bare, exactly like dataset 7's columns.
//
// IMPORTANT response-shape note (differs from getInsightsOccupancy / dataset 7):
// dataset 3 grouped-by-rate-plan does NOT return a `records` map keyed by group
// value. With `details:false` the measure is dropped entirely (empty headers +
// empty records). The working shape is `details:true`, which returns:
//   index:   string[][] — one [ratePlanName] per reservation row (109 rows live)
//   records: { room_count: number[] } — a PARALLEL array aligned to `index`.
// So we zip index[i][0] (rate plan) with records.room_count[i] (rooms) and sum
// per classification client-side. `classifyRatePlan` (Task 3, unit-tested) maps
// the plan string to monthly/weekly/transient.
//
// Task 13 must validate: room_count is rooms-per-reservation, so `total` is a
// rooms-on-the-books weighting, NOT necessarily equal to getDashboard's
// roomsOccupied (which counts physical rooms in-house). If Task 13 needs the
// latter, switch the measure or reconcile the two.

export type LeaseMix = { monthly: number; weekly: number; transient: number; total: number };

/** Raw in-house(or on-the-books)-on-`day` dataset-3 query grouped by rate
 *  plan, measure `room_count`, details:true. Shared by `getLeaseMix` (sums
 *  room_count per `classifyRatePlan` bucket, `status="In-House"` default —
 *  unchanged behavior) and the revenue-report nights queries (COUNT ROWS per
 *  `classifyForReport` bucket — see caveat there re: room_count inflation).
 *  `status` defaults to "In-House" (the original getLeaseMix behavior,
 *  extracted verbatim — Task 3); the revenue-report on-the-books query passes
 *  "Confirmed" as a second call (future days have no In-House rows yet). */
async function diDataset3InHouseByPlanDay(
  apiKey: string,
  apiPropertyId: string,
  day: string,
  status: string = "In-House",
): Promise<CloudbedsResult<Dataset3Grouped>> {
  const body = {
    property_ids: [Number(apiPropertyId)],
    dataset_id: 3,
    columns: [{ cdf: { column: "room_count" } }],
    group_rows: [{ cdf: { column: "public_rate_plan" } }],
    filters: {
      and: [
        { cdf: { column: "checkin_date" }, operator: "less_than_or_equal", value: day },
        { cdf: { column: "checkout_date" }, operator: "greater_than", value: day },
        // In-house snapshot (CLAUDE.md §5 / spec §5): the count must be physically
        // in-house rooms, not every reservation whose dates merely straddle asOf.
        // Verified live on Davenport (318197) 2026-06-24 via probe-lease-query.mjs:
        // dataset 3 status column is `reservation_status`; distinct values present
        // on the overlap set were { "In-House": 644, "Confirmed": 1, "Cancelled": 2 }.
        // "Confirmed" = booked, dates straddle asOf, but not yet checked in (a
        // no-show / not-arrived) and "Cancelled" = a killed reservation — both must
        // be dropped or they inflate the mix (esp. monthly leases at +30 room_count).
        // Operator `equals` with value "In-House" is accepted by the API and yields
        // the in-house-only set (647 -> 644 for Davenport on this date).
        { cdf: { column: "reservation_status" }, operator: "equals", value: status },
      ],
    },
    // details:true is REQUIRED — see shape note above; details:false drops the measure.
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

  const p = parsed as { index?: unknown[]; records?: { room_count?: unknown[] } };
  const index = (Array.isArray(p?.index) ? p.index : []).map((row) =>
    Array.isArray(row) ? String(row[0] ?? "") : String(row ?? ""),
  );
  const rooms = Array.isArray(p?.records?.room_count) ? p.records!.room_count! : [];
  const records: Record<string, number[]> = {
    room_count: rooms.map((x) => (typeof x === "number" ? x : 0)),
  };
  return { ok: true, data: { index, records } };
}

/** In-house lease mix for one property as of `asOf` (YYYY-MM-DD), from DI dataset 3. */
async function getLeaseMix(
  apiKey: string,
  apiPropertyId: string,
  asOf: string,
): Promise<CloudbedsResult<LeaseMix>> {
  const res = await diDataset3InHouseByPlanDay(apiKey, apiPropertyId, asOf);
  if (!res.ok) return res;

  // `index[i]` is the rate-plan name; `records.room_count[i]` is the rooms for
  // that same row. Zip them and sum rooms per lease classification.
  const { index, records } = res.data;
  const rooms = records.room_count ?? [];
  const mix: LeaseMix = { monthly: 0, weekly: 0, transient: 0, total: 0 };
  for (let i = 0; i < index.length; i++) {
    const plan = index[i];
    const n = rooms[i] ?? 0;
    const cls = classifyRatePlan(plan);
    if (cls === "lease-monthly") mix.monthly += n;
    else if (cls === "lease-weekly") mix.weekly += n;
    else mix.transient += n;
    mix.total += n;
  }
  return { ok: true, data: mix };
}

export type PropertyLeaseMix = {
  property: Property;
  configured: boolean;
  result: CloudbedsResult<LeaseMix> | null;
};

/** In-house lease mix for every configured property as of `asOf`, in parallel. */
export async function getPortfolioLeaseMix(asOf: string): Promise<PropertyLeaseMix[]> {
  return Promise.all(
    PROPERTIES.map(async (property): Promise<PropertyLeaseMix> => {
      const key = readKey(property.code);
      if (!key || !property.apiPropertyId) return { property, configured: false, result: null };
      return { property, configured: true, result: await getLeaseMix(key, property.apiPropertyId, asOf) };
    }),
  );
}

// --- Revenue/occupancy report inputs (Task 3, reworked Task 3r) -------------
// Assembles the per-property RowInputs (lib/revenue-report.ts) that `derive`
// turns into the automated daily revenue report. Query shapes below are the
// Task 1 spike's verbatim decisions — see
// docs/superpowers/notes/2026-07-22-revenue-report-probe-findings.md — plus
// the report-specific `classifyForReport` classifier (Kyle's decision,
// .superpowers/sdd/briefs/task-3-brief.md). Live-validated against Davenport
// (318197) 2026-07-22; see .superpowers/sdd/briefs/task-3-report.md for the
// full reconciliation table and flagged gaps (short version: Yesterday
// reconciles exactly; MTD/YTD room-block totals and inventory drift from
// Monica's Yardi-sourced figures for reasons not resolved in this task).
//
// Task 3r (Kyle's decision, .superpowers/sdd/briefs/task-3r-brief.md): dataset-3
// status/rate-plan fields are CURRENT-STATE only (see the drift note on
// `getNightsByPlanDay` above) — re-deriving MTD/YTD live for past days is not
// faithful. MTD/YTD/LY now read from the Neon `report_daily_snapshot` table
// (Task 3b) instead of live per-day Cloudbeds loops. Yesterday (single day) and
// on-the-books (forward 7 days) are UNCHANGED — still live and exact.

export type ReportRanges = {
  asOf: string;
  yesterday: [string, string];
  mtd: [string, string];
  ytd: [string, string];
  lyYesterday: [string, string];
  lyMtd: [string, string];
  lyYtd: [string, string];
  onTheBooks: string[];
};

/** Derive the report's six actual date ranges + 7 forward on-the-books days
 *  from the report's `asOf` (the "Yesterday" date). Pure — unit-tested in
 *  lib/revenue-report-inputs.test.ts. */
export function reportRanges(asOf: string): ReportRanges {
  const yStart = `${asOf.slice(0, 4)}-01-01`;
  const ly = (d: string) => `${Number(d.slice(0, 4)) - 1}${d.slice(4)}`;
  return {
    asOf,
    yesterday: [asOf, asOf],
    mtd: [monthStart(asOf), asOf],
    ytd: [yStart, asOf],
    lyYesterday: [ly(asOf), ly(asOf)],
    lyMtd: [ly(monthStart(asOf)), ly(asOf)],
    lyYtd: [ly(yStart), ly(asOf)],
    onTheBooks: Array.from({ length: 7 }, (_, i) => shiftYmd(asOf, i + 1)),
  };
}

/** Room-Rate revenue for ONE day, split transient/lease per `classifyForReport`.
 *  Dataset 1, `service_date` = day, `transaction_type = "Room Rate"` (excludes
 *  fees/tax/payments), grouped by `public_rate_plan`, sum `debit_amount` per
 *  bucket. Verified exact against Davenport 2026-07-19 ($492.05 / $2,706.13). */
async function getRoomRevenueByPlanDay(
  apiKey: string,
  apiPropertyId: string,
  day: string,
): Promise<CloudbedsResult<{ transient: number; lease: number }>> {
  const res = await diDataset1Grouped(apiKey, apiPropertyId, "public_rate_plan", ["debit_amount"], day, day, [
    { cdf: { column: "transaction_type" }, operator: "equals", value: "Room Rate" },
  ]);
  if (!res.ok) return res;
  let transient = 0;
  let lease = 0;
  for (let i = 0; i < res.data.index.length; i++) {
    const amt = res.data.records.debit_amount?.[i] ?? 0;
    if (classifyForReport(res.data.index[i]) === "lease") lease += amt;
    else transient += amt;
  }
  return { ok: true, data: { transient, lease } };
}

/** In-house nights for ONE day, split transient/lease per `classifyForReport`.
 *  Dataset 3, COUNTS ROWS per bucket (index.length) — NOT sum(room_count),
 *  which is inflated by rate-plan-change history (see the caveat on
 *  `diDataset3InHouseByPlanDay`/`getLeaseMix`). Task 1 spike (same-day,
 *  2026-07-19): Lease exact (84); Transient off by ~2 (8 vs Monica's 10) —
 *  likely same-day arrivals still `Confirmed` rather than `In-House` at
 *  report-run time. Not force-corrected here.
 *
 *  IMPORTANT, discovered during Task 3 live re-validation (2026-07-22, 3 days
 *  after the target date): `reservation_status` — and a reservation's
 *  rate-plan string, which can grow a new comma-joined segment if the plan
 *  changes — reflect the CURRENT state at QUERY TIME, not a historical
 *  snapshot as of the queried day. Re-running this query for a stale past
 *  date will drift further from the true count as (a) guests who have since
 *  checked out drop out of the `In-House` filter entirely, and (b) a
 *  reservation whose rate plan was later changed to a lease plan retroactively
 *  reclassifies its earlier nights from transient to lease (lease has
 *  precedence in `classifyForReport`). Confirmed live: the same 2026-07-19
 *  query returned Transient=6/Lease=86 when run on 2026-07-22, vs the
 *  same-day spike's Transient=8/Lease=84. **The daily report must run
 *  promptly (same day / next morning) for accurate "Yesterday" nights — a
 *  delayed re-run is not a faithful historical reproduction.** */
async function getNightsByPlanDay(
  apiKey: string,
  apiPropertyId: string,
  day: string,
): Promise<CloudbedsResult<{ transient: number; lease: number }>> {
  const res = await diDataset3InHouseByPlanDay(apiKey, apiPropertyId, day, "In-House");
  if (!res.ok) return res;
  let transient = 0;
  let lease = 0;
  for (const plan of res.data.index) {
    if (classifyForReport(plan) === "lease") lease += 1;
    else transient += 1;
  }
  return { ok: true, data: { transient, lease } };
}

/** On-the-books nights for ONE future day: same dataset-3 shape but the
 *  in-house-only filter would return ~0 rows for a day nobody has arrived at
 *  yet. Queries the two non-final statuses separately (Confirmed = booked,
 *  not yet arrived; In-House = a current guest whose stay extends into this
 *  future day) and sums — Cancelled/No-Show are excluded by omission, same
 *  allow-list spirit as `RES_CANCELLED_STATUSES` used elsewhere in this file.
 *  NOT independently live-validated (the brief's required validation targets
 *  are Yesterday/MTD/YTD actuals only) — flagged as an approximation. */
async function getOnTheBooksNightsByPlanDay(
  apiKey: string,
  apiPropertyId: string,
  day: string,
): Promise<CloudbedsResult<{ transient: number; lease: number }>> {
  const [confirmed, inHouse] = await Promise.all([
    diDataset3InHouseByPlanDay(apiKey, apiPropertyId, day, "Confirmed"),
    diDataset3InHouseByPlanDay(apiKey, apiPropertyId, day, "In-House"),
  ]);
  const results = [confirmed, inHouse];
  if (!confirmed.ok && !inHouse.ok) return confirmed;
  let transient = 0;
  let lease = 0;
  for (const r of results) {
    if (!r.ok) continue;
    for (const plan of r.data.index) {
      if (classifyForReport(plan) === "lease") lease += 1;
      else transient += 1;
    }
  }
  return { ok: true, data: { transient, lease } };
}

type BlockNights = { ooo: number; other: number };

// /getRoomBlocks hard-caps date ranges — verified live 2026-07-22:
// requesting >35 days returns HTTP 400 "Date range must be 35 days or less".
// Stay comfortably under it.
const BLOCK_QUERY_MAX_DAYS = 30;

/** OOO + other-block room-nights within [start,end] (inclusive), each
 *  clipped to the range. Chunks the /getRoomBlocks call into <=30-day windows
 *  to respect the endpoint's 35-day cap; clipped overlap-nights decompose
 *  additively across the (non-overlapping) chunk windows, so summing chunk
 *  results is exact for the full range.
 *
 *  Block date semantics (verified live against Davenport 2026-07-22, single
 *  day 2026-07-19): `endDate` is EXCLUSIVE (checkout-style, like reservation
 *  checkin/checkout elsewhere in this file) — that assumption reproduces
 *  Monica's Yesterday figures EXACTLY (ooo=2, otherBlocks=1).
 *
 *  FLAGGED, NOT RESOLVED: this same room-night model materially under-counts
 *  for multi-day ranges — live Davenport MTD (2026-07-01..19) gives ooo=43 vs
 *  Monica's reported 105. Monica's range-level OOO total does not appear to
 *  be a straightforward sum of this endpoint's block-night overlaps; its
 *  exact derivation is unresolved (see task-3-report.md). Reported honestly,
 *  not forced to match. */
async function getBlockNights(apiKey: string, start: string, end: string): Promise<CloudbedsResult<BlockNights>> {
  const totalDays = dayCount(start, end);
  const windows: { s: string; e: string }[] = [];
  for (let offset = 0; offset < totalDays; offset += BLOCK_QUERY_MAX_DAYS) {
    const s = shiftYmd(start, offset);
    const len = Math.min(BLOCK_QUERY_MAX_DAYS, totalDays - offset);
    windows.push({ s, e: shiftYmd(s, len - 1) });
  }

  const results = await Promise.all(
    windows.map((w) => cbGet<RawBlocks>(apiKey, `/getRoomBlocks`, { startDate: w.s, endDate: w.e })),
  );
  if (results.every((r) => !r.ok)) return results[0];

  let ooo = 0;
  let other = 0;
  results.forEach((res, i) => {
    if (!res.ok) return;
    const { s, e } = windows[i];
    const windowEndExclusive = shiftYmd(e, 1);
    for (const b of res.data?.roomBlocks ?? []) {
      const clipStart = b.startDate > s ? b.startDate : s;
      const clipEndExclusive = b.endDate < windowEndExclusive ? b.endDate : windowEndExclusive;
      if (clipEndExclusive <= clipStart) continue;
      const nights = dayCount(clipStart, shiftYmd(clipEndExclusive, -1));
      const roomNights = nights * (b.rooms ?? []).length;
      if (b.roomBlockType === "out_of_service") ooo += roomNights;
      else other += roomNights;
    }
  });
  return { ok: true, data: { ooo, other } };
}

/** Assemble one RowInputs for [start,end] (used for both actual periods and
 *  single on-the-books days). `nightsFn` differs between actual (in-house
 *  only) and on-the-books (confirmed+in-house) callers. Best-effort: a failed
 *  day is skipped (treated as 0) rather than failing the whole range — logged
 *  server-side so failures are visible even though RowInputs has no error
 *  slot to carry them (flagged as a follow-up concern in the report). */
async function buildRowInputs(
  apiKey: string,
  apiPropertyId: string,
  start: string,
  end: string,
  capacity: number,
  nightsFn: (apiKey: string, apiPropertyId: string, day: string) => Promise<CloudbedsResult<{ transient: number; lease: number }>>,
): Promise<RowInputs> {
  const days = Array.from({ length: dayCount(start, end) }, (_, i) => shiftYmd(start, i));

  const [revenueDays, nightsDays, blocks] = await Promise.all([
    Promise.all(days.map((d) => getRoomRevenueByPlanDay(apiKey, apiPropertyId, d))),
    Promise.all(days.map((d) => nightsFn(apiKey, apiPropertyId, d))),
    getBlockNights(apiKey, start, end),
  ]);

  let transientRev = 0;
  let leaseRev = 0;
  for (const r of revenueDays) {
    if (r.ok) {
      transientRev += r.data.transient;
      leaseRev += r.data.lease;
    } else {
      console.error(`[revenue-report] revenue fetch failed for ${apiPropertyId} — treated as $0:`, r.error);
    }
  }
  let transientNights = 0;
  let leaseNights = 0;
  for (const n of nightsDays) {
    if (n.ok) {
      transientNights += n.data.transient;
      leaseNights += n.data.lease;
    } else {
      console.error(`[revenue-report] nights fetch failed for ${apiPropertyId} — treated as 0:`, n.error);
    }
  }
  const ooo = blocks.ok ? blocks.data.ooo : 0;
  const otherBlocks = blocks.ok ? blocks.data.other : 0;
  if (!blocks.ok) console.error(`[revenue-report] block fetch failed for ${apiPropertyId} — treated as 0:`, blocks.error);

  return {
    transientNights,
    leaseNights,
    otherBlocks,
    ooo,
    inventory: capacity * dayCount(start, end),
    transientRev,
    leaseRev,
  };
}

/** Pick the 7 numeric RowInputs fields off a stored snapshot row (drops the
 *  propertyCode/stayDate identity columns). */
function toRowInputs(row: ReportSnapshotRow): RowInputs {
  const { transientNights, leaseNights, otherBlocks, ooo, inventory, transientRev, leaseRev } = row;
  return { transientNights, leaseNights, otherBlocks, ooo, inventory, transientRev, leaseRev };
}

/** Fetch the actual+on-the-books revenue-report inputs for every configured
 *  property, in parallel, for the report dated `asOf` (the "Yesterday" date).
 *
 *  MTD/YTD (Task 3r): stored snapshots for every day BEFORE `asOf` + the live
 *  "today" (= Yesterday block) figure, summed via `sumSnapshotRows`. This is
 *  correct whether or not the cron has already persisted today's snapshot (this
 *  function is also called ad hoc by the /report page + downloads) and never
 *  double-counts. The snapshot rows' summed `inventory` is used as-is — NOT
 *  recomputed as capacity×days.
 *
 *  LY blocks (lyYesterday/lyMtd/lyYtd): snapshots ONLY, no live fetch. `null`
 *  when no history exists yet for that range (expected for the first year). */
export async function getRevenueReportInputs(
  asOf: string,
): Promise<{ actual: PropertyActual[]; onTheBooks: PropertyOnTheBooks[]; trackingSince: string | null }> {
  const ranges = reportRanges(asOf);
  const actual: PropertyActual[] = [];
  const onTheBooks: PropertyOnTheBooks[] = [];

  await Promise.all(
    PROPERTIES.map(async (property) => {
      const key = readKey(property.code);
      if (!key || !property.apiPropertyId) return; // unconfigured — omitted from both arrays
      const apiPropertyId = property.apiPropertyId;
      const keDays = (range: [string, string]) =>
        property.code === "KE" ? { keDays: dayCount(range[0], range[1]) } : undefined;

      const dashboard = await getDashboard(key);
      const capacity = dashboard.ok ? dashboard.data.capacity : 0;
      if (!dashboard.ok) {
        console.error(`[revenue-report] capacity fetch failed for ${property.code} — treated as 0:`, dashboard.error);
      }

      // Yesterday: live single-day fetch, UNCHANGED. Also reused below as the
      // "today" contribution to MTD/YTD (see rollup()).
      const todayInputs = await buildRowInputs(key, apiPropertyId, asOf, asOf, capacity, getNightsByPlanDay);
      const yesterday: PeriodBlock = { actual: derive(todayInputs, keDays(ranges.yesterday)), lastYear: null };

      // LY: snapshots only. No live Cloudbeds call, no "today" figure (the
      // range is entirely in the past).
      const lyBlock = async (lyRange: [string, string]): Promise<DerivedRow | null> => {
        const stored = await getReportSnapshots(property.code, lyRange[0], lyRange[1]);
        if (stored.length === 0) return null;
        return derive(sumSnapshotRows(stored.map(toRowInputs)), keDays(lyRange));
      };

      // MTD/YTD: stored snapshots for days BEFORE asOf, plus today's live figure.
      const rollup = async (range: [string, string]): Promise<DerivedRow> => {
        const stored = await getReportSnapshots(property.code, range[0], shiftYmd(asOf, -1));
        const inputs = sumSnapshotRows([...stored.map(toRowInputs), todayInputs]);
        return derive(inputs, keDays(range));
      };

      const [lyYesterday, lyMtd, lyYtd, mtdActual, ytdActual] = await Promise.all([
        lyBlock(ranges.lyYesterday),
        lyBlock(ranges.lyMtd),
        lyBlock(ranges.lyYtd),
        rollup(ranges.mtd),
        rollup(ranges.ytd),
      ]);

      yesterday.lastYear = lyYesterday;
      const mtd: PeriodBlock = { actual: mtdActual, lastYear: lyMtd };
      const ytd: PeriodBlock = { actual: ytdActual, lastYear: lyYtd };

      actual.push({ code: property.code, name: property.name, yesterday, mtd, ytd });

      // On-the-books: UNCHANGED, live forward 7 days.
      const days = await Promise.all(
        ranges.onTheBooks.map(async (date) => {
          const inputs = await buildRowInputs(key, apiPropertyId, date, date, capacity, getOnTheBooksNightsByPlanDay);
          return { date, row: derive(inputs, keDays([date, date])) };
        }),
      );
      onTheBooks.push({ code: property.code, name: property.name, days });
    }),
  );

  const trackingSince = await getEarliestSnapshotDate(null);
  return { actual, onTheBooks, trackingSince };
}

/** Persist ONE day's exact snapshot for every configured property (Task 10
 *  daily cron). Banks the same figures the "Yesterday" block would show if the
 *  report ran promptly for `asOf`: capacity from getDashboard, nights via
 *  getNightsByPlanDay (in-house only — this is an actual, not on-the-books,
 *  day). Must run BEFORE buildRevenueReport for the same `asOf` so future
 *  runs' MTD/YTD rollups include this day (today's own MTD/YTD still come from
 *  stored[..asOf-1] + a live "today" fetch inside getRevenueReportInputs, so
 *  there is no double-count either way).
 *
 *  Per-property failures (missing key, Cloudbeds error, Neon error) are caught
 *  and skipped — one bad property must not abort the run. */
export async function persistDailySnapshots(asOf: string): Promise<{ written: number }> {
  let written = 0;
  await Promise.all(
    PROPERTIES.map(async (property) => {
      const key = readKey(property.code);
      if (!key || !property.apiPropertyId) return;
      try {
        const dashboard = await getDashboard(key);
        const capacity = dashboard.ok ? dashboard.data.capacity : 0;
        const inputs = await buildRowInputs(key, property.apiPropertyId, asOf, asOf, capacity, getNightsByPlanDay);
        await upsertReportSnapshot(property.code, asOf, inputs);
        written++;
      } catch (e) {
        console.error(`[revenue-report] snapshot failed for ${property.code} ${asOf}:`, e);
      }
    }),
  );
  return { written };
}

/** Single source of truth for "turn a date into a full RevenueReport" — the
 *  /report page (this task), the download routes (Task 7), and the cron job
 *  (Task 10) all call this instead of re-deriving asOf/generatedEastern
 *  themselves. Defaults `asOf` to Yesterday (Eastern) when omitted, matching
 *  the daily report's natural cadence (today's data isn't final until the
 *  night audit runs). */
export async function buildRevenueReport(asOf?: string): Promise<RevenueReport> {
  const day = asOf ?? shiftYmd(easternToday(), -1);
  const { actual, onTheBooks, trackingSince } = await getRevenueReportInputs(day);
  return {
    asOf: day,
    generatedEastern: `${easternToday()} ET`,
    actual,
    onTheBooks,
    trackingSince: trackingSince ?? undefined,
    sourceNote: SOURCE_NOTE,
  };
}
