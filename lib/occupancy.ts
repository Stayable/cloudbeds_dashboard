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
    const live = d
      ? {
          roomsOccupied: d.roomsOccupied,
          capacity: d.capacity,
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
      capacity: pd.result?.ok ? pd.result.data.capacity : 0,
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
