// Canonical property list. Keep in sync with CLAUDE.md §3.
// 8 properties total; 6 active in Cloudbeds (which 6 is UNCONFIRMED — verify
// against Cloudbeds before relying on `active`). Davenport (44199) is the pilot.

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
   * Exclude from the portfolio average AND the current-occupancy strip (still
   * shown as a tab). Use for properties with no bookings that would distort the
   * aggregate — e.g. Jacksonville North.
   */
  excludeFromAggregate?: boolean;
};

// Each property has its own scoped Cloudbeds API key in env var
// CLOUDBEDS_API_KEY_<CODE>. The CODE here MUST match the env var suffix you set
// in Vercel. A key resolves its own property, so no propertyID is passed. API
// All 8 API propertyIDs verified 2026-06-18 via getHotels (all org 206670) and
// confirmed against propertyName. JN is live but usually has no bookings, so
// expect 0% occupancy — valid data, not an error.
export const PROPERTIES: Property[] = [
  { id: "44199", code: "DP", apiPropertyId: "318197", name: "Davenport", county: "Polk", active: true, pilot: true },
  { id: "4645", code: "LL", apiPropertyId: "210972", name: "Lakeland", county: "Polk", active: true },
  { id: "2295", code: "KE", apiPropertyId: "210986", name: "Kissimmee East", county: "Osceola", active: true },
  { id: "5399", code: "KW", apiPropertyId: "210969", name: "Kissimmee West", county: "Osceola", active: true },
  { id: "6802", code: "JW", apiPropertyId: "210987", name: "Jacksonville West", county: "Duval", active: true },
  { id: "812", code: "JN", apiPropertyId: "206628", name: "Jacksonville North", county: "Duval", active: true, excludeFromAggregate: true },
  { id: "2535", code: "SA", apiPropertyId: "208155", name: "St. Augustine", county: "St. Johns", active: true },
  { id: "8700", code: "OR", apiPropertyId: "210971", name: "Orlando OBT", county: "Orange", active: true },
];

export const PILOT_PROPERTY = PROPERTIES.find((p) => p.pilot)!;

export function getProperty(id: string): Property | undefined {
  return PROPERTIES.find((p) => p.id === id);
}
