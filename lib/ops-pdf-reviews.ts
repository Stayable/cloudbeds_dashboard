// Renderer for the Reviews category PDF (`/ops/reviews.pdf`). Consumes the
// SAME ReviewsView the on-screen /ops "1-Star Reviews" section renders (via
// lib/reviews.ts's buildReviewsView), so the PDF's counts always match the
// dashboard. Source is Smartsheet (lib/smartsheet.ts getOneStarReviews) --
// degrades to a valid "not connected" PDF when no token is configured or the
// fetch failed, rather than throwing. PII-free: only feedback text, source,
// and manager response are rendered -- the Reviewer Name column is never read
// (lib/smartsheet.ts) or rendered here. ASCII-safe.
import type { ReviewsView } from "@/lib/reviews";
import { reviewsInsights } from "@/lib/ops-insights";
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

const AMBER: [number, number, number] = [252, 232, 196];
const RED: [number, number, number] = [248, 214, 214];
const AMBER_THRESHOLD = 3; // 1-star count >= this shades amber
const RED_THRESHOLD = 5; // 1-star count >= this shades red

const MARGIN = 24;
const PAGE_BOTTOM_GUARD = 40;

const FEEDBACK_MAX = 90;
const SOURCE_MAX = 24;
const RESPONSE_MAX = 80;

/** Trim to `max` chars with an ellipsis; blank input renders as "-" so the
 *  detail table never shows an empty cell (e.g. no manager response yet). */
function truncate(s: string, max: number): string {
  const t = (s ?? "").trim();
  if (t.length === 0) return "-";
  return t.length <= max ? t : `${t.slice(0, max - 3)}...`;
}

function trend(total: number, priorTotal: number): string {
  if (total > priorTotal) return "up";
  if (total < priorTotal) return "down";
  return "flat";
}

export function renderReviewsPdf(
  view: ReviewsView,
  opts: { configured: boolean; error: string | null },
): Buffer {
  const doc = newOpsDoc();
  const subtitle = `${view.from} to ${view.to} - Smartsheet - vs prior ${view.priorFrom} to ${view.priorTo}`;

  let y = pageHeader(doc, {
    title: "1-Star Reviews - Portfolio",
    subtitle,
    asOf: view.to,
  });

  if (!opts.configured || opts.error) {
    const msg = opts.error
      ? `Reviews source not connected: ${opts.error}`
      : "Reviews source not connected -- no Smartsheet token configured.";
    y = insightsBlock(doc, y, [msg]);
    opsFooter(
      doc,
      `Smartsheet-sourced - no reviewer names (PII-free) - window ${view.from} to ${view.to}.`,
    );
    return finishPdf(doc);
  }

  y = summaryTiles(doc, y, [
    { label: "Total 1-Star Reviews", value: int(view.total) },
    {
      label: "Manager Responded",
      value:
        view.total > 0
          ? `${int(view.responded)} (${pct(view.responded / view.total)})`
          : int(view.responded),
    },
    {
      label: "Prior Window Total",
      value: `${int(view.priorTotal)} (${trend(view.total, view.priorTotal)})`,
    },
  ]);

  const head = ["Property", "1-Star", "Responded", "Prior", "Delta"];
  const rows: (string | number)[][] = view.byProperty.map((p) => {
    const delta = p.count - p.priorCount;
    const deltaStr = delta > 0 ? `+${delta}` : `${delta}`;
    return [p.property, int(p.count), int(p.responded), int(p.priorCount), deltaStr];
  });
  y = propertyTable(doc, y, head, rows, {
    shadeCol: 1,
    shadeRule: (v) => {
      if (v >= RED_THRESHOLD) return RED;
      if (v >= AMBER_THRESHOLD) return AMBER;
      return null;
    },
  });

  // Per-property review detail -- only properties with at least one review in
  // the window. PII-free: feedback / source / manager response only, never a
  // reviewer name column (the Smartsheet read is column-restricted upstream).
  for (const p of view.byProperty) {
    if (p.reviews.length === 0) continue;
    y = detailHeading(doc, y, p.property);
    y = propertyTable(
      doc,
      y,
      ["Feedback", "Source", "Manager Response"],
      p.reviews.map((r) => [
        truncate(r.review, FEEDBACK_MAX),
        truncate(r.source, SOURCE_MAX),
        truncate(r.managerResponse, RESPONSE_MAX),
      ]),
    );
  }

  y = insightsBlock(doc, y, reviewsInsights(view));
  opsFooter(
    doc,
    `Smartsheet-sourced - no reviewer names (PII-free) - window ${view.from} to ${view.to}.`,
  );

  return finishPdf(doc);
}

/** Small property-name heading above a per-property review-detail table.
 *  Pages first if it (plus a little breathing room) would overflow the
 *  current page, so the heading never gets stranded separate from its table
 *  (mirrors lib/ops-pdf-ooo.ts's roomsHeading). */
function detailHeading(doc: import("jspdf").jsPDF, y: number, label: string): number {
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
