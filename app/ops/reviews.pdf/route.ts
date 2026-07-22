import { NextResponse } from "next/server";
import { getOneStarReviews } from "@/lib/smartsheet";
import { getSetting } from "@/lib/db";
import { buildReviewsView } from "@/lib/reviews";
import { easternToday, shiftYmd } from "@/lib/dates";
import { renderReviewsPdf } from "@/lib/ops-pdf-reviews";

// Gated automatically -- this path is under /ops, which middleware.ts protects
// like the rest of the ops dashboard (no separate PIN check needed here).
// Source is Smartsheet, so a full render needs SMARTSHEET_API_TOKEN (prod
// only) -- renderReviewsPdf degrades to a valid "not connected" PDF otherwise.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const asOf = easternToday();
  const [reviewsPayload, savedWindow] = await Promise.all([
    getOneStarReviews(),
    getSetting("ops_reviews_window"),
  ]);

  // Locked date window from Neon (shared with the on-screen section); default
  // to the last 30 days (Eastern) until a window is explicitly saved --
  // EXACTLY mirrors app/ops/page.tsx.
  let reviewWindow = { from: shiftYmd(asOf, -29), to: asOf };
  if (savedWindow) {
    try {
      const parsed = JSON.parse(savedWindow) as { from?: string; to?: string };
      if (parsed.from && parsed.to) reviewWindow = { from: parsed.from, to: parsed.to };
    } catch {
      /* fall back to the default window */
    }
  }

  const view = buildReviewsView(reviewsPayload.reviews, reviewWindow.from, reviewWindow.to);
  const buf = renderReviewsPdf(view, {
    configured: reviewsPayload.configured,
    error: reviewsPayload.error,
  });

  const mmddyy = `${reviewWindow.to.slice(5, 7)}${reviewWindow.to.slice(8, 10)}${reviewWindow.to.slice(2, 4)}`;
  return new NextResponse(buf as any, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="OneStarReviews_Stayable_${mmddyy}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
