// Renderer for the Occupancy category PDF (`/ops/occupancy.pdf`). Consumes the
// SAME OccProperty[] the on-screen /ops Occupancy view renders (via
// lib/occupancy.ts's buildOccProperties), so the PDF's occupancy numbers always
// match the dashboard. ADR/RevPAR are not on OccProperty -- those come from
// PropertyInsights (lib/cloudbeds.ts getPortfolioInsights), averaged per
// property over the range. Rooms sold/available/OOO/inventory come from the
// live getPortfolio snapshot carried on OccProperty.live (a point-in-time
// count, not range-based -- called out in the footer). ASCII-safe, PII-free.
import type { OccProperty } from "@/components/OccupancyView";
import type { PropertyInsights } from "@/lib/cloudbeds";
import { occupancyInsights } from "@/lib/ops-insights";
import {
  newOpsDoc,
  pageHeader,
  summaryTiles,
  propertyTable,
  insightsBlock,
  opsFooter,
  finishPdf,
  pct,
  money,
  int,
} from "@/lib/ops-pdf-kit";

const LOW_SHADE = 0.65; // fraction -- below this, red
const MID_SHADE = 0.75; // fraction -- below this (and >= LOW_SHADE), amber
const RED: [number, number, number] = [248, 214, 214];
const AMBER: [number, number, number] = [252, 232, 196];

/** Re-base occupancy onto effective (post-adjustment) capacity. Mirrors
 *  effOcc() in components/OccupancyView.tsx and lib/ops-insights.ts so the
 *  PDF, the dashboard, and the insights bullets all agree on the same number. */
function effOcc(p: OccProperty): number | null {
  if (p.rawOcc === null) return null;
  const eff = p.capacity + p.adjustment;
  if (p.adjustment !== 0 && p.capacity > 0 && eff > 0) return p.rawOcc * (p.capacity / eff);
  return p.rawOcc;
}

function avg(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

export function renderOccupancyPdf(
  props: OccProperty[],
  insights: PropertyInsights[],
  range: { start: string; end: string },
): Buffer {
  const doc = newOpsDoc();
  const rangeLabel = range.start === range.end ? range.start : `${range.start} to ${range.end}`;

  let y = pageHeader(doc, {
    title: "Occupancy - Portfolio",
    subtitle: `${rangeLabel} - Eastern`,
    asOf: range.end,
  });

  // Portfolio occupancy: capacity-weighted, excluding excludeDefault properties
  // -- matches the dashboard's default portfolio average (lib/ops-insights.ts).
  const eligible = props.filter((p) => !p.excludeDefault && effOcc(p) !== null);
  let occNum = 0;
  let occDen = 0;
  for (const p of eligible) {
    const occ = effOcc(p);
    if (occ === null || p.capacity <= 0) continue;
    const eff = Math.max(0, p.capacity + p.adjustment);
    occNum += occ * eff;
    occDen += eff;
  }
  const portfolioOcc = occDen > 0 ? occNum / occDen : null;

  // ADR/RevPAR: average each configured property's daily OccupancyRow over the
  // range, then mean those per-property averages across configured properties.
  const insByCode = new Map(insights.map((i) => [i.property.code, i]));
  const adrByCode = new Map<string, number | null>();
  const revparByCode = new Map<string, number | null>();
  for (const p of props) {
    const ins = insByCode.get(p.code);
    const rows = ins?.result?.ok ? ins.result.data : [];
    adrByCode.set(p.code, avg(rows.map((r) => r.adr)));
    revparByCode.set(p.code, avg(rows.map((r) => r.revpar)));
  }
  const configuredAdrs = props
    .filter((p) => p.configured)
    .map((p) => adrByCode.get(p.code))
    .filter((n): n is number => n !== null && n !== undefined);
  const configuredRevpars = props
    .filter((p) => p.configured)
    .map((p) => revparByCode.get(p.code))
    .filter((n): n is number => n !== null && n !== undefined);
  const portfolioAdr = avg(configuredAdrs);
  const portfolioRevpar = avg(configuredRevpars);

  y = summaryTiles(doc, y, [
    { label: "Portfolio Occupancy", value: portfolioOcc === null ? "-" : pct(portfolioOcc / 100) },
    { label: "Portfolio Avg ADR", value: portfolioAdr === null ? "-" : money(portfolioAdr) },
    { label: "Portfolio Avg RevPAR", value: portfolioRevpar === null ? "-" : money(portfolioRevpar) },
  ]);

  const head = ["Property", "Occ %", "ADR", "RevPAR", "Rooms Sold", "Available", "OOO", "Inventory"];
  const rows: (string | number)[][] = props.map((p) => {
    if (!p.configured) {
      return [p.name, "not configured", "-", "-", "-", "-", "-", "-"];
    }
    const occ = effOcc(p);
    const adr = adrByCode.get(p.code);
    const revpar = revparByCode.get(p.code);
    const live = p.live;
    const available = live ? Math.max(0, live.capacity - live.roomsOccupied - live.outOfService) : null;
    return [
      p.name,
      occ === null ? "-" : pct(occ / 100),
      adr === null || adr === undefined ? "-" : money(adr),
      revpar === null || revpar === undefined ? "-" : money(revpar),
      live ? int(live.roomsOccupied) : "-",
      available === null ? "-" : int(available),
      live ? int(live.outOfService) : "-",
      live ? int(live.capacity) : "-",
    ];
  });

  y = propertyTable(doc, y, head, rows, {
    shadeCol: 1,
    shadeRule: (v) => {
      const frac = v / 100;
      if (frac < LOW_SHADE) return RED;
      if (frac < MID_SHADE) return AMBER;
      return null;
    },
  });

  y = insightsBlock(doc, y, occupancyInsights(props));
  opsFooter(
    doc,
    "Aggregated metrics only - no guest PII - Cloudbeds-sourced. " +
      "Occupancy/ADR/RevPAR are range averages; Rooms Sold/Available/OOO/Inventory are a live snapshot.",
  );

  return finishPdf(doc);
}
