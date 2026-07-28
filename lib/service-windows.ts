// In-service windows and sellable-room overrides (config/properties.ts).
//
// WHY (07/28/26 parity analysis vs Monica's report): two denominator bugs made
// occupancy read materially wrong.
//
//  1. INVENTORY was stamped as today's capacity on EVERY day, including days a
//     property was not operating. Jacksonville North's 2026 YTD inventory read
//     26,289 room-nights (127 x 207) vs Monica's 14,859 (127 x 117) — that one
//     row pulled portfolio YTD occupancy from 79.7% to 75.8%. Same class of bug
//     across the Last-Year columns, where 2025 rows carry 2026 capacity:
//     Davenport's LY YTD occupancy was off by 33.4 percentage points.
//
//  2. OUT-OF-ORDER came only from Cloudbeds `out_of_service` blocks. At JN only
//     20 of ~107 unsellable rooms are blocked, so the dashboard showed 89
//     bookable rooms at a property that can sell none.
//
// Everything here is pure calendar/arithmetic over the config — no I/O — so it
// is unit-tested directly (lib/service-windows.test.ts).

import { PROPERTIES, type Property } from "@/config/properties";
import { shiftYmd } from "@/lib/dates";

type Window = { from: string; to?: string };

/** True iff `day` (YYYY-MM-DD) falls inside `w` (inclusive; open-ended `to`). */
function covers(w: Window, day: string): boolean {
  if (day < w.from) return false;
  return w.to == null || day <= w.to;
}

/** True iff the property was in service on `day`. A property with no
 *  `inServiceWindows` is treated as always in service (the common case). */
export function isInService(property: Property, day: string): boolean {
  const windows = property.inServiceWindows;
  if (!windows || windows.length === 0) return true;
  return windows.some((w) => covers(w, day));
}

/** Sellable rooms on `day`: the override if one covers the day, else the
 *  property's full physical capacity. Zero when out of service. */
export function sellableRooms(property: Property, day: string, capacity: number): number {
  if (!isInService(property, day)) return 0;
  const override = property.sellableOverrides?.find((w) => covers(w, day));
  return override ? Math.min(override.rooms, capacity) : capacity;
}

/** Physical inventory to bank for `day`: capacity when in service, else 0.
 *  Note this is the PHYSICAL room count (Monica reports 127 for JN even while
 *  107 are unsellable) — unsellable rooms surface as out-of-order, not as a
 *  smaller denominator. */
export function inventoryFor(property: Property, day: string, capacity: number): number {
  return isInService(property, day) ? capacity : 0;
}

/** Days in [start, end] (inclusive) on which the property was in service. */
export function inServiceDays(property: Property, start: string, end: string): string[] {
  const days: string[] = [];
  for (let d = start; d <= end; d = shiftYmd(d, 1)) {
    if (isInService(property, d)) days.push(d);
  }
  return days;
}

/** OOO room-nights implied by the sellable-room override over [start, end]:
 *  Σ (capacity - sellable) across in-service days. Zero when no override
 *  applies. The caller takes `max(cloudbedsBlockNights, this)` so a real
 *  Cloudbeds block set always wins when it is the larger (more complete) figure. */
export function overrideOooNights(
  property: Property,
  start: string,
  end: string,
  capacity: number,
): number {
  if (!property.sellableOverrides?.length) return 0;
  let nights = 0;
  for (const day of inServiceDays(property, start, end)) {
    nights += Math.max(0, capacity - sellableRooms(property, day, capacity));
  }
  return nights;
}

/** The override reasons in force over [start, end], for the report's source
 *  badge. Empty array = every figure in the range is Cloudbeds-sourced. */
export function activeOverrideNotes(property: Property, start: string, end: string): string[] {
  return (property.sellableOverrides ?? [])
    .filter((w) => w.from <= end && (w.to == null || w.to >= start))
    .map((w) => w.reason);
}

/** Lookup by short code, for callers that only carry a code (DB rows, exports). */
export function propertyByCode(code: string): Property | undefined {
  return PROPERTIES.find((p) => p.code === code);
}
