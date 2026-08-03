// Revenue & rate summary for /crystal, /monica and /rob, derived from the same
// banked snapshots the occupancy view uses — so a page can never show a
// snapshot occupancy beside a Data Insights rate.
//
// SOURCE CHANGE (Kyle, 08/03/26). This used to read ADR/RevPAR from Data
// Insights dataset 7 and DERIVE room revenue as RevPAR x capacity x days,
// labelled "est." because "the DI public API does not sum currency columns".
// That is no longer true of us: the snapshot store holds exact per-day room
// revenue, reconciled against Monica to the cent on 30 of 31 July days at KE.
// So revenue here is now REAL, not an estimate, and ADR/RevPAR are derived
// from it rather than from Cloudbeds' own arithmetic over a capacity figure
// that reads 168 at KE against a real 167.
//
// No fabricated values: a property with no banked days in range yields nulls,
// not zeros.

import type { PropertyDashboard } from "@/lib/cloudbeds";
import type { OccupancyRollup } from "@/lib/db";
import { PROPERTIES } from "@/config/properties";

export type RevenueRow = {
  code: string;
  name: string;
  county: string;
  adr: number | null; // room revenue / occupied nights
  revpar: number | null; // room revenue / inventory room-days
  roomRevenue: number | null; // exact, from the snapshot store
  capacity: number;
};

export type RevenueSummary = {
  rows: RevenueRow[];
  portfolioAdr: number | null; // revenue-weighted (Sum rev / Sum occupied)
  portfolioRevpar: number | null; // revenue-weighted (Sum rev / Sum inventory)
  totalRoomRevenue: number | null; // Sum of the exact per-property figures
  days: number;
};

export function buildRevenueSummary(
  portfolio: PropertyDashboard[],
  rollup: OccupancyRollup[],
  days: number,
): RevenueSummary {
  // Room counts still come from the room list rather than getDashboard.capacity,
  // which over-reports at some properties (see getPhysicalRoomCount). They are
  // display-only here now — the rates are weighted by banked room-days, which
  // already honour in-service windows and per-day capacity changes.
  const capByCode = new Map(
    portfolio.map((pd) => [
      pd.property.code,
      pd.physicalRooms?.count || (pd.result?.ok ? pd.result.data.capacity : 0),
    ]),
  );
  const meta = new Map(PROPERTIES.map((p) => [p.code, p]));

  const rows: RevenueRow[] = rollup.map((r) => {
    const p = meta.get(r.code);
    return {
      code: r.code,
      name: p?.name ?? r.code,
      county: p?.county ?? "",
      adr: r.occupied > 0 ? r.roomRev / r.occupied : null,
      revpar: r.inventory > 0 ? r.roomRev / r.inventory : null,
      roomRevenue: r.roomRev,
      capacity: capByCode.get(r.code) ?? 0,
    };
  });

  // Revenue-weighted, not capacity-weighted: the portfolio ADR is what the
  // portfolio actually earned per occupied night, which is Sum rev / Sum nights.
  // Weighting per-property averages by capacity gave a different (and wrong)
  // answer whenever occupancy differed between properties.
  let revTotal = 0,
    occTotal = 0,
    invTotal = 0;
  for (const r of rollup) {
    revTotal += r.roomRev;
    occTotal += r.occupied;
    invTotal += r.inventory;
  }

  return {
    rows,
    portfolioAdr: occTotal > 0 ? revTotal / occTotal : null,
    portfolioRevpar: invTotal > 0 ? revTotal / invTotal : null,
    totalRoomRevenue: rollup.length ? revTotal : null,
    days,
  };
}
