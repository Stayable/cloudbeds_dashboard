// Renderer for the Leasing category PDF (`/ops/leasing.pdf`). Consumes the SAME
// LeasingView[] the on-screen /ops Leasing section renders (via lib/leasing.ts's
// buildLeasingViews), so the PDF's funnel/conversion numbers always match the
// dashboard. Source data is Neon (EliseAI Snowflake-share rollups) -- PII-free,
// aggregate counts only. Renders all properties even locally (Neon-backed, not
// Cloudbeds-backed). ASCII-safe.
import type { LeasingView } from "@/lib/leasing";
import { leasingInsights } from "@/lib/ops-insights";
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

/** Percent field (already 0-100, null-able) -> "xx.x%" or "-". */
function ratePct(v: number | null): string {
  return v === null ? "-" : pct(v / 100);
}

function stageN(v: LeasingView, key: string): number {
  return v.stages.find((s) => s.key === key)?.n ?? 0;
}

export function renderLeasingPdf(
  views: LeasingView[],
  configured: boolean,
  range: { start: string; end: string },
): Buffer {
  const doc = newOpsDoc();
  const rangeLabel = range.start === range.end ? range.start : `${range.start} to ${range.end}`;

  let y = pageHeader(doc, {
    title: "Leasing Funnel - Portfolio",
    subtitle: `${rangeLabel} - EliseAI (Snowflake share) - Eastern`,
    asOf: range.end,
  });

  if (!configured || views.length === 0) {
    y = insightsBlock(doc, y, ["Leasing data not connected -- the nightly EliseAI sync has not populated the funnel yet."]);
    opsFooter(
      doc,
      "EliseAI Snowflake data share - aggregate/PII-free - refreshed nightly - counts are raw events (no de-dup).",
    );
    return finishPdf(doc);
  }

  const all = views.find((v) => v.key === "ALL");
  const perProperty = views
    .filter((v) => v.key !== "ALL")
    .sort((a, b) => stageN(b, "prospect") - stageN(a, "prospect"));

  y = summaryTiles(doc, y, [
    { label: "Leads", value: int(all ? stageN(all, "prospect") : 0) },
    { label: "Tours Booked", value: int(all ? stageN(all, "tour_booked") : 0) },
    { label: "Leased", value: int(all ? stageN(all, "lease_completed") : 0) },
    { label: "Lead -> Lease %", value: ratePct(all?.leadToLease ?? null) },
  ]);

  const head = [
    "Property",
    "Leads",
    "Engaged",
    "Tours bkd",
    "Tours att",
    "Apps started",
    "Apps appr",
    "Leased",
    "Cancelled",
    "Lead->Lease %",
  ];
  const rows: (string | number)[][] = perProperty.map((v) => [
    v.label,
    int(stageN(v, "prospect")),
    int(stageN(v, "prospect_engaged")),
    int(stageN(v, "tour_booked")),
    int(stageN(v, "tour_attended")),
    int(stageN(v, "application_started")),
    int(stageN(v, "application_approved")),
    int(stageN(v, "lease_completed")),
    int(v.cancelled),
    ratePct(v.leadToLease),
  ]);
  y = propertyTable(doc, y, head, rows);

  // Current pipeline: portfolio-level status -> count, aggregated across
  // properties (ALL view already carries the summed pipeline).
  const pipeline = (all?.pipeline ?? aggregatePipeline(perProperty)).slice().sort((a, b) => b.n - a.n);
  if (pipeline.length > 0) {
    y = propertyTable(
      doc,
      y,
      ["Status", "Count"],
      pipeline.map((p) => [p.status, int(p.n)]),
    );
  }

  y = insightsBlock(doc, y, leasingInsights(views));
  opsFooter(
    doc,
    "EliseAI Snowflake data share - aggregate/PII-free - refreshed nightly - counts are raw events (no de-dup).",
  );

  return finishPdf(doc);
}

/** Fallback: sum per-property pipelines when there's no ALL view (shouldn't
 *  normally happen -- buildLeasingViews always returns an ALL view when there
 *  is any data -- but keeps this renderer defensive against partial input). */
function aggregatePipeline(perProperty: LeasingView[]): { status: string; n: number }[] {
  const totals = new Map<string, number>();
  for (const v of perProperty) {
    for (const p of v.pipeline) totals.set(p.status, (totals.get(p.status) ?? 0) + p.n);
  }
  return [...totals.entries()].map(([status, n]) => ({ status, n }));
}
