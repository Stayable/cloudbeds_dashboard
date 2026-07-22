// Renderer for the Out-of-Order/blocked-rooms category PDF (`/ops/ooo.pdf`).
// Consumes the SAME PropertyOoo[] the on-screen /ops OOO explorer
// (BeaOosExplorer) renders (via lib/cloudbeds.ts getPortfolioOoo), so the
// PDF's counts always match the dashboard -- including the Out-of-Order vs
// Other breakdown (Kyle's decision, ooo-breakdown-brief.md: PropertyOoo now
// carries every block type, not just out_of_service, so both reconcile with
// ops' all-blocks tally). Capacity (for OOO %) comes from getPortfolio's live
// DashboardData -- a point-in-time snapshot, same as the blocks themselves.
// ASCII-safe, PII-free: room codes are inventory identifiers, never guest data.
import { summarizeOoo, type PropertyOoo, type PropertyDashboard, type OooRoom } from "@/lib/cloudbeds";
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

/** {ooo, other, total} for a property, or null when there's no successful read. */
function oooCounts(p: PropertyOoo): { ooo: number; other: number; total: number } | null {
  return p.configured && p.result?.ok ? summarizeOoo(p.result.data) : null;
}

/** Most frequent (trimmed) reason among a property's blocked rooms (any
 *  category); blank/"--" reasons collapse to "Unspecified" -- same
 *  convention as oooInsights. */
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
    title: "Blocked Rooms - Portfolio (Out-of-Order vs Other)",
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
  let totalOther = 0;
  let totalCapacity = 0;
  let propertiesWithBlocks = 0;
  for (const p of ooo) {
    const counts = oooCounts(p);
    if (counts === null) continue;
    totalOoo += counts.ooo;
    totalOther += counts.other;
    if (counts.total > 0) propertiesWithBlocks += 1;
    const cap = capacityByCode.get(p.property.code);
    if (cap !== undefined) totalCapacity += cap;
  }
  const totalBlocked = totalOoo + totalOther;
  const portfolioOooPct = totalCapacity > 0 ? totalOoo / totalCapacity : null;

  y = summaryTiles(doc, y, [
    { label: "Total Blocked Rooms", value: int(totalBlocked) },
    { label: "Out-of-Order", value: int(totalOoo) },
    { label: "Other Blocks", value: int(totalOther) },
    { label: "Properties With Blocks", value: int(propertiesWithBlocks) },
  ]);

  const head = ["Property", "Out-of-Order", "Other", "Total", "OOO %", "Top Reason"];
  const rows: (string | number)[][] = ooo.map((p) => {
    const counts = oooCounts(p);
    if (counts === null) {
      return [p.property.name, "n/a", "n/a", "n/a", "n/a", "n/a"];
    }
    const cap = capacityByCode.get(p.property.code);
    // OOO % is out_of_service rooms over capacity (the metric that matches the
    // dashboard's occupancy-drag reading); "Other" blocks are not physically
    // unrentable in the same way, so they're excluded from this ratio.
    const oooPct = cap && cap > 0 ? counts.ooo / cap : null;
    const reason = p.result?.ok ? topReason(p.result.data) : "-";
    return [
      p.property.name,
      int(counts.ooo),
      int(counts.other),
      int(counts.total),
      oooPct === null ? "-" : pct(oooPct),
      reason,
    ];
  });

  y = propertyTable(doc, y, head, rows, {
    shadeCol: 4,
    shadeRule: (v) => {
      const frac = v / 100;
      if (frac > RED_THRESHOLD) return RED;
      if (frac > AMBER_THRESHOLD) return AMBER;
      return null;
    },
  });

  // Per-property room detail -- only properties with at least one blocked room.
  for (const p of ooo) {
    if (!p.result?.ok || p.result.data.length === 0) continue;
    y = roomsHeading(doc, y, `${p.property.name} (${p.property.id})`);
    y = propertyTable(
      doc,
      y,
      ["Room", "Type", "Category", "Reason"],
      p.result.data.map((r) => [
        r.room || "Unknown",
        r.roomType || "-",
        r.category === "ooo" ? "OOO" : "Other",
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
