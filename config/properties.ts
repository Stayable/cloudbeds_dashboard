// Canonical property list. Keep in sync with CLAUDE.md §3.
// All 8 properties are active in Cloudbeds (confirmed by Kyle 2026-06-30).
// Davenport (44199) was the pilot. `active` = active in Cloudbeds; having a
// working API key is separate (audit with scripts/audit-keys.mjs).

export type Property = {
  /**
   * RISE8/business property ID — used on filenames & business docs per the org
   * convention (CLAUDE.md §7). NOT the Cloudbeds API ID.
   */
  id: string;
  /**
   * Short property code. Drives the per-property env var name:
   * `CLOUDBEDS_API_KEY_<CODE>` (e.g. DP -> CLOUDBEDS_API_KEY_DP).
   */
  code: string;
  /**
   * Cloudbeds API propertyID — the ID the API actually uses. Differs from `id`.
   * Verified via getHotels. `null` = not yet verified against the API.
   */
  apiPropertyId: string | null;
  name: string;
  county: string;
  /** Active in Cloudbeds. `false`/`unconfirmed` until verified against the API. */
  active: boolean | "unconfirmed";
  /** True for the property we wired/tested first. */
  pilot?: boolean;
  /**
   * Default OFF in the portfolio average (user can toggle it back on live).
   * Use for properties that would distort the aggregate — e.g. Jacksonville
   * North (no bookings).
   */
  excludeFromAggregate?: boolean;
  /**
   * Manual capacity adjustment applied to the occupancy denominator, e.g. -20
   * for rooms pulled out of inventory for renovation. Occupancy is then
   * roomsOccupied / (capacity + capacityAdjustment).
   */
  capacityAdjustment?: number;
  /** Short reason for capacityAdjustment, shown on the property's tab. */
  adjustmentNote?: string;
  /**
   * Windows during which the property was IN SERVICE (i.e. its rooms were
   * sellable and belong in the occupancy denominator), inclusive; `to` omitted
   * means "still open". Days outside every window contribute ZERO inventory,
   * so they neither inflate the denominator nor drag %Occupied down.
   *
   * WHY (07/28/26): the snapshot store stamped today's capacity on EVERY day,
   * including days a property wasn't operating — Jacksonville North's 2026 YTD
   * inventory read 26,289 room-nights (127 x 207) against Monica's 14,859
   * (127 x 117), which alone pulled portfolio YTD occupancy from 79.7% to
   * 75.8%. Omit the field entirely for a property that has been open
   * throughout (the default is "always in service").
   */
  inServiceWindows?: { from: string; to?: string }[];
  /**
   * SELLABLE rooms per day, for properties where rooms are physically
   * unsellable but are NOT blocked in Cloudbeds. Out-of-order is then derived
   * as `ooo = max(cloudbedsBlockNights, (inventory - sellable) x days)` and
   * flagged with a `manual override` source badge — never silently blended.
   *
   * Modelled as SELLABLE rooms rather than a fixed OOO count on purpose: OOO
   * expressed as a constant goes stale as occupancy moves (and can drive
   * Available negative), whereas a sellable-room count stays arithmetically
   * coherent day to day.
   *
   * This is a STOPGAP, not the fix. The real fix is to block the rooms in
   * Cloudbeds as `out_of_service` so the API is the source of truth; delete the
   * override the day that happens.
   */
  sellableOverrides?: { from: string; to?: string; rooms: number; reason: string }[];
};

// Each property has its own scoped Cloudbeds API key in env var
// CLOUDBEDS_API_KEY_<CODE>. The CODE here MUST match the env var suffix you set
// in Vercel. A key resolves its own property, so no propertyID is passed. API
// All 8 API propertyIDs verified 2026-06-18 via getHotels (all org 206670) and
// confirmed against propertyName. JN is live but usually has no bookings, so
// expect 0% occupancy — valid data, not an error.
export const PROPERTIES: Property[] = [
  // Davenport opened 2025-06-01. Derived independently two ways and they agree
  // exactly: Monica's 2025 YTD inventory through 7/19 is 7,399 = 151 rooms x 49
  // days (Jun 1 - Jul 19), and our own store has real counts on exactly 214 of
  // 365 days in 2025 = Jun 1 - Dec 31. (Capacity was 151 in 2025 vs 153 now —
  // that is handled by the workbook-sourced per-day inventory, not by this
  // window.)
  {
    id: "44199", code: "DP", apiPropertyId: "318197", name: "Davenport", county: "Polk",
    active: true, pilot: true,
    inServiceWindows: [{ from: "2025-06-01" }],
  },
  { id: "4645", code: "LL", apiPropertyId: "210972", name: "Lakeland", county: "Polk", active: true },
  { id: "2295", code: "KE", apiPropertyId: "210986", name: "Kissimmee East", county: "Osceola", active: true, capacityAdjustment: -20, adjustmentNote: "20 rooms out for renovation" },
  { id: "5399", code: "KW", apiPropertyId: "210969", name: "Kissimmee West", county: "Osceola", active: true },
  { id: "6802", code: "JW", apiPropertyId: "210987", name: "Jacksonville West", county: "Duval", active: true },
  // Jacksonville North: operated Jan-Apr 2025, dark through Mar 2026, reopened
  // 2026-04-01 with the bulk of the property still under renovation. Windows
  // derived two ways that agree exactly: Monica's inventory is 15,240 = 127 x
  // 120 days (Jan 1 - Apr 30 2025) and 14,859 = 127 x 117 days (Apr 1 - Jul 26
  // 2026); our store has real counts on exactly 120 days of 2025 and 118 of
  // 2026.
  //
  // sellableOverrides: only ~20 of the 127 rooms are actually sellable, but just
  // 20 are blocked `out_of_service` in Cloudbeds, so the API reports OOO 20 and
  // Available 89 — i.e. the dashboard claims 89 bookable rooms at a property
  // that can sell none. UNVERIFIED WITH JN OPS: 20 is inferred from Monica's
  // reported OOO (107 = 127 - 20) plus her Available of 0-2. Confirm with the
  // property, and DELETE this override once the rooms are blocked in Cloudbeds.
  {
    id: "812", code: "JN", apiPropertyId: "206628", name: "Jacksonville North", county: "Duval",
    active: true, excludeFromAggregate: true,
    inServiceWindows: [{ from: "2025-01-01", to: "2025-04-30" }, { from: "2026-04-01" }],
    sellableOverrides: [
      { from: "2026-04-01", rooms: 20, reason: "Renovation: ~107 of 127 rooms unsellable but not blocked in Cloudbeds (room count inferred, unconfirmed)" },
    ],
  },
  { id: "2535", code: "SA", apiPropertyId: "208155", name: "St. Augustine", county: "St. Johns", active: true },
  { id: "8700", code: "OR", apiPropertyId: "210971", name: "Orlando OBT", county: "Orange", active: true },
];

export const PILOT_PROPERTY = PROPERTIES.find((p) => p.pilot)!;

export function getProperty(id: string): Property | undefined {
  return PROPERTIES.find((p) => p.id === id);
}

/** Business property ID for a short code (e.g. "DP" -> "44199"); null if none.
 *  Used to stamp export filenames (§7) from views keyed by code. */
export function propertyIdByCode(code: string): string | null {
  return PROPERTIES.find((p) => p.code === code)?.id ?? null;
}
