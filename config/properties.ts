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
};

// Each property has its own scoped Cloudbeds API key in env var
// CLOUDBEDS_API_KEY_<CODE>. A key resolves its own property, so no propertyID is
// passed. Davenport verified 2026-06-18 via getHotels: API propertyID 318197,
// org 206670. Other API IDs are unverified — confirm each via getHotels.
export const PROPERTIES: Property[] = [
  { id: "44199", code: "DP", apiPropertyId: "318197", name: "Davenport", county: "Polk", active: true, pilot: true },
  { id: "4645", code: "LK", apiPropertyId: null, name: "Lakeland", county: "Polk", active: "unconfirmed" },
  { id: "2295", code: "KE", apiPropertyId: null, name: "Kissimmee East", county: "Osceola", active: "unconfirmed" },
  { id: "5399", code: "KW", apiPropertyId: null, name: "Kissimmee West", county: "Osceola", active: "unconfirmed" },
  { id: "6802", code: "JW", apiPropertyId: null, name: "Jacksonville West", county: "Duval", active: "unconfirmed" },
  { id: "812", code: "JN", apiPropertyId: null, name: "Jacksonville North", county: "Duval", active: "unconfirmed" },
  { id: "2535", code: "SA", apiPropertyId: null, name: "St. Augustine", county: "St. Johns", active: "unconfirmed" },
  { id: "8700", code: "OB", apiPropertyId: null, name: "Orlando OBT", county: "Orange", active: "unconfirmed" },
];

export const PILOT_PROPERTY = PROPERTIES.find((p) => p.pilot)!;

export function getProperty(id: string): Property | undefined {
  return PROPERTIES.find((p) => p.id === id);
}
