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
import {
  activeOverrideNotes,
  inServiceDays,
  inventoryFor,
  isInService,
  overrideOooNights,
} from "@/lib/service-windows";
import {
  bankDailySnapshot,
  finalizeClosedMonths,
  getDailyOccSeries,
  getEarliestCountsDate,
  getEarliestSnapshotDate,
  getFinalThrough,
  getReportSnapshots,
  getSnapshotFreshness,
  observeBlocks,
  restateSnapshot,
  upsertRevenueSnapshot,
  type ReportSnapshotRow,
} from "@/lib/db";
import {
  classifyForReport,
  derive,
  sumSnapshotRows,
  sortByReportOrder,
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

/** Bounded retry for HTTP 429. A rate-limited call is NOT a data answer, but
 *  several call sites (notably the room-block fetch) turn a failure into 0 —
 *  and out-of-order is frozen at first capture, so a 429 during the flash cron
 *  banks a permanent zero. Retrying here fixes every caller at once rather
 *  than case-by-case. Bounded and short: a report build fans out 8 properties x
 *  ~8 date windows, so the ceiling matters more than persistence. */
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES = 3;
/** Backoff before attempt n (1-indexed), in ms, before jitter. */
export function retryDelayMs(attempt: number, retryAfterHeader?: string | null): number {
  const secs = retryAfterHeader == null ? NaN : Number(retryAfterHeader);
  // Honour Retry-After when the server sends a sane one; cap it so a bad header
  // can't stall a cron.
  if (Number.isFinite(secs) && secs > 0) return Math.min(secs * 1000, 10_000);
  return Math.min(500 * 2 ** (attempt - 1), 4_000);
}

async function cbGet<T = unknown>(
  apiKey: string,
  path: string,
  params: Record<string, string> = {},
): Promise<CloudbedsResult<T>> {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  let res: Response;
  for (let attempt = 1; ; attempt++) {
    try {
      res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
        next: { revalidate: REVALIDATE_SECONDS },
      });
    } catch (e) {
      return { ok: false, status: 0, error: `Network error reaching Cloudbeds: ${String(e)}` };
    }
    if (!RETRY_STATUSES.has(res.status) || attempt > MAX_RETRIES) break;
    const wait = retryDelayMs(attempt, res.headers.get("retry-after"));
    // Jitter so 8 concurrent property fetches don't retry in lockstep.
    await new Promise((r) => setTimeout(r, wait + Math.floor(Math.random() * 250)));
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
  /** Real room inventory, from the room list rather than the dashboard
   *  aggregate — see getPhysicalRoomCount for why they disagree. Null when no
   *  key is configured. Consumers should prefer this over `result.data.capacity`
   *  for anything a person reads as a room count. */
  physicalRooms: PhysicalRoomCount | null;
};

/** Fetch every configured property's dashboard in parallel, each paired with its
 *  real room count (the dashboard aggregate over-reports at some properties). */
export async function getPortfolio(): Promise<PropertyDashboard[]> {
  return Promise.all(
    PROPERTIES.map(async (property): Promise<PropertyDashboard> => {
      const key = readKey(property.code);
      if (!key) return { property, configured: false, result: null, physicalRooms: null };
      const [result, physicalRooms] = await Promise.all([
        getDashboard(key),
        getPhysicalRoomCount(key),
      ]);
      return { property, configured: true, result, physicalRooms };
    }),
  );
}

// --- Blocked rooms: Out-of-Order vs Other (which rooms, not just the count) --
// getRoomBlocks lists ALL room blocks (room + reason + dates) -- out_of_service
// PLUS other block types (e.g. blocked_dates); getRooms maps roomID → room
// name/type. Room identifiers are inventory, not guest PII. Ops (Bea) counts
// every block type; the dashboard used to show out_of_service only, which
// undercounted vs her tally (e.g. JN 20 vs 35) -- so every OooRoom below is
// tagged `category: "ooo" | "other"` and callers show the full breakdown.

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

/** Every room block overlapping [startDate, endDate) — PAGED.
 *
 *  WHY THIS EXISTS (08/07/26, found from Kyle's calendar screenshots): all three
 *  callers used to hit /getRoomBlocks with no pagination params, and the endpoint
 *  defaults to **20 blocks per page**. A property with more than 20 block records
 *  in the queried window silently lost the rest, and there was no error to notice
 *  — the response is a valid short page.
 *
 *  Measured the day it was found, single stay date 2026-08-07:
 *    JN (812)  20 blocks -> 110 blocks; OOO  20 ->  104 rooms
 *    KE (2295) 20 blocks ->  32 blocks; OOO  24 ->   31 rooms
 *    OR (8700) 20 blocks ->  21 blocks; Other 4 ->    5 rooms
 *  and far worse over ranges, which is what the report's MTD/YTD lines use —
 *  JN 07/01..07/19 read 380 OOO room-nights where the truth is 1,905 (5x).
 *
 *  This was the whole "rooms out of service with NO block against them" finding
 *  (TODO 08/04 items 2 and 4): the rooms WERE blocked, we just never read past
 *  the first page. Data Insights was right and our blocks were short. It is also
 *  why JN needed an 87-room sellable override to look sane.
 *
 *  NOT explained by this: Davenport's MTD 43-vs-105 (TODO, still open) — DP
 *  returns 17 blocks for that window, so nothing was truncated there.
 *
 *  ANY page failing fails the whole window. A 429 on page 2 must never return
 *  page 1 as if it were the complete set — that is precisely the shape of the bug
 *  being fixed here, and `ooo` is raise-only, so a short figure banked once is
 *  hard to see and harmless-looking forever. Callers already treat !ok as a
 *  failure rather than a zero. */
const BLOCK_PAGE_SIZE = 100;

async function getRoomBlocksPaged(
  apiKey: string,
  startDate: string,
  endDate: string,
): Promise<CloudbedsResult<RawBlocks>> {
  const all: RawBlock[] = [];
  for (let page = 1; page <= 40; page++) {
    const res = await cbGet<RawBlocks>(apiKey, `/getRoomBlocks`, {
      startDate,
      endDate,
      pageNumber: String(page),
      pageSize: String(BLOCK_PAGE_SIZE),
    });
    if (!res.ok) return res;
    const batch = res.data?.roomBlocks ?? [];
    all.push(...batch);
    if (batch.length < BLOCK_PAGE_SIZE) return { ok: true, data: { roomBlocks: all } };
  }
  // 40 pages = 4,000 blocks for one window. Hitting this means the assumption
  // behind the loop is wrong, so say so rather than silently truncating again.
  return {
    ok: false,
    status: 0,
    error: `getRoomBlocks exceeded ${40 * BLOCK_PAGE_SIZE} blocks for ${startDate}..${endDate} — paging stopped rather than return a short figure`,
  };
}

export type OooRoom = {
  room: string; // room code (roomName); "" when the name map could not resolve it
  roomType: string;
  roomTypeCode: string;
  reason: string;
  startDate: string;
  endDate: string;
  category: "ooo" | "other"; // "ooo" = roomBlockType out_of_service; "other" = every other block type
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

/** Physical room count from the ROOM LIST, not from `getDashboard.capacity`.
 *
 *  WHY (verified live 07/28/26 across all 8 properties, after the key rotation):
 *  `getDashboard.capacity` over-reports at two properties, and the room list is
 *  the one that matches the property's own record.
 *
 *  | property          | getDashboard | /getRooms | Monica's workbook |
 *  |-------------------|--------------|-----------|-------------------|
 *  | Kissimmee East    | 168          | **167**   | 167               |
 *  | Jacksonville West | 134          | **133**   | 133               |
 *  | Lakeland (control)| 157          | 157       | 157               |
 *
 *  The per-room-type breakdown sums to the `/getRooms` count at both, so the
 *  extra room exists only in the dashboard aggregate. This is what the KE
 *  "167 vs 168" reconciliation item turned out to be — and it found the same
 *  defect at JW, which nobody had noticed because JW's banked history came from
 *  the workbook and was already right.
 *
 *  Falls back to `getDashboard.capacity` when the room list is unavailable (a
 *  key lacking the Room scope), reporting which source was used so a caller can
 *  log the degradation rather than silently banking the wrong denominator. */
export type PhysicalRoomCount = {
  count: number;
  source: "getRooms" | "getDashboard" | "none";
};

export async function getPhysicalRoomCount(
  apiKey: string,
): Promise<PhysicalRoomCount> {
  const rooms = await getRoomNameMap(apiKey);
  if (rooms.loaded && rooms.map.size > 0) return { count: rooms.map.size, source: "getRooms" };
  const dashboard = await getDashboard(apiKey);
  if (dashboard.ok) return { count: dashboard.data.capacity, source: "getDashboard" };
  return { count: 0, source: "none" };
}

/** Map ALL room blocks (out_of_service AND every other block type, e.g.
 *  blocked_dates) → rooms using the name map. Pure (no I/O) so the no-raw-id
 *  guarantee is unit-tested. Unresolved roomIDs get a blank `room` (the UI
 *  shows a placeholder + a "Room scope" notice) — never the raw id.
 *
 *  Root cause of the JN 20-vs-35 discrepancy (Kyle, confirmed live against
 *  Davenport 2026-07-21): this used to filter to out_of_service only, so the
 *  dashboard undercounted vs ops' all-blocks tally. Now every block is
 *  included, tagged with `category` so callers can show the breakdown
 *  (Out-of-Order vs Other blocks vs Total) instead of silently dropping rows. */
export function buildOooRooms(nameById: Map<string, OooRoomInfo>, roomBlocks: RawBlock[]): OooRoom[] {
  const out: OooRoom[] = [];
  for (const b of roomBlocks ?? []) {
    const category: "ooo" | "other" = b.roomBlockType === "out_of_service" ? "ooo" : "other";
    for (const r of b.rooms ?? []) {
      const info = nameById.get(r.roomID);
      out.push({
        room: info?.roomName ?? "",
        roomType: info?.roomTypeName ?? "",
        roomTypeCode: info?.roomTypeCode ?? "",
        reason: b.roomBlockReason || "—",
        startDate: b.startDate,
        endDate: b.endDate,
        category,
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

/** Pure summary: {ooo, other, total} rooms by category. Used by the /bea and
 *  /ops OOO explorer, the OOO PDF, and oooInsights so the breakdown always
 *  reconciles (ooo + other === total === rooms.length). */
export function summarizeOoo(rooms: OooRoom[]): { ooo: number; other: number; total: number } {
  let ooo = 0;
  let other = 0;
  for (const r of rooms) {
    if (r.category === "ooo") ooo++;
    else other++;
  }
  return { ooo, other, total: rooms.length };
}

/** ALL blocked rooms (out_of_service + other block types) active on `asOf`
 *  (YYYY-MM-DD) for one property, with room codes + types, each tagged
 *  `category`. Errors if the room-name source is unavailable while blocks
 *  exist (key missing the Room scope) so the UI surfaces that rather than
 *  rendering internal roomIDs as fake room numbers. */
async function getOooRooms(apiKey: string, asOf: string): Promise<CloudbedsResult<OooRoom[]>> {
  const [nameRes, blocksRes] = await Promise.all([
    getRoomNameMap(apiKey),
    getRoomBlocksPaged(apiKey, asOf, asOf),
  ]);
  if (!blocksRes.ok) return blocksRes;

  const blocks = blocksRes.data?.roomBlocks ?? [];
  const hasBlocks = blocks.length > 0;
  // Roomblock scope works but Room scope does not: we have blocks but no names.
  if (!nameRes.loaded && hasBlocks) {
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

/** All blocked rooms (Out-of-Order + Other) per configured property, as of `asOf`. */
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
    getRoomBlocksPaged(apiKey, asOf, asOf),
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

// A Data Insights filter node: a leaf condition, or a nested and/or group.
type DiFilter =
  | { cdf: { column: string }; operator: string; value: string | string[] }
  | { and: DiFilter[] }
  | { or: DiFilter[] };

/** A dataset-1 `details:true` result keyed by MULTIPLE group columns: one entry
 *  per detail row, `dims` in the order the columns were requested. */
type Dataset1Rows = { dims: string[][]; records: Record<string, number[]> };

/** Dataset-1 detail rows grouped by up to THREE columns (the API rejects a
 *  fourth: `group_rows: Length must be between 1 and 3`). Returns one `dims`
 *  entry per detail row so callers can de-duplicate or cross-tabulate — see
 *  `getPaidNightsByPlanDay`, which needs (rate plan x room identifier). */
async function diDataset1Rows(
  apiKey: string,
  apiPropertyId: string,
  groupColumns: string[],
  measureColumns: string[],
  start: string,
  end: string,
  extraFilters: DiFilter[] = [],
): Promise<CloudbedsResult<Dataset1Rows>> {
  const body = {
    property_ids: [Number(apiPropertyId)],
    dataset_id: 1,
    columns: measureColumns.map((column) => ({ cdf: { column } })),
    group_rows: groupColumns.map((column) => ({ cdf: { column } })),
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
  const dims = (Array.isArray(p?.index) ? p.index : []).map((row) =>
    Array.isArray(row) ? row.map((v) => String(v ?? "")) : [String(row ?? "")],
  );
  const records: Record<string, number[]> = {};
  for (const col of measureColumns) {
    const arr = Array.isArray(p?.records?.[col]) ? p.records![col] : [];
    records[col] = arr.map((x) => (typeof x === "number" ? x : 0));
  }
  return { ok: true, data: { dims, records } };
}

/** Single-group-column convenience wrapper over `diDataset1Rows`, preserving the
 *  `{ index: string[] }` shape its original callers expect. */
async function diDataset1Grouped(
  apiKey: string,
  apiPropertyId: string,
  groupColumn: string,
  measureColumns: string[],
  start: string,
  end: string,
  // Additive, optional: extra AND-ed filters beyond the service_date range
  // (e.g. a transaction_type filter for the revenue-report split). Accepts
  // nested and/or groups (Data Insights supports OR groups; `in` is NOT
  // supported → 400).
  extraFilters: DiFilter[] = [],
): Promise<CloudbedsResult<Dataset3Grouped>> {
  const res = await diDataset1Rows(apiKey, apiPropertyId, [groupColumn], measureColumns, start, end, extraFilters);
  if (!res.ok) return res;
  return { ok: true, data: { index: res.data.dims.map((d) => d[0] ?? ""), records: res.data.records } };
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

/** Pure classify+sum helper: given (plan, amount) rows, split the total into
 *  transient/lease per `classifyForReport`. Extracted from
 *  `getRoomRevenueByPlanDay` so the actual math is unit-testable without any
 *  I/O (Data Insights query shape is exercised live, not in unit tests). */
export function sumRevenueByClass(planAmounts: { plan: string; amount: number }[]): { transient: number; lease: number } {
  let transient = 0;
  let lease = 0;
  for (const { plan, amount } of planAmounts) {
    if (classifyForReport(plan) === "lease") lease += amount;
    else transient += amount;
  }
  return { transient, lease };
}

/** Room-Rate revenue for ONE day, split transient/lease per `classifyForReport`.
 *  Dataset 1, `service_date` = day, `transaction_type = "Room Rate"` (excludes
 *  fees/tax/payments), grouped by `public_rate_plan`, sum `debit_amount` per
 *  bucket. Verified exact against Davenport 2026-07-19 ($492.05 / $2,706.13).
 *
 *  NOTE (07/24/26): Cloudbeds has a SEPARATE "Room Revenue" transaction type
 *  (~2.5% of Room Rate at DP YTD). Monica's report EXCLUDES it — her verified
 *  YTD matches "Room Rate" only to ~0.1% (her Excel column is *titled* "Room
 *  Revenue" but is fed by room-rate transactions). Do NOT add "Room Revenue"
 *  here — it overshoots her figures by ~2.5–3.3%. See memory
 *  monica-revenue-methodology + scripts/probe-transaction-types.mjs. */
async function getRoomRevenueByPlanDay(
  apiKey: string,
  apiPropertyId: string,
  day: string,
): Promise<CloudbedsResult<{ transient: number; lease: number }>> {
  const res = await diDataset1Grouped(apiKey, apiPropertyId, "public_rate_plan", ["debit_amount"], day, day, [
    { cdf: { column: "transaction_type" }, operator: "equals", value: "Room Rate" },
  ]);
  if (!res.ok) return res;
  const rows = res.data.index.map((plan, i) => ({ plan, amount: res.data.records.debit_amount?.[i] ?? 0 }));
  return { ok: true, data: sumRevenueByClass(rows) };
}

/** Pure classify+de-duplicate helper behind `getPaidNightsByPlanDay`: given one
 *  detail row per dataset-1 "Room Rate" transaction as
 *  `{ plan, roomIdentifier, amount }`, collapse to ONE room-night per distinct
 *  `res_room_identifier` and split into transient / lease / comp.
 *
 *  A room-night is COMP when its room-rate transactions net to $0 (employee or
 *  complimentary stay). Monica reports those under "Other blocks", not under
 *  paid transient/lease nights, so they are returned separately for the caller
 *  to fold in. Extracted so the arithmetic is unit-testable without I/O.  */
export function foldRoomNights(
  rows: { plan: string; roomIdentifier: string; amount: number }[],
): { transient: number; lease: number; comp: number } {
  const byRoomNight = new Map<string, { plan: string; amount: number }>();
  for (const { plan, roomIdentifier, amount } of rows) {
    // Fall back to the plan as the key when the identifier is blank, so a
    // missing identifier degrades to per-plan grouping rather than collapsing
    // every row of the day into one.
    const key = roomIdentifier || `plan:${plan}`;
    const existing = byRoomNight.get(key);
    if (existing) {
      existing.amount += amount;
      // Lease wins on a mixed room-night, consistent with classifyForReport's
      // precedence on comma-joined plan strings.
      if (classifyForReport(plan) === "lease") existing.plan = plan;
    } else {
      byRoomNight.set(key, { plan, amount });
    }
  }
  let transient = 0;
  let lease = 0;
  let comp = 0;
  for (const { plan, amount } of byRoomNight.values()) {
    if (amount === 0) comp += 1;
    else if (classifyForReport(plan) === "lease") lease += 1;
    else transient += 1;
  }
  return { transient, lease, comp };
}

/** Paid room-nights for ONE day, from the SAME dataset-1 query that produces
 *  revenue: `transaction_type = "Room Rate"`, `service_date = day`, grouped by
 *  (`public_rate_plan`, `res_room_identifier`), one room-night per distinct
 *  identifier.
 *
 *  WHY THIS REPLACED THE DATASET-3 IN-HOUSE COUNT (07/28/26 — see the parity
 *  analysis against Monica's 7/24–7/27 reports): `reservation_status` is
 *  current-state at QUERY TIME, so the old `In-House` filter silently dropped
 *  every one-night transient who had already checked out by the 06:00 ET cron.
 *  Live probe, Davenport (scripts/probe-nights-from-revenue.mjs):
 *
 *  | day  | Monica | this query | old In-House query |
 *  |------|--------|-----------|--------------------|
 *  | 7/24 | 13 / 83 | 13 / 83  | 11 / 84            |
 *  | 7/26 | 18 / 82 | 18 / 82  |  7 / 84            |
 *
 *  Two further properties of this source matter as much as the accuracy: nights
 *  and revenue now come from one query, so ADR reconciles by construction and
 *  can never disagree with revenue; and because nothing depends on current
 *  reservation status, a PAST day can be re-derived faithfully — which is what
 *  makes the nightly restatement pass (`restateSnapshots`) sound.
 *
 *  Residual: 7/25 returns 13 transient where Monica reports 12, with no $0 rows
 *  to explain it. One room-night, cause unresolved — flagged, not forced.
 *
 *  NOT usable for on-the-books: a future night has posted no room-rate
 *  transaction yet, so forward days keep using
 *  `getOnTheBooksNightsByPlanDay` (dataset 3, Confirmed + In-House). */
async function getPaidNightsByPlanDay(
  apiKey: string,
  apiPropertyId: string,
  day: string,
): Promise<CloudbedsResult<{ transient: number; lease: number; comp: number }>> {
  const res = await diDataset1Rows(
    apiKey,
    apiPropertyId,
    ["public_rate_plan", "res_room_identifier"],
    ["debit_amount"],
    day,
    day,
    [{ cdf: { column: "transaction_type" }, operator: "equals", value: "Room Rate" }],
  );
  if (!res.ok) return res;
  const amounts = res.data.records.debit_amount ?? [];
  return {
    ok: true,
    data: foldRoomNights(
      res.data.dims.map((d, i) => ({
        plan: d[0] ?? "",
        roomIdentifier: d[1] ?? "",
        amount: amounts[i] ?? 0,
      })),
    ),
  };
}

// REMOVED 07/28/26: `getNightsByPlanDay` (dataset 3, `reservation_status =
// "In-House"`). It undercounted paid nights because reservation status is
// current-state at query time, so one-night transients who had checked out
// before the 06:00 ET cron vanished from the count (Davenport 7/26: 7 transient
// nights banked vs Monica's 18, while that same day's transient REVENUE matched
// to the cent — ADR Transient read $130.60 against her $50.79). Actual-period
// nights now come from `getPaidNightsByPlanDay` above; on-the-books still uses
// the dataset-3 path below, because a future night has posted no transaction to
// count yet.

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

/** Block room-nights for a range. `byType` keeps the raw Cloudbeds
 *  `roomBlockType` breakdown so the report can show Monica's two lines
 *  (Out-of-Order / Other blocks) while the drill-down explains what is inside
 *  them — Orlando reported 11 "other" block-nights MTD against her 0, and that
 *  question is only answerable if the composition is stored. */
type BlockNights = { ooo: number; other: number; byType: Record<string, number> };

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
/** Exported so a targeted repair (scripts/repair-zero-ooo.mts) can re-observe a
 *  single property-day through the exact production path, instead of the
 *  whole-portfolio `captureEndOfDayBlocks` — which would stamp `ooo_eod` /
 *  `ooo_observed_at` on seven innocent rows and pollute the evidence for
 *  whether the nightly cron actually fired. */
export async function getBlockNights(apiKey: string, start: string, end: string): Promise<CloudbedsResult<BlockNights>> {
  const totalDays = dayCount(start, end);
  const windows: { s: string; e: string }[] = [];
  for (let offset = 0; offset < totalDays; offset += BLOCK_QUERY_MAX_DAYS) {
    const s = shiftYmd(start, offset);
    const len = Math.min(BLOCK_QUERY_MAX_DAYS, totalDays - offset);
    windows.push({ s, e: shiftYmd(s, len - 1) });
  }

  const results = await Promise.all(
    windows.map((w) => getRoomBlocksPaged(apiKey, w.s, w.e)),
  );
  if (results.every((r) => !r.ok)) return results[0];

  let ooo = 0;
  let other = 0;
  const byType: Record<string, number> = {};
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
      const type = b.roomBlockType || "(unspecified)";
      byType[type] = (byType[type] ?? 0) + roomNights;
      if (b.roomBlockType === "out_of_service") ooo += roomNights;
      else other += roomNights;
    }
  });
  return { ok: true, data: { ooo, other, byType } };
}

/** Assemble one RowInputs for [start,end] (used for both actual periods and
 *  single on-the-books days). `nightsFn` differs between actual
 *  (`getPaidNightsByPlanDay` — room-nights from the revenue query) and
 *  on-the-books (`getOnTheBooksNightsByPlanDay` — dataset-3 confirmed+in-house)
 *  callers. Best-effort: a failed day is skipped (treated as 0) rather than
 *  failing the whole range — logged server-side so failures are visible even
 *  though RowInputs has no error slot to carry them.
 *
 *  Three denominator/block rules, all added 07/28/26 from the Monica parity
 *  analysis (see lib/service-windows.ts for the evidence):
 *   - INVENTORY sums only the days the property was in service, rather than
 *     `capacity x dayCount`, so a dark month no longer inflates the denominator.
 *   - OOO takes `max(Cloudbeds block-nights, sellable-override implied nights)`,
 *     so a property whose unsellable rooms are not blocked in Cloudbeds is not
 *     reported as having them available.
 *   - COMP room-nights (room-rate transactions netting $0 — employee /
 *     complimentary) are folded into `otherBlocks`, matching Monica's
 *     definition, and also carried separately for the drill-down. */
async function buildRowInputs(
  apiKey: string,
  property: Property,
  start: string,
  end: string,
  capacity: number,
  nightsFn: (
    apiKey: string,
    apiPropertyId: string,
    day: string,
  ) => Promise<CloudbedsResult<{ transient: number; lease: number; comp?: number }>>,
): Promise<RowInputs> {
  const apiPropertyId = property.apiPropertyId!;
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
  let compNights = 0;
  for (const n of nightsDays) {
    if (n.ok) {
      transientNights += n.data.transient;
      leaseNights += n.data.lease;
      compNights += n.data.comp ?? 0;
    } else {
      console.error(`[revenue-report] nights fetch failed for ${apiPropertyId} — treated as 0:`, n.error);
    }
  }
  const blockOoo = blocks.ok ? blocks.data.ooo : 0;
  const blockOther = blocks.ok ? blocks.data.other : 0;
  const blocksByType = blocks.ok ? blocks.data.byType : {};
  if (!blocks.ok) console.error(`[revenue-report] block fetch failed for ${apiPropertyId} — treated as 0:`, blocks.error);

  const overrideOoo = overrideOooNights(property, start, end, capacity);
  const ooo = Math.max(blockOoo, overrideOoo);

  return {
    transientNights,
    leaseNights,
    otherBlocks: blockOther + compNights,
    ooo,
    inventory: inServiceDays(property, start, end).reduce((sum, d) => sum + inventoryFor(property, d, capacity), 0),
    transientRev,
    leaseRev,
    compNights,
    blocksByType,
    oooSource: overrideOoo > blockOoo ? "override" : "cloudbeds",
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

      const [rooms, countsSince] = await Promise.all([
        getPhysicalRoomCount(key),
        getEarliestCountsDate(property.code),
      ]);
      const capacity = rooms.count;
      if (rooms.source !== "getRooms") {
        console.error(
          `[revenue-report] room list unavailable for ${property.code} — inventory fell back to ${rooms.source} (${capacity})`,
        );
      }
      // A block's counts are partial (not yet a full period) when this
      // property has no banked count-snapshot yet, or the earliest one lands
      // AFTER the block's range start — i.e. some days in [start, asOf] are
      // revenue-only. Kyle's decision, partial-counts-brief.md.
      const countsPartialFor = (range: [string, string]) => !countsSince || countsSince > range[0];

      // Yesterday: live single-day fetch, UNCHANGED. Also reused below as the
      // "today" contribution to MTD/YTD (see rollup()). Always a complete
      // single-day pull — never blanked.
      const todayInputs = await buildRowInputs(key, property, asOf, asOf, capacity, getPaidNightsByPlanDay);
      const yesterday: PeriodBlock = {
        actual: derive(todayInputs, keDays(ranges.yesterday)),
        lastYear: null,
        countsPartial: false,
      };

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
      const mtd: PeriodBlock = { actual: mtdActual, lastYear: lyMtd, countsPartial: countsPartialFor(ranges.mtd) };
      const ytd: PeriodBlock = { actual: ytdActual, lastYear: lyYtd, countsPartial: countsPartialFor(ranges.ytd) };

      actual.push({ code: property.code, name: property.name, yesterday, mtd, ytd });

      // On-the-books: UNCHANGED, live forward 7 days.
      const days = await Promise.all(
        ranges.onTheBooks.map(async (date) => {
          const inputs = await buildRowInputs(key, property, date, date, capacity, getOnTheBooksNightsByPlanDay);
          return { date, row: derive(inputs, keDays([date, date])) };
        }),
      );
      onTheBooks.push({ code: property.code, name: property.name, days });
    }),
  );

  const trackingSince = await getEarliestSnapshotDate(null);
  // Both arrays were filled by concurrent pushes, so their order was whatever
  // order Cloudbeds happened to answer in. Sort into Monica's published order
  // so the report is stable run to run and lines up with hers page for page.
  return {
    actual: sortByReportOrder(actual),
    onTheBooks: sortByReportOrder(onTheBooks),
    trackingSince,
  };
}

/** Persist ONE day's exact snapshot for every configured property (Task 10
 *  daily cron). Banks the same figures the "Yesterday" block would show if the
 *  report ran promptly for `asOf`: capacity from getDashboard, nights via
 *  getPaidNightsByPlanDay (room-nights from the revenue query — this is an
 *  actual, not an on-the-books, day). Must run BEFORE buildRevenueReport for the same `asOf` so future
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
        const rooms = await getPhysicalRoomCount(key);
        const capacity = rooms.count;
        if (rooms.source !== "getRooms") {
          console.error(`[revenue-report] room list unavailable for ${property.code} — inventory from ${rooms.source}`);
        }
        const inputs = await buildRowInputs(key, property, asOf, asOf, capacity, getPaidNightsByPlanDay);
        // The FLASH capture: first write wins, and its room-revenue total is kept
        // in flash_room_rev forever so the later restatement delta is visible.
        // Corrections arrive via restateSnapshots (below), not by re-banking.
        // OOO is the exception — bankDailySnapshot only ever RAISES it, because
        // the end-of-day pass on the stay date itself sees blocks this
        // next-morning read has already lost (see captureEndOfDayBlocks).
        await bankDailySnapshot(property.code, asOf, inputs);
        written++;
      } catch (e) {
        console.error(`[revenue-report] snapshot failed for ${property.code} ${asOf}:`, e);
      }
    }),
  );
  return { written };
}

/**
 * END-OF-DAY room-block capture for a single stay date (07/30/26).
 *
 * Cloudbeds room blocks erode: changing a block drops it from the days already
 * gone and a past block cannot be re-added, so a day's OOO can only decrease on
 * re-query and the earliest reading is the truest. The 06:00 ET flash runs the
 * MORNING AFTER the stay date, by which point anything tidied up during the day
 * is already lost — banked Lakeland read 3 for 2026-07-28 where both Monica and a
 * live re-query said 6. This pass runs at 23:00 ET on the stay date ITSELF and
 * `observeBlocks` keeps whichever reading is higher.
 *
 * Blocks ONLY. Nights, revenue and inventory are untouched — they come from
 * `service_date`-keyed queries that reproduce faithfully, so they have no reason
 * to be captured early, and the flash still owns them.
 *
 * A property whose block fetch FAILS is skipped, never written as 0. A
 * rate-limited zero would otherwise be banked and, because blocks freeze,
 * permanently understate the day.
 *
 * Deliberately NOT fed by the on-the-books grid: a block on a FUTURE date is a
 * plan, and if the room is repaired early that day never was out of order, so a
 * pre-date reading would overstate. Only same-day-or-later readings count.
 */
export async function captureEndOfDayBlocks(stayDate: string): Promise<{
  observed: { code: string; ooo: number; source: "cloudbeds" | "override" }[];
  skipped: { code: string; reason: string }[];
}> {
  const observed: { code: string; ooo: number; source: "cloudbeds" | "override" }[] = [];
  const skipped: { code: string; reason: string }[] = [];

  await Promise.all(
    PROPERTIES.map(async (property) => {
      const key = readKey(property.code);
      if (!key || !property.apiPropertyId) return; // unconfigured — not a failure
      try {
        const rooms = await getPhysicalRoomCount(key);
        const blocks = await getBlockNights(key, stayDate, stayDate);
        if (!blocks.ok) {
          skipped.push({ code: property.code, reason: `block fetch failed: ${blocks.error}` });
          return;
        }
        const overrideOoo = overrideOooNights(property, stayDate, stayDate, rooms.count);
        const ooo = Math.max(blocks.data.ooo, overrideOoo);
        await observeBlocks(property.code, stayDate, {
          ooo,
          blocksByType: blocks.data.byType,
          oooSource: overrideOoo > blocks.data.ooo ? "override" : "cloudbeds",
          pass: "eod",
        });
        observed.push({
          code: property.code,
          ooo,
          source: overrideOoo > blocks.data.ooo ? "override" : "cloudbeds",
        });
      } catch (e) {
        skipped.push({ code: property.code, reason: e instanceof Error ? e.message : String(e) });
      }
    }),
  );

  return {
    observed: observed.sort((a, b) => a.code.localeCompare(b.code)),
    skipped: skipped.sort((a, b) => a.code.localeCompare(b.code)),
  };
}

/** Re-derive every non-final banked day in [start, end] and write the
 *  corrections (see the restatement note in lib/db.ts for why this is now
 *  sound: nights come from `service_date`-keyed transactions, so a past day
 *  reproduces faithfully instead of drifting).
 *
 *  Sequential per property across days to respect Data Insights rate limits;
 *  properties run in parallel. A failed day is logged and skipped — a bad day
 *  must never abort the pass, and the day stays open for the next run.
 *  Days that are already `is_final` are left untouched by `restateSnapshot`. */
export async function restateSnapshots(
  start: string,
  end: string,
): Promise<{ days: number; restated: number; failed: number; properties: number }> {
  const days = Array.from({ length: dayCount(start, end) }, (_, i) => shiftYmd(start, i));
  let restated = 0;
  let failed = 0;
  let properties = 0;

  await Promise.all(
    PROPERTIES.map(async (property) => {
      const key = readKey(property.code);
      if (!key || !property.apiPropertyId) return;
      properties++;

      const rooms = await getPhysicalRoomCount(key);
      const capacity = rooms.count;
      if (rooms.source !== "getRooms") {
        console.error(`[restate] room list unavailable for ${property.code} — inventory from ${rooms.source} (${capacity})`);
      }

      for (const day of days) {
        // Nothing to restate for a day the property wasn't operating; writing a
        // zero row would recreate the inventory-inflation bug this pass exists
        // partly to clean up.
        if (!isInService(property, day)) continue;
        try {
          const inputs = await buildRowInputs(key, property, day, day, capacity, getPaidNightsByPlanDay);
          if (await restateSnapshot(property.code, day, inputs)) restated++;
        } catch (e) {
          failed++;
          console.error(`[restate] day failed for ${property.code} ${day} — skipped:`, e);
        }
      }
    }),
  );

  return { days: days.length, restated, failed, properties };
}

/** Historical REVENUE-ONLY backfill (Kyle's decision — see
 *  .superpowers/sdd/briefs/revenue-backfill-brief.md). Revenue (dataset-1
 *  `service_date`) IS historically exact and can be reconstructed for any past
 *  day; occupancy COUNTS cannot (dataset-3 status/rate-plan fields are
 *  current-state only, not a historical snapshot — see the drift note on
 *  `getNightsByPlanDay` above) and must keep accumulating forward via the
 *  daily cron. This function therefore NEVER writes count fields — it calls
 *  `upsertRevenueSnapshot` (partial upsert: transient_rev/lease_rev/inventory
 *  ONLY), so a real cron-banked count snapshot for the same day is preserved.
 *
 *  For each configured property (key + apiPropertyId), fetches capacity ONCE
 *  (current `getDashboard`, used as a proxy for historical capacity — a known,
 *  accepted approximation for the revenue/RevPAR backfill), then walks each
 *  day in [startDate, endDate] SEQUENTIALLY (to respect Data Insights rate
 *  limits) fetching Room-Rate revenue and upserting it. Properties run in
 *  parallel. A day that errors is logged and skipped — one bad day/property
 *  never aborts the run. Idempotent: safe to re-run over any range. */
export async function backfillRevenue(
  startDate: string,
  endDate: string,
): Promise<{ days: number; rowsWritten: number; properties: number }> {
  const days = Array.from({ length: dayCount(startDate, endDate) }, (_, i) => shiftYmd(startDate, i));
  let rowsWritten = 0;
  let properties = 0;

  await Promise.all(
    PROPERTIES.map(async (property) => {
      const key = readKey(property.code);
      if (!key || !property.apiPropertyId) return; // unconfigured — skipped entirely
      const apiPropertyId = property.apiPropertyId;
      properties++;

      const rooms = await getPhysicalRoomCount(key);
      const capacity = rooms.count;
      if (rooms.source !== "getRooms") {
        console.error(`[backfill-revenue] room list unavailable for ${property.code} — inventory from ${rooms.source} (${capacity})`);
      }

      // Sequential across days (per property) to respect DI rate limits;
      // properties themselves already run in parallel via Promise.all above.
      for (const day of days) {
        try {
          const rev = await getRoomRevenueByPlanDay(key, apiPropertyId, day);
          if (!rev.ok) {
            console.error(`[backfill-revenue] revenue fetch failed for ${property.code} ${day} — skipped:`, rev.error);
            continue;
          }
          await upsertRevenueSnapshot(property.code, day, rev.data.transient, rev.data.lease, capacity);
          rowsWritten++;
        } catch (e) {
          console.error(`[backfill-revenue] day failed for ${property.code} ${day} — skipped:`, e);
        }
      }
    }),
  );

  return { days: days.length, rowsWritten, properties };
}

/** Single source of truth for "turn a date into a full RevenueReport" — the
 *  /report page (this task), the download routes (Task 7), and the cron job
 *  (Task 10) all call this instead of re-deriving asOf/generatedEastern
 *  themselves. Defaults `asOf` to Yesterday (Eastern) when omitted, matching
 *  the daily report's natural cadence (today's data isn't final until the
 *  night audit runs). `sourceNote` folds in the revenue-backfill caveat
 *  (Kyle's decision, revenue-backfill-brief.md) so renderers need no change:
 *  MTD/YTD revenue/RevPAR are the full, exact period (backfilled); occupancy
 *  counts/%/ADR are partial, accumulating forward from the earliest real
 *  cron-banked count day. */
export async function buildRevenueReport(asOf?: string): Promise<RevenueReport> {
  const day = asOf ?? shiftYmd(easternToday(), -1);
  // 30-day trailing window for the per-property sparklines.
  const sparkFrom = shiftYmd(day, -29);
  const [{ actual, onTheBooks, trackingSince }, countsSince, freshness, sparkPoints, finalThrough] =
    await Promise.all([
      getRevenueReportInputs(day),
      getEarliestCountsDate(null),
      getSnapshotFreshness(),
      getDailyOccSeries(sparkFrom, day),
      getFinalThrough(),
    ]);
  // Any property whose OOO is being supplied by a config override, so the page
  // can badge it instead of presenting a manual figure as Cloudbeds-sourced.
  const overrideNotes = PROPERTIES.flatMap((p) =>
    activeOverrideNotes(p, `${day.slice(0, 4)}-01-01`, day).map((reason) => `${p.name} (${p.id}): ${reason}`),
  );
  const note =
    SOURCE_NOTE +
    " MTD/YTD Room Revenue and RevPAR reflect the full period (revenue is backfilled and exact); occupancy counts, % Occupancy and ADR accumulate from " +
    (countsSince ?? "the first cron run") +
    " and are partial until a full period is banked." +
    (finalThrough
      ? ` Figures through ${finalThrough} are FINAL; later days are preliminary and restated nightly as the ledger settles.`
      : " No period is finalized yet — every figure is preliminary and restated nightly.") +
    (overrideNotes.length ? ` Out-of-order is manually overridden for: ${overrideNotes.join("; ")}.` : "");

  const sparkByCode = new Map<string, { day: string; pOcc: number }[]>();
  for (const p of sparkPoints) {
    (sparkByCode.get(p.code) ?? sparkByCode.set(p.code, []).get(p.code)!).push({ day: p.day, pOcc: p.pOcc });
  }

  return {
    asOf: day,
    generatedEastern: `${easternToday()} ET`,
    actual: actual.map((p) => ({ ...p, spark: sparkByCode.get(p.code) ?? [] })),
    onTheBooks,
    trackingSince: trackingSince ?? undefined,
    sourceNote: note,
    finalThrough: finalThrough ?? undefined,
    oooOverrideNotes: overrideNotes,
    freshness: {
      ...freshness,
      propertiesExpected: PROPERTIES.filter((p) => p.active === true).length,
    },
  };
}

// --- Rate-plan inventory (classifier-completeness audit) --------------------
//
// Lease vs Transient is detected ENTIRELY from the rate-plan string (PII-free,
// no Guest scope — CLAUDE.md §5.2). That makes the keyword lists a silent
// accuracy risk: a genuine lease booked on a plan name nobody added to
// `classifyForReport` (lib/revenue-report.ts) banks as TRANSIENT forever, and
// the daily snapshot freezes it. This audit lists every distinct rate plan
// actually in use per property with its volume and how BOTH classifiers bucket
// it, so unlisted lease-like plans surface instead of hiding in the transient
// bucket. Read-only; no writes, no PII.

/** Lease-ish vocabulary — deliberately BROADER than either classifier. A plan
 *  matching this but classified `transient` is a review candidate, NOT
 *  automatically a bug: Monica's confirmed rule (memory
 *  `monica-revenue-methodology`) treats weekly-RATE promos as transient on
 *  purpose. Human judgement decides; this only narrows what to look at. */
const LEASE_LIKE = /lease|month|week|long.?term|extend|resident|tenant|permanent|\bltr\b|\bml\b|\bwl\b|\d+\s*night/i;

export type RatePlanUsage = {
  plan: string;
  /** Bucket used by the daily report + banked snapshots (lib/revenue-report). */
  reportClass: "lease" | "transient";
  /** Bucket used by the in-house lease-mix widget (lib/lease). */
  mixClass: "lease-monthly" | "lease-weekly" | "transient";
  /** Dataset-3 summed room_count over the range (relative volume, not rooms). */
  roomNights: number;
  /** Dataset-1 Room-Rate debit_amount over the range. */
  roomRateRevenue: number;
  /** Lease-like wording but the report classifies it transient — review. */
  reviewCandidate: boolean;
};

export type PropertyRatePlans = {
  code: string;
  id: string;
  name: string;
  ok: boolean;
  error?: string;
  plans: RatePlanUsage[];
};

/** Distinct rate plans in use per property over [start, end], with volume and
 *  both classifier verdicts. Properties run in parallel; a property without a
 *  key or with a Cloudbeds error reports `ok:false` rather than aborting. */
export async function getRatePlanInventory(start: string, end: string): Promise<PropertyRatePlans[]> {
  return Promise.all(
    PROPERTIES.map(async (property): Promise<PropertyRatePlans> => {
      const base = { code: property.code, id: property.id, name: property.name };
      const key = readKey(property.code);
      if (!key || !property.apiPropertyId) {
        return { ...base, ok: false, error: "no API key or apiPropertyId configured", plans: [] };
      }

      const [nights, revenue] = await Promise.all([
        diDataset3Grouped(key, property.apiPropertyId, "public_rate_plan", ["room_count"], start, end),
        diDataset1Grouped(key, property.apiPropertyId, "public_rate_plan", ["debit_amount"], start, end, [
          { cdf: { column: "transaction_type" }, operator: "equals", value: "Room Rate" },
        ]),
      ]);
      if (!nights.ok && !revenue.ok) {
        return { ...base, ok: false, error: nights.error, plans: [] };
      }

      const merged = new Map<string, { roomNights: number; roomRateRevenue: number }>();
      const add = (res: typeof nights, measure: string, field: "roomNights" | "roomRateRevenue") => {
        if (!res.ok) return;
        res.data.index.forEach((plan, i) => {
          const row = merged.get(plan) ?? { roomNights: 0, roomRateRevenue: 0 };
          row[field] += res.data.records[measure]?.[i] ?? 0;
          merged.set(plan, row);
        });
      };
      add(nights, "room_count", "roomNights");
      add(revenue, "debit_amount", "roomRateRevenue");

      const plans = [...merged.entries()]
        .map(([plan, v]): RatePlanUsage => {
          const reportClass = classifyForReport(plan);
          return {
            plan,
            reportClass,
            mixClass: classifyRatePlan(plan),
            roomNights: v.roomNights,
            roomRateRevenue: Math.round(v.roomRateRevenue * 100) / 100,
            reviewCandidate: reportClass === "transient" && LEASE_LIKE.test(plan),
          };
        })
        .sort((a, b) => b.roomRateRevenue - a.roomRateRevenue || b.roomNights - a.roomNights);

      return {
        ...base,
        ok: true,
        error: nights.ok ? (revenue.ok ? undefined : `revenue query failed: ${revenue.error}`) : `nights query failed: ${nights.error}`,
        plans,
      };
    }),
  );
}
