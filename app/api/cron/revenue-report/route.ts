import { NextResponse } from "next/server";
import { easternToday, shiftYmd } from "@/lib/dates";
import { persistDailySnapshots, buildRevenueReport } from "@/lib/cloudbeds";
import { findAvailabilityAnomalies, findSnapshotGaps } from "@/lib/db";
import { PROPERTIES } from "@/config/properties";
import { buildReportCard } from "@/lib/report-card";
import { renderReportPdf } from "@/lib/report-pdf";
import { reportFileBase } from "@/lib/revenue-report";
import { attachmentsEnabled, postAdaptiveCard, type TeamsAttachment } from "@/lib/teams";
import { signFileToken } from "@/lib/auth";

// Daily occupancy/revenue report cron (Vercel Cron; see vercel.json). Banks
// yesterday's exact snapshot (so future MTD/YTD accumulate), builds the
// report, and posts the Adaptive Card to Teams. Guarded by CRON_SECRET: Vercel
// Cron sends `Authorization: Bearer <CRON_SECRET>` automatically when the env
// var is set; if it's unset the route is open (dev). PII-free — aggregates
// only (CLAUDE.md §5).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }
  try {
    const asOf = shiftYmd(easternToday(), -1);
    // Persist BEFORE building the report: future runs' MTD/YTD read
    // stored[..asOf-1] + a live "today" fetch, so this order never double-counts.
    const { written } = await persistDailySnapshots(asOf);
    const report = await buildRevenueReport(asOf);
    const base = process.env.PUBLIC_BASE_URL || "https://dashboard.rentstayable.com";

    // Attachment: the PDF only (Kyle, 07/29/26 — that is what Monica posts; the
    // .xlsx is her working model, not her post). Named exactly the way she names
    // hers ("Occupancy Report as of July 27, 2026.pdf"), so the channel's file
    // history stays continuous when this takes over. The .xlsx stays available
    // on /report/latest.xlsx. Only rendered when the flow is ready for it —
    // see lib/teams.ts.
    const files: TeamsAttachment[] = [];
    if (attachmentsEnabled()) {
      const pdf = renderReportPdf(report);
      files.push({
        name: `${reportFileBase(report.asOf)}.pdf`,
        contentBase64: pdf.toString("base64"),
      });
    }

    // Signed download link for the card's file buttons. Without it those
    // buttons hit the MAIN-pin login wall for anyone in the Revenue chat —
    // and that is true of the Excel button even when the PDF is attached.
    const fileToken = await signFileToken();

    const posted = await postAdaptiveCard(
      buildReportCard(report, base, { pdfAttached: files.length > 0, fileToken }),
      files,
    );

    // Self-monitor: our store is the source of truth, so surface any missing
    // daily snapshots over the last 14 days (a cron miss / expired key / DB blip)
    // in the response — visible in Vercel cron logs the next morning.
    const codes = PROPERTIES.filter((p) => p.active === true).map((p) => p.code);
    const [gaps, availability] = await Promise.all([
      findSnapshotGaps(shiftYmd(asOf, -13), asOf, codes),
      findAvailabilityAnomalies(shiftYmd(asOf, -13), asOf),
    ]);

    return NextResponse.json({
      ok: posted.ok,
      status: posted.status,
      attached: posted.attached,
      attachmentNames: files.map((f) => f.name),
      asOf,
      properties: report.actual.length,
      snapshotsWritten: written,
      gapsLast14d: gaps.length,
      gaps: gaps.slice(0, 50),
      // A banked-but-wrong day is as bad as a missing one — see
      // findAvailabilityAnomalies.
      availabilityAlerts: availability.map((a) => ({
        ...a,
        avgAvailablePct: Number((a.avgAvailablePct * 100).toFixed(1)),
      })),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
