// Shared builder for the OccupancyView's per-property props. Used by the base
// `/` dashboard, `/exec`, `/ops`, `/crystal`, `/monica` and `/rob` — every
// surface that shows an occupancy figure. Server-safe (no client runtime; the
// OccProperty import is a type).

import type { OccProperty } from "@/components/OccupancyView";
import type { PropertyDashboard } from "@/lib/cloudbeds";
import type { OccupancyRollup } from "@/lib/db";

/**
 * Combine the live portfolio snapshot (getPortfolio) with the banked
 * occupancy rollup (getOccupancyRollup) into the OccProperty[] that
 * OccupancyView renders: range occupancy, ADR/RevPAR, daily bars, and the
 * "Today" live-snapshot cards per property.
 *
 * SOURCE RULE (Kyle, 08/03/26): Cloudbeds is the source for PRIMITIVES —
 * transactions, the room list, blocks as observed at capture time. We own
 * every DERIVATION. Nothing here consumes Cloudbeds' pre-computed percentages,
 * because those are the one thing measurement showed to be wrong: DI divides
 * rooms *sold* by a capacity that reads 168 at KE (real 167) and 134 at JW
 * (real 133), and it excludes the "other blocks" that both `/report` and
 * Monica count as occupied. That put every property 0.6–4.2pp adrift of its
 * own figure on `/report`.
 *
 * The live "Today" card still comes straight from getDashboard — those are
 * primitives (arrivals, departures, in-house), not derivations.
 */
export function buildOccProperties(
  portfolio: PropertyDashboard[],
  rollup: OccupancyRollup[],
): OccProperty[] {
  const byCode = new Map(rollup.map((r) => [r.code, r]));

  return portfolio.map((pd) => {
    const roll = byCode.get(pd.property.code);
    const d = pd.result?.ok ? pd.result.data : null;
    // Room count comes from the room list, NOT getDashboard.capacity, which
    // over-reports by one at some properties (KE 168 vs 167, JW 134 vs 133 —
    // audited live 07/28/26). getPhysicalRoomCount already falls back to the
    // capacity aggregate if a key can't read the room list.
    // A zero count means both room-list and capacity lookups failed, so don't
    // let it wipe out a dashboard figure we did get.
    const roomCount = pd.physicalRooms?.count ?? 0;
    const capacity = roomCount > 0 ? roomCount : d ? d.capacity : 0;

    // Ratio of sums, matching /report's MTD/YTD roll-up exactly.
    const rawOcc = roll && roll.inventory > 0 ? (roll.occupied / roll.inventory) * 100 : null;
    const adr = roll && roll.occupied > 0 ? roll.roomRev / roll.occupied : null;
    const revpar = roll && roll.inventory > 0 ? roll.roomRev / roll.inventory : null;

    const live = d
      ? {
          roomsOccupied: d.roomsOccupied,
          capacity,
          inHouse: d.inHouse,
          guestsInHouse: d.guestsInHouse,
          arrivals: d.arrivals,
          arrivalsConfirmed: d.arrivalsConfirmed,
          departures: d.departures,
          departuresConfirmed: d.departuresConfirmed,
          stayovers: d.stayovers,
          roomsBlocked: d.roomsBlocked,
          outOfService: d.roomBlocks.out_of_service,
          percentageBlocked: d.percentageBlocked,
          bookings: d.bookings,
          cancellations: d.cancellations,
        }
      : null;
    return {
      code: pd.property.code,
      name: pd.property.name,
      county: pd.property.county,
      id: pd.property.id,
      configured: pd.configured,
      capacity,
      adjustment: pd.property.capacityAdjustment ?? 0,
      adjustmentNote: pd.property.adjustmentNote,
      excludeDefault: !!pd.property.excludeFromAggregate,
      rawOcc,
      adr,
      revpar,
      occupiedNights: roll?.occupied ?? 0,
      inventoryNights: roll?.inventory ?? 0,
      roomRev: roll?.roomRev ?? 0,
      daily: (roll?.days ?? []).map((p) => ({ date: p.day, occupancy: p.pOcc * 100 })),
      live,
      // A property with no banked days in range is not an error — it may be
      // out of service for the whole window (JN before April 2026).
      error: null,
    };
  });
}

/** The occupancy percentage every surface displays.
 *
 * Deliberately does NOT re-base onto post-adjustment capacity. It used to, in
 * three separately-maintained copies (OccupancyView, ops-insights,
 * ops-pdf-occupancy), which is how KE came to read 83.0% on `/ops` and 73.7%
 * on `/report` for the same period. The −20 at KE is an INTERPRETATION, not a
 * measurement, so it belongs in its own clearly-labelled line the way
 * `/report` does it ("% Occupied Adjusted (less 20 rms)") — never folded into
 * a headline that gets compared against other properties.
 *
 * Kept as a function, and as the single definition, so the next person who
 * wants to change the rule changes it once. */
export function displayOcc(p: Pick<OccProperty, "rawOcc">): number | null {
  return p.rawOcc;
}

/** The adjusted figure, for surfaces that want to show it ALONGSIDE the
 *  headline — e.g. KE's "less 20 rooms" view. Null when the property carries
 *  no adjustment, so callers can simply omit the line. */
export function adjustedOcc(
  p: Pick<OccProperty, "rawOcc" | "capacity" | "adjustment">,
): number | null {
  if (p.rawOcc === null || !p.adjustment) return null;
  const eff = p.capacity + p.adjustment;
  if (p.capacity <= 0 || eff <= 0) return null;
  return p.rawOcc * (p.capacity / eff);
}
