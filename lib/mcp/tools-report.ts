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
import { snapshotFreshness } from "./freshness";
import type { McpToolDef } from "./types";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Monica's naming convention (verified against the real published files in
 *  outputs/, e.g. "Occupancy Report as of August 1, 2026.pdf"): the file is
 *  named for the day AFTER the stay date, because the report is published the
 *  next morning. Keeping it identical means a file pulled here and one pulled
 *  from the dashboard are the same file by name as well as by content. */
export function reportFilename(asOf: string, format: "pdf" | "xlsx"): string {
  const published = shiftYmd(asOf, 1);
  const [y, m, d] = published.split("-");
  return `Occupancy Report as of ${MONTHS[Number(m) - 1]} ${Number(d)}, ${y}.${format}`;
}

export const REPORT_TOOLS: McpToolDef[] = [
  {
    name: "get_daily_report",
    title: "Daily revenue report (data)",
    description:
      "The daily revenue report as structured data — per-property occupancy, room revenue, ADR, out-of-order and on-the-books figures. Use this to answer questions; use get_report_file only when the actual PDF or Excel file is wanted.",
    inputSchema: z.object({
      asOf: z.string().optional().describe("Stay date, YYYY-MM-DD. Defaults to yesterday (Eastern), which is the most recent published report."),
    }),
    handler: async (args: { asOf?: string }) => {
      const asOf = args.asOf ?? shiftYmd(easternToday(), -1);
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
      asOf: z.string().optional().describe("Stay date, YYYY-MM-DD. Defaults to yesterday (Eastern)."),
      format: z.enum(["pdf", "xlsx"]).default("pdf"),
    }),
    handler: async (args: { asOf?: string; format?: "pdf" | "xlsx" }) => {
      const asOf = args.asOf ?? shiftYmd(easternToday(), -1);
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
