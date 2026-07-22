// Renderer for the Out-of-Order category PDF (`/ops/ooo.pdf`). Consumes the
// SAME PropertyOoo[] the on-screen /ops OOO explorer (BeaOosExplorer) renders
// (via lib/cloudbeds.ts getPortfolioOoo), so the PDF's OOO counts always match
// the dashboard. Capacity (for OOO %) comes from getPortfolio's live
// DashboardData -- a point-in-time snapshot, same as the OOO block itself.
// ASCII-safe, PII-free: room codes are inventory identifiers, never guest data.
import type { PropertyOoo, PropertyDashboard, OooRoom } from "@/lib/cloudbeds";
import { oooInsights } from "@/lib/ops-insights";
import {
  newOpsDoc,
  pageHeader,
  summaryTiles,
  propertyTable,
  insightsBlock,
  opsFooter,
  finishPdf,
  pct,
  int,
} from "@/lib/ops-pdf-kit";

const UNSPECIFIED_REASON = "Unspecified";
const RED: [number, number, number] = [248, 214, 214];
const AMBER: [number, number, number] = [252, 232, 196];
const AMBER_THRESHOLD = 0.1; // fraction -- OOO% above this shades amber
const RED_THRESHOLD = 0.2; // fraction -- OOO% above this shades red

const MARGIN = 24;
const PAGE_BOTTOM_GUARD = 40;

function oooRoomCount(p: PropertyOoo): number | null {
  return p.configured && p.result?.ok ? p.result.data.length : null;
}

/** Most frequent (trimmed) reason among a property's OOO rooms; blank/"--"
 *  reasons collapse to "Unspecified" -- same convention as oooInsights. */
function topReason(rooms: OooRoom[]): string {
  if (rooms.length === 0) return "-";
  const counts = new Map<string, number>();
  for (const r of rooms) {
    const trimmed = r.reason?.trim();
    const label = trimmed && trimmed !== "—" ? trimmed : UNSPECIFIED_REASON;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

export function renderOooPdf(
  ooo: PropertyOoo[],
  portfolio: PropertyDashboard[],
  asOf: string,
): Buffer {
  const doc = newOpsDoc();

  let y = pageHeader(doc, {
    title: "Out-of-Order Rooms - Portfolio",
    subtitle: `As of ${asOf} - live snapshot`,
    asOf,
  });

  // Capacity per property, from the same live getPortfolio snapshot the
  // occupancy view uses -- only known for configured properties with a
  // successful dashboard read.
  const capacityByCode = new Map<string, number>();
  for (const pd of portfolio) {
    if (pd.configured && pd.result?.ok) capacityByCode.set(pd.property.code, pd.result.data.capacity);
  }

  let totalOoo = 0;
  let totalCapacity = 0;
  let propertiesWithOoo = 0;
  for (const p of ooo) {
    const count = oooRoomCount(p);
    if (count === null) continue;
    totalOoo += count;
    if (count > 0) propertiesWithOoo += 1;
    const cap = capacityByCode.get(p.property.code);
    if (cap !== undefined) totalCapacity += cap;
  }
  const portfolioOooPct = totalCapacity > 0 ? totalOoo / totalCapacity : null;

  y = summaryTiles(doc, y, [
    { label: "Total OOO Rooms", value: int(totalOoo) },
    { label: "Portfolio OOO %", value: portfolioOooPct === null ? "-" : pct(portfolioOooPct) },
    { label: "Properties With OOO", value: int(propertiesWithOoo) },
  ]);

  const head = ["Property", "OOO Rooms", "OOO %", "Top Reason"];
  const rows: (string | number)[][] = ooo.map((p) => {
    const count = oooRoomCount(p);
    if (count === null) {
      return [p.property.name, "n/a", "n/a", "n/a"];
    }
    const cap = capacityByCode.get(p.property.code);
    const oooPct = cap && cap > 0 ? count / cap : null;
    const reason = p.result?.ok ? topReason(p.result.data) : "-";
    return [p.property.name, int(count), oooPct === null ? "-" : pct(oooPct), reason];
  });

  y = propertyTable(doc, y, head, rows, {
    shadeCol: 2,
    shadeRule: (v) => {
      const frac = v / 100;
      if (frac > RED_THRESHOLD) return RED;
      if (frac > AMBER_THRESHOLD) return AMBER;
      return null;
    },
  });

  // Per-property room detail -- only properties with at least one OOO room.
  for (const p of ooo) {
    if (!p.result?.ok || p.result.data.length === 0) continue;
    y = roomsHeading(doc, y, `${p.property.name} (${p.property.id})`);
    y = propertyTable(
      doc,
      y,
      ["Room", "Type", "Reason"],
      p.result.data.map((r) => [
        r.room || "Unknown",
        r.roomType || "-",
        r.reason?.trim() && r.reason.trim() !== "—" ? r.reason.trim() : UNSPECIFIED_REASON,
      ]),
    );
  }

  y = insightsBlock(doc, y, oooInsights(ooo));
  opsFooter(
    doc,
    "Live snapshot - room numbers are inventory, not guest PII - Cloudbeds-sourced.",
  );

  return finishPdf(doc);
}

/** Small property-name heading above a per-property room table. Pages first
 *  if it (plus a little breathing room) would overflow the current page, so
 *  the heading never gets stranded at the bottom separated from its table. */
function roomsHeading(doc: import("jspdf").jsPDF, y: number, label: string): number {
  const pageH = doc.internal.pageSize.getHeight();
  let cursorY = y;
  if (cursorY + 40 > pageH - PAGE_BOTTOM_GUARD) {
    doc.addPage();
    cursorY = MARGIN;
  }
  doc.setFontSize(10);
  doc.text(label, MARGIN, cursorY + 10);
  return cursorY + 18;
}
