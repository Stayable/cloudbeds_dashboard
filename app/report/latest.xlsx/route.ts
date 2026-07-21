import { NextResponse } from "next/server";
import { buildRevenueReport } from "@/lib/cloudbeds";
import { renderReportXlsx } from "@/lib/report-xlsx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const report = await buildRevenueReport();
  const buf = await renderReportXlsx(report);
  const mmddyy = `${report.asOf.slice(5, 7)}${report.asOf.slice(8, 10)}${report.asOf.slice(2, 4)}`;
  return new NextResponse(buf as any, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="OccupancyRevenueReport_Stayable_${mmddyy}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
