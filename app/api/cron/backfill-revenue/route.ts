import { NextResponse } from "next/server";
import { easternToday, shiftYmd } from "@/lib/dates";
import { backfillRevenue } from "@/lib/cloudbeds";

// One-time historical REVENUE-ONLY backfill (Kyle's decision — see
// .superpowers/sdd/briefs/revenue-backfill-brief.md). Not on the vercel.json
// cron schedule — triggered manually (once, or re-run as needed; idempotent).
// Guarded by CRON_SECRET, same pattern as revenue-report/elise-sync: Vercel
// Cron (or a manual caller) sends `Authorization: Bearer <CRON_SECRET>`; if
// the env var is unset the route is open (dev). PII-free — writes only
// aggregate revenue + inventory columns to report_daily_snapshot, and NEVER
// touches the occupancy-count columns (see upsertRevenueSnapshot).
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
    const url = new URL(req.url);
    const currentYear = easternToday().slice(0, 4);
    const start = url.searchParams.get("start") ?? `${currentYear}-01-01`;
    const end = url.searchParams.get("end") ?? shiftYmd(easternToday(), -1);

    const { days, rowsWritten, properties } = await backfillRevenue(start, end);
    return NextResponse.json({ ok: true, start, end, days, rowsWritten, properties });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
