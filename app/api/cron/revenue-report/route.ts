import { NextResponse } from "next/server";
import { easternMinutesNow, easternToday, shiftYmd } from "@/lib/dates";
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
  // DELIVERY WINDOW (Kyle, 08/03/26): the report must reflect the 10:00 ET state
  // of Cloudbeds and land between 10:30 and 11:00 ET. Vercel Cron is fixed UTC,
  // so one entry drifts an hour across the DST boundary — wider than the window
  // itself. Two entries are scheduled an hour apart (vercel.json) and this guard
  // lets exactly one of them through:
  //     14:30 UTC = 10:30 EDT (runs, summer) / 09:30 EST (skipped)
  //     15:30 UTC = 11:30 EDT (skipped)      / 10:30 EST (runs, winter)
  // `?force=1` bypasses it for manual runs.
  const url = new URL(req.url);

  // `?asOf=YYYY-MM-DD` posts the report for a PAST stay date — the Monday
  // catch-up Monica used to do by hand (one file per missed day). It implies a
  // manual run, so it bypasses the delivery window, and it deliberately does
  // NOT re-bank snapshots: a catch-up post should read history, not rewrite it.
  const asOfParam = url.searchParams.get("asOf");
  const yesterday = shiftYmd(easternToday(), -1);
  if (asOfParam !== null) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfParam)) {
      return NextResponse.json({ ok: false, error: "asOf must be YYYY-MM-DD" }, { status: 400 });
    }
    if (asOfParam > yesterday) {
      // A future or same-day stay date has no settled figures to report.
      return NextResponse.json(
        { ok: false, error: `asOf must be ${yesterday} or earlier` },
        { status: 400 },
      );
    }
  }

  const minutes = easternMinutesNow();
  const inWindow = minutes >= 10 * 60 + 15 && minutes <= 11 * 60;
  if (!inWindow && asOfParam === null && url.searchParams.get("force") !== "1") {
    // 200, not an error: skipping is the correct outcome for the off-DST twin.
    // Explicitly labelled so it can never be mistaken for a delivered report —
    // that ambiguity is what hid the unset-TEAMS_FLOW_URL bug for two weeks.
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: `outside the 10:15-11:00 ET delivery window (now ${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")} ET)`,
      posted: false,
    });
  }

  try {
    const asOf = asOfParam ?? yesterday;
    // Persist BEFORE building the report: future runs' MTD/YTD read
    // stored[..asOf-1] + a live "today" fetch, so this order never double-counts.
    // Skipped for a dated catch-up — see the asOf note above.
    const { written } = asOfParam ? { written: 0 } : await persistDailySnapshots(asOf);
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
    //
    // Bound to THIS report's stay date, so the link keeps serving this day's
    // file for its whole 30-day life instead of following "latest" forward.
    // `report.asOf` rather than the `asOf` query param, so a ?asOf= catch-up
    // post is pinned to the day it actually rendered.
    const fileToken = await signFileToken(report.asOf);

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

    // A post that silently no-ops is the worst failure mode this route has:
    // snapshots bank, the response reads 200, and nobody in the Revenue chat
    // gets a report. That is exactly what happened from 07/22 to 08/03 with
    // TEAMS_FLOW_URL unset. Fail the invocation so Vercel marks the cron run
    // failed and it is visible without reading the body. (Vercel Cron does not
    // auto-retry, so a 500 costs nothing beyond the alert.) The snapshot work
    // above has already committed and is reported either way.
    return NextResponse.json({
      ok: posted.ok,
      status: posted.status,
      teamsFailure: posted.reason,
      teamsDetail: posted.detail,
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
    }, { status: posted.ok ? 200 : 500 });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
