// Microsoft Teams Adaptive Card builder for the daily occupancy/revenue
// report. Pure function -- consumes only the RevenueReport model + a base
// URL, no network/fs. The output is POSTed as-is to a Power Automate flow
// whose "Post card" step requires a full Adaptive Card v1.4 object at the
// top level (verified live 2026-07-22 -- anything else 400s). It also 400s
// on non-ASCII bytes, so every string built here must be ASCII-safe.
import { PROPERTIES } from "../config/properties";
import type { RevenueReport, PropertyActual, DerivedRow } from "./revenue-report";

const pct = (n: number) => (n * 100).toFixed(1) + "%";
const money = (n: number) =>
  "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function excludeFromAggregate(code: string): boolean {
  return PROPERTIES.find((p) => p.code === code)?.excludeFromAggregate === true;
}

/** Occupied/inventory-weighted portfolio occupancy %, excluding properties
 *  flagged `excludeFromAggregate` (e.g. JN). Divide-by-zero guarded. */
function weightedOcc(actual: PropertyActual[], pick: (p: PropertyActual) => DerivedRow): number {
  let occupied = 0;
  let inventory = 0;
  for (const p of actual) {
    if (excludeFromAggregate(p.code)) continue;
    const row = pick(p);
    occupied += row.occupied;
    inventory += row.inventory;
  }
  return inventory ? occupied / inventory : 0;
}

function sumRoomRev(actual: PropertyActual[], pick: (p: PropertyActual) => DerivedRow): number {
  let total = 0;
  for (const p of actual) {
    if (excludeFromAggregate(p.code)) continue;
    total += pick(p).roomRev;
  }
  return total;
}

/** True if ANY aggregate-eligible property's MTD counts are partial — in that
 *  case the portfolio MTD occupancy % would combine some properties' real
 *  counts with others' ~1-day counts, so it must not be surfaced at all
 *  (Kyle's decision, partial-counts-brief.md). Room Revenue (MTD) is
 *  unaffected and always shown. */
function mtdCountsPartial(actual: PropertyActual[]): boolean {
  return actual.some((p) => !excludeFromAggregate(p.code) && p.mtd.countsPartial === true);
}

/**
 * Build the Adaptive Card (v1.4) POST body for the Teams daily report post.
 * Pure function: no I/O, JSON-serializable, ASCII-only output.
 */
export function buildReportCard(report: RevenueReport, baseUrl: string): object {
  const portfolioOccYesterday = weightedOcc(report.actual, (p) => p.yesterday.actual);
  const roomRevYesterday = sumRoomRev(report.actual, (p) => p.yesterday.actual);
  const roomRevMtd = sumRoomRev(report.actual, (p) => p.mtd.actual);
  const mtdPartial = mtdCountsPartial(report.actual);

  const footerParts = [report.sourceNote];
  if (report.trackingSince) {
    footerParts.push(`MTD/YTD accumulate from ${report.trackingSince}`);
  }

  // Portfolio MTD occupancy % is only meaningful once every aggregate-eligible
  // property's MTD counts are a complete period — otherwise it blends real
  // counts with ~1-day counts into a garbage figure. Omit the fact entirely
  // when partial; Room Revenue (MTD) is unaffected and always shown.
  const facts: { title: string; value: string }[] = [
    { title: "Portfolio Occupancy (Yesterday)", value: pct(portfolioOccYesterday) },
  ];
  if (!mtdPartial) {
    const portfolioOccMtd = weightedOcc(report.actual, (p) => p.mtd.actual);
    facts.push({ title: "Portfolio Occupancy (MTD)", value: pct(portfolioOccMtd) });
  }
  facts.push(
    { title: "Room Revenue (Yesterday)", value: money(roomRevYesterday) },
    { title: "Room Revenue (MTD)", value: money(roomRevMtd) },
  );

  const body: unknown[] = [
    {
      type: "TextBlock",
      text: "Stayable - Occupancy & Revenue",
      weight: "Bolder",
      size: "Large",
      wrap: true,
    },
    {
      type: "TextBlock",
      text: `As of ${report.asOf} - Generated ${report.generatedEastern}`,
      isSubtle: true,
      wrap: true,
    },
    {
      type: "FactSet",
      facts,
    },
    {
      type: "TextBlock",
      text: "By property (yesterday)",
      weight: "Bolder",
      wrap: true,
      spacing: "Medium",
    },
    {
      type: "FactSet",
      facts: report.actual.map((p) => ({
        title: p.name,
        value: `${pct(p.yesterday.actual.pOcc)} occ - RevPAR ${money(p.yesterday.actual.revpar)}`,
      })),
    },
    {
      type: "TextBlock",
      text: footerParts.join(". "),
      isSubtle: true,
      wrap: true,
      size: "Small",
    },
  ];

  const actions = [
    { type: "Action.OpenUrl", title: "View report", url: `${baseUrl}/report` },
    { type: "Action.OpenUrl", title: "Download Excel", url: `${baseUrl}/report/latest.xlsx` },
    { type: "Action.OpenUrl", title: "Download PDF", url: `${baseUrl}/report/latest.pdf` },
  ];

  return {
    type: "AdaptiveCard",
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    version: "1.4",
    body,
    actions,
  };
}
