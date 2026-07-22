import { NextResponse } from "next/server";
import { getEliseFunnel, getElisePipeline, eliseFunnelConfigured } from "@/lib/db";
import { buildLeasingViews } from "@/lib/leasing";
import { resolveRange } from "@/lib/dates";
import { renderLeasingPdf } from "@/lib/ops-pdf-leasing";

// Gated automatically -- this path is under /ops, which middleware.ts protects
// like the rest of the ops dashboard (no separate PIN check needed here). Data
// source is Neon (EliseAI Snowflake-share rollups), so this renders all
// properties even locally.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const { start, end } = resolveRange(
    url.searchParams.get("preset") ?? "last30",
    url.searchParams.get("start") ?? undefined,
    url.searchParams.get("end") ?? undefined,
  );

  const [eliseFunnel, elisePipeline, configured] = await Promise.all([
    getEliseFunnel(start, end),
    getElisePipeline(),
    eliseFunnelConfigured(),
  ]);
  const views = buildLeasingViews(eliseFunnel, elisePipeline);
  const buf = renderLeasingPdf(views, configured, { start, end });

  const mmddyy = `${end.slice(5, 7)}${end.slice(8, 10)}${end.slice(2, 4)}`;
  return new NextResponse(buf as any, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="LeasingReport_Stayable_${mmddyy}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
