import { NextResponse } from "next/server";
import { getPortfolio, getPortfolioInsights } from "@/lib/cloudbeds";
import { buildOccProperties } from "@/lib/occupancy";
import { resolveRange } from "@/lib/dates";
import { renderOccupancyPdf } from "@/lib/ops-pdf-occupancy";

// Gated automatically -- this path is under /ops, which middleware.ts protects
// like the rest of the ops dashboard (no separate PIN check needed here).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const { start, end } = resolveRange(
    url.searchParams.get("preset") ?? "last30",
    url.searchParams.get("start") ?? undefined,
    url.searchParams.get("end") ?? undefined,
  );

  const [portfolio, insights] = await Promise.all([getPortfolio(), getPortfolioInsights(start, end)]);
  const properties = buildOccProperties(portfolio, insights);
  const buf = renderOccupancyPdf(properties, insights, { start, end });

  const mmddyy = `${end.slice(5, 7)}${end.slice(8, 10)}${end.slice(2, 4)}`;
  return new NextResponse(buf as any, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="OccupancyReport_Stayable_${mmddyy}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
