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
   * Cloudbeds API propertyID — the ID the API actually uses. Differs from `id`.
   * Verified via getHotels. Needed for multi-property (portfolio) calls.
   * `null` = not yet verified against the API.
   */
  apiPropertyId: string | null;
  name: string;
  county: string;
  /** Active in Cloudbeds. `false`/`unconfirmed` until verified against the API. */
  active: boolean | "unconfirmed";
  /** True for the property we are wiring/testing first. */
  pilot?: boolean;
};

// Davenport verified 2026-06-18 via getHotels: API propertyID 318197,
// organizationID 206670, name "Stayable Davenport". The other API IDs are
// unverified — confirm each via getHotels with that property's key.
export const PROPERTIES: Property[] = [
  { id: "44199", apiPropertyId: "318197", name: "Davenport", county: "Polk", active: true, pilot: true },
  { id: "4645", apiPropertyId: null, name: "Lakeland", county: "Polk", active: "unconfirmed" },
  { id: "2295", apiPropertyId: null, name: "Kissimmee East", county: "Osceola", active: "unconfirmed" },
  { id: "5399", apiPropertyId: null, name: "Kissimmee West", county: "Osceola", active: "unconfirmed" },
  { id: "6802", apiPropertyId: null, name: "Jacksonville West", county: "Duval", active: "unconfirmed" },
  { id: "812", apiPropertyId: null, name: "Jacksonville North", county: "Duval", active: "unconfirmed" },
  { id: "2535", apiPropertyId: null, name: "St. Augustine", county: "St. Johns", active: "unconfirmed" },
  { id: "8700", apiPropertyId: null, name: "Orlando OBT", county: "Orange", active: "unconfirmed" },
];

export const PILOT_PROPERTY = PROPERTIES.find((p) => p.pilot)!;

export function getProperty(id: string): Property | undefined {
  return PROPERTIES.find((p) => p.id === id);
}
