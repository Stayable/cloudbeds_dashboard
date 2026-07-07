// EliseAI (Snowflake data share) building → Stayable property map.
// Resolved 2026-07-08 from RISE8_DATA.DA.PROPERTY_SETTINGS_RISE8 (ORG_ID 2656).
// Elise's external_building_id / external_pms_id are EMPTY, so this map is the
// only reliable join between Elise's BUILDING_ID and our property list — keep it
// hardcoded and in sync with config/properties.ts (matched by `code`).
//
// Two unlaunched duplicate buildings (859088 "Lakeland New", 859089 "Davenport
// New", ACTIVE_LAUNCHED=false) carry only 2-3 rows of noise; they map to their
// parent property (LL / DP) so any stray rows fold in rather than being dropped.

import { PROPERTIES, type Property } from "@/config/properties";
// Single source of truth for the raw building→code map (also read by the
// standalone sync script scripts/elise-sync.mjs, which can't import this TS).
import buildingMap from "@/config/elise-buildings.json";

/** Elise BUILDING_ID (a.k.a. ELISE_PROPERTY_ID) → Stayable property `code`.
 *  688105 KW · 688101 OR · 688102 KE · 688103 LL · 688104 JW · 688106 SA ·
 *  688107 DP · 933088 JN · 859088/859089 = unlaunched LL/DP dupes (folded in). */
export const ELISE_BUILDING_TO_CODE: Record<number, string> = Object.fromEntries(
  Object.entries(buildingMap).map(([k, v]) => [Number(k), v as string]),
);

/** All Elise BUILDING_IDs we recognize (for query filtering / validation). */
export const ELISE_BUILDING_IDS = Object.keys(ELISE_BUILDING_TO_CODE).map(Number);

/** Map an Elise BUILDING_ID to its Stayable Property, or undefined if unknown. */
export function propertyForBuilding(buildingId: number): Property | undefined {
  const code = ELISE_BUILDING_TO_CODE[buildingId];
  return code ? PROPERTIES.find((p) => p.code === code) : undefined;
}

/** Map an Elise BUILDING_ID to its Stayable business property ID (e.g. "44199"). */
export function stayableIdForBuilding(buildingId: number): string | null {
  return propertyForBuilding(buildingId)?.id ?? null;
}
