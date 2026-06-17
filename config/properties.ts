// Canonical property list. Keep in sync with CLAUDE.md §3.
// 8 properties total; 6 active in Cloudbeds (which 6 is UNCONFIRMED — verify
// against Cloudbeds before relying on `active`). Davenport (44199) is the pilot.

export type Property = {
  /** Cloudbeds Property ID — reference on every property-specific output. */
  id: string;
  name: string;
  county: string;
  /** Active in Cloudbeds. `false`/`unconfirmed` until verified against the API. */
  active: boolean | "unconfirmed";
  /** True for the property we are wiring/testing first. */
  pilot?: boolean;
};

export const PROPERTIES: Property[] = [
  { id: "44199", name: "Davenport", county: "Polk", active: true, pilot: true },
  { id: "4645", name: "Lakeland", county: "Polk", active: "unconfirmed" },
  { id: "2295", name: "Kissimmee East", county: "Osceola", active: "unconfirmed" },
  { id: "5399", name: "Kissimmee West", county: "Osceola", active: "unconfirmed" },
  { id: "6802", name: "Jacksonville West", county: "Duval", active: "unconfirmed" },
  { id: "812", name: "Jacksonville North", county: "Duval", active: "unconfirmed" },
  { id: "2535", name: "St. Augustine", county: "St. Johns", active: "unconfirmed" },
  { id: "8700", name: "Orlando OBT", county: "Orange", active: "unconfirmed" },
];

export const PILOT_PROPERTY = PROPERTIES.find((p) => p.pilot)!;

export function getProperty(id: string): Property | undefined {
  return PROPERTIES.find((p) => p.id === id);
}
