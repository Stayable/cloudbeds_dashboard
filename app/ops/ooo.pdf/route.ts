import { NextResponse } from "next/server";
import { getPortfolio, getPortfolioOoo } from "@/lib/cloudbeds";
import { easternToday } from "@/lib/dates";
import { renderOooPdf } from "@/lib/ops-pdf-ooo";

// Gated automatically -- this path is under /ops, which middleware.ts protects
// like the rest of the ops dashboard (no separate PIN check needed here).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const asOf = easternToday();
  const [portfolio, ooo] = await Promise.all([getPortfolio(), getPortfolioOoo(asOf)]);
  const buf = renderOooPdf(ooo, portfolio, asOf);

  const mmddyy = `${asOf.slice(5, 7)}${asOf.slice(8, 10)}${asOf.slice(2, 4)}`;
  return new NextResponse(buf as any, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="OOOReport_Stayable_${mmddyy}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
