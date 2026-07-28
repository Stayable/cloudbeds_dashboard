// Revenue & rate summary for the /crystal dashboard, derived from the same
// inputs the occupancy view uses. ADR and RevPAR are REAL (Data Insights dataset
// 7). Total room revenue / total revenue are DERIVED (RevPAR × capacity × days)
// and must be labeled "est." — the DI public API does not sum currency columns,
// so this mirrors the existing exec-view revenue approach. No fabricated values:
// a property with no insights data yields nulls, not zeros.

import type { PropertyDashboard, PropertyInsights } from "@/lib/cloudbeds";

export type RevenueRow = {
  code: string;
  name: string;
  county: string;
  adr: number | null; // avg ADR over days with rate activity
  revpar: number | null; // avg RevPAR over the range
  roomRevenueEst: number | null; // revpar × capacity × days
  capacity: number;
};

export type RevenueSummary = {
  rows: RevenueRow[];
  portfolioAdr: number | null; // capacity-weighted
  portfolioRevpar: number | null; // capacity-weighted
  totalRoomRevenueEst: number | null; // Σ roomRevenueEst
  days: number;
};

function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null;
}

export function buildRevenueSummary(
  portfolio: PropertyDashboard[],
  insights: PropertyInsights[],
  days: number,
): RevenueSummary {
  // Room counts weight the portfolio ADR/RevPAR averages, so they come from the
  // room list rather than getDashboard.capacity, which over-reports at some
  // properties (see getPhysicalRoomCount).
  const capByCode = new Map(
    portfolio.map((pd) => [
      pd.property.code,
      pd.physicalRooms?.count || (pd.result?.ok ? pd.result.data.capacity : 0),
    ]),
  );

  const rows: RevenueRow[] = insights.map((ins) => {
    const data = ins.result?.ok ? ins.result.data : [];
    const capacity = capByCode.get(ins.property.code) ?? 0;
    // ADR over days that actually had a rate (drop 0-rate/closed days so they
    // don't drag the average down); RevPAR over all days (0 is a real RevPAR).
    const adr = mean(data.filter((r) => r.adr > 0).map((r) => r.adr));
    const revpar = data.length ? mean(data.map((r) => r.revpar)) : null;
    const roomRevenueEst = revpar !== null && capacity > 0 ? revpar * capacity * days : null;
    return {
      code: ins.property.code,
      name: ins.property.name,
      county: ins.property.county,
      adr,
      revpar,
      roomRevenueEst,
      capacity,
    };
  });

  // Capacity-weighted portfolio ADR / RevPAR over reporting properties.
  let adrNum = 0,
    adrDen = 0,
    rpNum = 0,
    rpDen = 0,
    revTotal = 0,
    revAny = false;
  for (const r of rows) {
    if (r.capacity <= 0) continue;
    if (r.adr !== null) {
      adrNum += r.adr * r.capacity;
      adrDen += r.capacity;
    }
    if (r.revpar !== null) {
      rpNum += r.revpar * r.capacity;
      rpDen += r.capacity;
    }
    if (r.roomRevenueEst !== null) {
      revTotal += r.roomRevenueEst;
      revAny = true;
    }
  }

  return {
    rows,
    portfolioAdr: adrDen > 0 ? adrNum / adrDen : null,
    portfolioRevpar: rpDen > 0 ? rpNum / rpDen : null,
    totalRoomRevenueEst: revAny ? revTotal : null,
    days,
  };
}
