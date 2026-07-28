import { NextResponse } from "next/server";
import { easternToday, shiftYmd } from "@/lib/dates";
import { restateSnapshots } from "@/lib/cloudbeds";
import { finalizeClosedMonths, getRestatements } from "@/lib/db";

// Nightly RESTATEMENT pass (Vercel Cron; see vercel.json — runs after the
// report cron so the flash for yesterday is already banked).
//
// WHY (07/28/26, from the parity analysis against Monica's 7/24-7/27 reports):
// our snapshots were frozen at the 06:00 ET capture and never revisited, but the
// Cloudbeds room-revenue ledger keeps posting for days afterwards. Re-querying
// Davenport 7/25 raised transient revenue 48% — from our frozen $468.90 to
// $693.93, which is precisely the figure Monica published — while 7/24 moved
// DOWN 1.7%. So a frozen number is not a more accurate number; it is just an
// earlier one. This pass re-derives the trailing window every night, then
// permanently freezes any month that closed more than the grace period ago so
// history stops moving once it is reported.
//
// Safe to re-run and safe to run manually. Rows with `is_final = true` are never
// touched; days a property wasn't in service are skipped entirely.
//   GET /api/cron/restate?days=31&grace=5
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
    // 31 days covers "everything in the current month plus the tail of the
    // previous one", which is the window the ledger actually still moves in.
    const days = Math.max(1, Math.min(120, Number(url.searchParams.get("days") ?? 31)));
    const grace = Math.max(0, Math.min(60, Number(url.searchParams.get("grace") ?? 5)));
    const today = easternToday();
    const end = shiftYmd(today, -1);
    const start = shiftYmd(end, -(days - 1));

    const result = await restateSnapshots(start, end);
    const finalized = await finalizeClosedMonths(today, grace);
    // What actually moved since first publication, largest first — the honest
    // answer to "why doesn't this match the number I saw yesterday?".
    const moved = await getRestatements(start, end);
    const netDelta = moved.reduce((sum, m) => sum + m.delta, 0);

    return NextResponse.json({
      ok: true,
      window: { start, end, days },
      ...result,
      finalizedRows: finalized,
      graceDays: grace,
      daysMoved: moved.length,
      netRoomRevDelta: Number(netDelta.toFixed(2)),
      topMoves: moved.slice(0, 20),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
