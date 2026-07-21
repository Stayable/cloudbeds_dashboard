import { NextResponse } from "next/server";
import { easternToday, shiftYmd } from "@/lib/dates";
import { persistDailySnapshots, buildRevenueReport } from "@/lib/cloudbeds";
import { buildReportCard } from "@/lib/report-card";
import { postAdaptiveCard } from "@/lib/teams";

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
    const posted = await postAdaptiveCard(buildReportCard(report, base));
    return NextResponse.json({
      ok: posted.ok,
      status: posted.status,
      asOf,
      properties: report.actual.length,
      snapshotsWritten: written,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
