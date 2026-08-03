// Microsoft Teams Adaptive Card builder for the daily occupancy/revenue
// report. Pure function -- consumes only the RevenueReport model + a base
// URL, no network/fs. The output is POSTed as-is to a Power Automate flow
// whose "Post card" step requires a full Adaptive Card v1.4 object at the
// top level (verified live 2026-07-22 -- anything else 400s). It also 400s
// on non-ASCII bytes, so every string built here must be ASCII-safe.
import { PROPERTIES } from "../config/properties";
import { REPORT_NOTES, reportFileBase, reportGreeting } from "./revenue-report";
import type { RevenueReport, PropertyActual, DerivedRow } from "./revenue-report";

/** The base-level PIN, stated in the card so "Open the dashboard" is not a dead
 *  end for the Revenue chat. Deliberately the LABEL, not a secret read from
 *  env: the value belongs in the message, and sourcing it from
 *  `process.env.DASHBOARD_PIN` would put the live secret one refactor away from
 *  any other caller of this builder. If the PIN changes, change it here. */
const DASHBOARD_PIN_HINT = "MAIN";

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

/** Same weighting, over the LAST-YEAR rows. Returns null unless EVERY
 *  aggregate-eligible property has a last-year row: a partial set would weight
 *  this year's full portfolio against a subset of last year's and read as a
 *  swing that never happened. */
function weightedOccLastYear(
  actual: PropertyActual[],
  pick: (p: PropertyActual) => { lastYear: DerivedRow | null },
): number | null {
  let occupied = 0;
  let inventory = 0;
  for (const p of actual) {
    if (excludeFromAggregate(p.code)) continue;
    const row = pick(p).lastYear;
    if (!row) return null;
    occupied += row.occupied;
    inventory += row.inventory;
  }
  return inventory ? occupied / inventory : null;
}

/** Last-year room revenue on the same scope, null unless every eligible
 *  property has a last-year row (see weightedOccLastYear). */
function sumRoomRevLastYear(
  actual: PropertyActual[],
  pick: (p: PropertyActual) => { lastYear: DerivedRow | null },
): number | null {
  let total = 0;
  for (const p of actual) {
    if (excludeFromAggregate(p.code)) continue;
    const row = pick(p).lastYear;
    if (!row) return null;
    total += row.roomRev;
  }
  return total;
}

const signed = (n: number, fmt: (v: number) => string) => (n >= 0 ? "+" : "-") + fmt(Math.abs(n));

/** "82.4% (LY 71.2%, +11.2 pts)" — occupancy variance in POINTS, not percent of
 *  a percent, which is the usual way this gets misread. */
function occWithLastYear(now: number, lastYear: number | null): string {
  if (lastYear == null) return pct(now);
  return `${pct(now)} (LY ${pct(lastYear)}, ${signed((now - lastYear) * 100, (v) => v.toFixed(1))} pts)`;
}

/** "$29,713.84 (LY $27,001.11, +10.0%)" — revenue variance as a percentage
 *  change, guarded against a zero last-year base. */
function moneyWithLastYear(now: number, lastYear: number | null): string {
  if (lastYear == null) return money(now);
  const change = lastYear === 0 ? null : (now - lastYear) / lastYear;
  const delta = change == null ? signed(now - lastYear, money) : signed(change * 100, (v) => v.toFixed(1) + "%");
  return `${money(now)} (LY ${money(lastYear)}, ${delta})`;
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
export function buildReportCard(
  report: RevenueReport,
  baseUrl: string,
  opts: {
    /** True when the report PDF ships as a real channel attachment, in which
     *  case the "Download PDF" button is redundant and is dropped. It pointed
     *  at /report/latest.pdf, which middleware.ts gates behind the MAIN pin —
     *  a login wall rather than a download for anyone in the chat without it.
     *  "Download Excel" stays: the .xlsx is deliberately NOT attached (Monica
     *  posts only the PDF), so that link is its only route. */
    pdfAttached?: boolean;
    /** Bearer token from `signFileToken()`. When present the file buttons point
     *  at the self-checking /api/report-file route instead of the pin-gated
     *  /report/latest.*, so everyone in the Revenue chat can open them without
     *  the MAIN pin. Note this matters even when `pdfAttached` is true: the
     *  Excel button survives attachment and is gated just the same. Omitted =
     *  today's gated URLs, which keeps local/dev behaviour unchanged. */
    fileToken?: string;
  } = {}
): object {
  const portfolioOccYesterday = weightedOcc(report.actual, (p) => p.yesterday.actual);
  const roomRevYesterday = sumRoomRev(report.actual, (p) => p.yesterday.actual);
  const roomRevMtd = sumRoomRev(report.actual, (p) => p.mtd.actual);
  const mtdPartial = mtdCountsPartial(report.actual);

  // Freshness warning. A card that lands on a morning when the cron failed
  // otherwise reads as a genuinely quiet night, so say it in the card itself
  // rather than expecting anyone to open the dashboard to find out.
  const stale =
    report.freshness?.latestCapturedDate != null &&
    report.freshness.latestCapturedDate < report.asOf;

  // Portfolio MTD occupancy % is only meaningful once every aggregate-eligible
  // property's MTD counts are a complete period — otherwise it blends real
  // counts with ~1-day counts into a garbage figure. Omit the fact entirely
  // when partial; Room Revenue (MTD) is unaffected and always shown.
  const facts: { title: string; value: string }[] = [
    {
      title: "Portfolio Occupancy (Yesterday)",
      value: occWithLastYear(
        portfolioOccYesterday,
        weightedOccLastYear(report.actual, (p) => p.yesterday),
      ),
    },
  ];
  if (!mtdPartial) {
    const portfolioOccMtd = weightedOcc(report.actual, (p) => p.mtd.actual);
    facts.push({
      title: "Portfolio Occupancy (MTD)",
      value: occWithLastYear(portfolioOccMtd, weightedOccLastYear(report.actual, (p) => p.mtd)),
    });
  }
  facts.push(
    {
      title: "Room Revenue (Yesterday)",
      value: moneyWithLastYear(
        roomRevYesterday,
        sumRoomRevLastYear(report.actual, (p) => p.yesterday),
      ),
    },
    {
      title: "Room Revenue (MTD)",
      value: moneyWithLastYear(roomRevMtd, sumRoomRevLastYear(report.actual, (p) => p.mtd)),
    },
  );

  const body: unknown[] = [
    {
      // Her post's title, so the daily message reads the way the team is used to.
      type: "TextBlock",
      text: reportFileBase(report.asOf),
      weight: "Bolder",
      size: "Large",
      wrap: true,
    },
    {
      type: "TextBlock",
      text: reportGreeting(report.asOf),
      wrap: true,
    },
    {
      type: "TextBlock",
      text: `Data through ${report.asOf}. Generated ${report.generatedEastern}.`,
      isSubtle: true,
      wrap: true,
      size: "Small",
    },
    ...(stale
      ? [
          {
            type: "TextBlock",
            text:
              `WARNING: figures may be stale - the last captured day is ` +
              `${report.freshness?.latestCapturedDate}, but this report is for ${report.asOf}.`,
            color: "Warning",
            weight: "Bolder",
            wrap: true,
          },
        ]
      : []),
    {
      type: "FactSet",
      facts,
    },
    // No per-property breakdown and no source/methodology footer: Kyle 07/29/26,
    // both made the message too crowded to read, and the point is to automate
    // Monica's post, which carries neither. The per-property detail is in the
    // attached PDF (page per pair of properties) and on the dashboard; the
    // methodology is on the PDF's own methodology pages.
    // Her Sources / Notes / Legend, verbatim except the one Yardi line that does
    // not describe how these figures are produced (see REPORT_NOTES). Shared
    // with the PDF's notes page so the message and the file cannot disagree.
    ...REPORT_NOTES.flatMap((sec) => [
      {
        type: "TextBlock",
        text: `${sec.heading}:`,
        weight: "Bolder",
        wrap: true,
        spacing: "Medium",
      },
      {
        type: "TextBlock",
        text: sec.points.map((p) => `- ${p}`).join("\n"),
        wrap: true,
        size: "Small",
        spacing: "None",
      },
    ]),
    // The two file buttons are token-authenticated and need no PIN, but "Open
    // the dashboard" is deliberately still gated — so the PIN has to be stated
    // somewhere or that button is a dead end for most of the chat
    // (Kyle, 08/03/26).
    {
      type: "TextBlock",
      text: `Dashboard PIN: ${DASHBOARD_PIN_HINT}. The report files above need no PIN.`,
      wrap: true,
      size: "Small",
      isSubtle: true,
      spacing: "Medium",
    },
  ];

  // Until the flow attaches the real file, the PDF button IS the attachment
  // (Kyle 07/29/26), so it leads. Both file links are gated behind the MAIN pin
  // by middleware.ts — anyone in the chat without that pin gets a login wall.
  const fileUrl = (fmt: "pdf" | "xlsx") =>
    opts.fileToken
      ? `${baseUrl}/api/report-file?fmt=${fmt}&t=${encodeURIComponent(opts.fileToken)}`
      : `${baseUrl}/report/latest.${fmt}`;

  const actions: object[] = [];
  if (!opts.pdfAttached) {
    actions.push({
      type: "Action.OpenUrl",
      title: `${reportFileBase(report.asOf)} (PDF)`,
      url: fileUrl("pdf"),
    });
  }
  actions.push(
    { type: "Action.OpenUrl", title: "Same report in Excel", url: fileUrl("xlsx") },
    // Deliberately NOT tokenised — the dashboard itself stays behind the pin.
    { type: "Action.OpenUrl", title: "Open the dashboard", url: `${baseUrl}/report` },
  );

  return {
    type: "AdaptiveCard",
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    version: "1.4",
    body,
    actions,
  };
}
