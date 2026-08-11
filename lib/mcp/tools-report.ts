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
import { reportFileBase } from "@/lib/revenue-report";
import { parseYmdArg, ymdArgSchema } from "./args";
import { snapshotFreshness } from "./freshness";
import type { McpToolDef } from "./types";

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
      "The daily revenue report as structured data — per-property occupancy, room revenue, ADR, out-of-order and on-the-books figures. Use this to answer questions; use get_report_file only when the actual PDF or Excel file is wanted.",
    inputSchema: z.object({
      asOf: ymdArgSchema.optional().describe("Stay date, YYYY-MM-DD. Defaults to yesterday (Eastern), which is the most recent published report."),
    }),
    handler: async (args: { asOf?: string }) => {
      const asOf = args.asOf ? parseYmdArg("asOf", args.asOf) : shiftYmd(easternToday(), -1);
      const report = await buildRevenueReport(asOf);
      return { data: { asOf, report }, freshness: await snapshotFreshness() };
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
