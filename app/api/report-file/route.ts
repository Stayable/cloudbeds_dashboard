import { NextResponse } from "next/server";
import { buildRevenueReport } from "@/lib/cloudbeds";
import { renderReportPdf } from "@/lib/report-pdf";
import { renderReportXlsx } from "@/lib/report-xlsx";
import { reportFileBase } from "@/lib/revenue-report";
import { gateEnabled, verifyFileToken } from "@/lib/auth";

// Token-authenticated download of the daily report, so the Teams card's file
// buttons work for everyone in the Revenue chat. `/report/latest.pdf|.xlsx` sit
// behind the MAIN pin (middleware.ts) — which meant a login wall for Monica's
// audience, and the only alternative was distributing the pin, i.e. handing the
// whole gated dashboard to the chat.
//
// Excluded from the middleware matcher; it checks its own token inline, the
// same pattern as /api/feedback and /api/crystal-note.
//
// PII-free: this is the same aggregate-only report as /report (CLAUDE.md §5).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const fmt = url.searchParams.get("fmt") === "xlsx" ? "xlsx" : "pdf";

  // The stay date the card was posted for. Without it this route rendered
  // whatever was latest at CLICK time, so yesterday's card and today's card
  // downloaded the identical file (reported by Monica, 08/07/26). It is signed
  // into the token, so it cannot be edited to fish for another date; a card
  // posted before the fix carries no asOf and still renders latest.
  const rawAsOf = url.searchParams.get("asOf");
  const asOf = rawAsOf && /^\d{4}-\d{2}-\d{2}$/.test(rawAsOf) ? rawAsOf : null;
  if (rawAsOf && !asOf) {
    return NextResponse.json({ ok: false, error: "bad asOf" }, { status: 400 });
  }

  // gateEnabled() false = no signing secret configured (local dev), in which
  // case the whole app is ungated anyway and demanding a token here would only
  // break dev.
  if (gateEnabled() && !(await verifyFileToken(url.searchParams.get("t"), asOf))) {
    return NextResponse.json({ ok: false, error: "invalid or expired link" }, { status: 403 });
  }

  const report = await buildRevenueReport(asOf ?? undefined);
  // Named the way Monica names hers, so a file saved from the chat matches the
  // one she used to post by hand.
  const name = `${reportFileBase(report.asOf)}.${fmt}`;
  const body =
    fmt === "xlsx" ? ((await renderReportXlsx(report)) as unknown as BodyInit) : (renderReportPdf(report) as unknown as BodyInit);

  return new NextResponse(body, {
    headers: {
      "Content-Type":
        fmt === "xlsx"
          ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          : "application/pdf",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
