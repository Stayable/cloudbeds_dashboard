// Shared builder for the OccupancyView's per-property props. Used by both the
// base `/` dashboard and Rob's `/exec` view (which embeds the same operational
// explorer). Server-safe (no client runtime; the OccProperty import is a type).

import type { OccProperty } from "@/components/OccupancyView";
import type { PropertyDashboard, PropertyInsights } from "@/lib/cloudbeds";

/**
 * Combine the live portfolio snapshot (getPortfolio) with the date-ranged
 * occupancy insights (getPortfolioInsights) into the OccProperty[] that
 * OccupancyView renders: range-avg occupancy, daily bars, and the "Today"
 * live-snapshot cards per property.
 */
export function buildOccProperties(
  portfolio: PropertyDashboard[],
  insights: PropertyInsights[],
): OccProperty[] {
  const insByCode = new Map(insights.map((i) => [i.property.code, i]));

  return portfolio.map((pd) => {
    const ins = insByCode.get(pd.property.code);
    const rows = ins?.result?.ok ? ins.result.data : [];
    const rawOcc = rows.length ? rows.reduce((s, r) => s + r.occupancy, 0) / rows.length : null;
    const d = pd.result?.ok ? pd.result.data : null;
    // Room count comes from the room list, NOT getDashboard.capacity, which
    // over-reports by one at some properties (KE 168 vs 167, JW 134 vs 133 —
    // audited live 07/28/26). getPhysicalRoomCount already falls back to the
    // capacity aggregate if a key can't read the room list.
    // A zero count means both room-list and capacity lookups failed, so don't
    // let it wipe out a dashboard figure we did get.
    const roomCount = pd.physicalRooms?.count ?? 0;
    const capacity = roomCount > 0 ? roomCount : d ? d.capacity : 0;
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
      daily: rows.map((r) => ({ date: r.date, occupancy: r.occupancy })),
      live,
      error: ins?.result && !ins.result.ok ? ins.result.error : null,
    };
  });
}
