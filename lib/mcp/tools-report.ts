// The daily revenue report, as data or as the actual file.
//
// Both call buildRevenueReport, the same function /api/report-file and the
// Teams cron use, so what Rob reads in Claude Desktop is the report that was
// published — not a re-derivation of it.
//
// No guest PII to strip: RevenueReport (lib/revenue-report.ts) carries only
// property-level aggregates (occupancy, nights, revenue, ADR/RevPAR) — no
// guest name field exists on the type, verified by reading it end to end.

import { z } from "zod";
import { buildRevenueReport } from "@/lib/cloudbeds";
import { renderReportPdf } from "@/lib/report-pdf";
import { renderReportXlsx } from "@/lib/report-xlsx";
import { easternToday, shiftYmd } from "@/lib/dates";
import {
  isCountDependentRow,
  reportFileBase,
  type DerivedRow,
  type PeriodBlock,
  type PropertyActual,
} from "@/lib/revenue-report";
import { parseYmdArg, ymdArgSchema } from "./args";
import { snapshotFreshness } from "./freshness";
import type { McpToolDef } from "./types";

/**
 * Final review, Critical 1: `buildRevenueReport` was passed through wholesale,
 * so get_daily_report was the ONE rendered surface that still showed a
 * count-dependent figure (occupancy %, nights, ADR, out-of-order, available)
 * for a period whose counts don't yet cover the whole range — every other
 * surface (report-pdf.ts, report-xlsx.ts, RevenueReportView.tsx) blanks those
 * exact cells when `PeriodBlock.countsPartial` is true. Reuses
 * `isCountDependentRow` — the SAME key set those three renderers already key
 * off — rather than restating it, which is exactly the "two definitions of one
 * rule" trap this repo has been bitten by before (MEMORY.md).
 *
 * Verified live against today (2026-08-11): the daily cron only started
 * banking real per-day COUNTS around 07/21/26 (the 07/22/26 revenue backfill
 * was revenue+inventory ONLY, deliberately never touching counts — see
 * lib/db.ts upsertRevenueSnapshot and .superpowers/sdd/progress.md's
 * "REVENUE BACKFILL" entry). So `countsSince` for every property lands well
 * after YTD's Jan-1 start, and `countsPartialFor(ytdRange)` — the exact
 * predicate in getRevenueReportInputs — is true for every property's YTD
 * block today. MTD is a different story: countsSince (~07/21) is before this
 * month's start (08/01), so MTD is NOT partial right now. Both states are
 * exercised by the tests below rather than asserted from memory alone.
 *
 * LastYear is left untouched: it is a complete historical period whose counts
 * were never partial, matching what every other renderer already does.
 */
function blankPartialActual(block: PeriodBlock): PeriodBlock {
  if (block.countsPartial !== true) return block;
  const blanked: Record<string, unknown> = { ...block.actual };
  for (const key of Object.keys(block.actual) as (keyof DerivedRow)[]) {
    if (isCountDependentRow(key)) blanked[key] = null;
  }
  return { ...block, actual: blanked as unknown as DerivedRow };
}

/** One plain sentence per property/period that got blanked above, so the
 *  model can tell Rob WHY a figure is missing instead of just omitting it —
 *  spec §7's "a tool that cannot reach its source says so" applies just as
 *  much to "reached the source but the source doesn't cover this period yet". */
function partialCaveats(actual: PropertyActual[]): string[] {
  const out: string[] = [];
  for (const p of actual) {
    for (const [label, block] of [
      ["MTD", p.mtd],
      ["YTD", p.ytd],
    ] as const) {
      if (block.countsPartial === true) {
        out.push(
          `${p.name} (${p.code}) ${label}: occupancy %, room-nights, out-of-order and ADR figures are null — ` +
            `the banked count-snapshot history doesn't cover this period's full date range yet. Room revenue, ` +
            `inventory and RevPAR are unaffected and still shown.`,
        );
      }
    }
  }
  return out;
}

/** Delegates to the canonical `reportFileBase` (lib/revenue-report.ts), which
 *  already implements Monica's naming convention and already backs four call
 *  sites (report-file route, Teams cron, render-report script, report-card).
 *  A local reimplementation here would be a fifth definition of the same rule
 *  — exactly the failure mode this repo has been bitten by before: it agrees
 *  with the canonical one today and silently diverges the first time someone
 *  fixes an edge case there but not here. Just appends the extension. */
export function reportFilename(asOf: string, format: "pdf" | "xlsx"): string {
  return `${reportFileBase(asOf)}.${format}`;
}

export const REPORT_TOOLS: McpToolDef[] = [
  {
    name: "get_daily_report",
    title: "Daily revenue report (data)",
    description:
      "The daily revenue report as structured data — per-property occupancy, room revenue, ADR, out-of-order and on-the-books figures. MTD/YTD occupancy, room-nights, out-of-order and ADR figures are null (never a misleadingly-low number) for any period whose banked count-snapshot history doesn't cover the whole range yet — see the returned `caveats` array. Use this to answer questions; use get_report_file only when the actual PDF or Excel file is wanted.",
    inputSchema: z.object({
      asOf: ymdArgSchema.optional().describe("Stay date, YYYY-MM-DD. Defaults to yesterday (Eastern), which is the most recent published report."),
    }),
    handler: async (args: { asOf?: string }) => {
      const asOf = args.asOf ? parseYmdArg("asOf", args.asOf) : shiftYmd(easternToday(), -1);
      const report = await buildRevenueReport(asOf);
      const actual = (report.actual ?? []).map((p) => ({
        ...p,
        yesterday: blankPartialActual(p.yesterday),
        mtd: blankPartialActual(p.mtd),
        ytd: blankPartialActual(p.ytd),
      }));
      return {
        data: { asOf, report: { ...report, actual }, caveats: partialCaveats(actual) },
        freshness: await snapshotFreshness(),
      };
    },
  },
  {
    name: "get_report_file",
    title: "Daily revenue report (file)",
    description:
      "The daily revenue report as a PDF or Excel file, so its contents can be read directly.",
    inputSchema: z.object({
      asOf: ymdArgSchema.optional().describe("Stay date, YYYY-MM-DD. Defaults to yesterday (Eastern)."),
      format: z.enum(["pdf", "xlsx"]).default("pdf"),
    }),
    handler: async (args: { asOf?: string; format?: "pdf" | "xlsx" }) => {
      const asOf = args.asOf ? parseYmdArg("asOf", args.asOf) : shiftYmd(easternToday(), -1);
      const format = args.format ?? "pdf";
      const report = await buildRevenueReport(asOf);
      const buffer = format === "xlsx" ? await renderReportXlsx(report) : renderReportPdf(report);
      return {
        data: {
          asOf,
          filename: reportFilename(asOf, format),
          mimeType:
            format === "xlsx"
              ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              : "application/pdf",
          base64: buffer.toString("base64"),
        },
        freshness: await snapshotFreshness(),
      };
    },
  },
];
