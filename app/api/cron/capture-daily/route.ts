import { NextResponse } from "next/server";
import { DAILY_CAPTURE_ET_HOUR, easternMinutesNow, easternToday, shiftYmd } from "@/lib/dates";
import { persistDailySnapshots } from "@/lib/cloudbeds";

// 06:00 ET daily capture (Vercel Cron; see vercel.json). Banks yesterday's
// exact occupancy/revenue snapshot — the same job revenue-report used to do
// at 10:30 ET as a side effect of building the Teams report.
//
// DECOUPLED from delivery (Kyle, 08/10/26): the CEO reported "Yesterday"
// rendering blank every morning until 10:30. Root cause — a separate cron
// (capture-blocks, 03:00 UTC) writes a row for the stay date with
// out-of-order rooms ONLY (nights/revenue/inventory all zero); that row makes
// getOccupancyRollup's `nights > 0 AND inventory > 0` filter treat "no row"
// and "blocks-only row" identically, so the real capture landing at 10:30 left
// a ~10.5-hour blank window every day. This route exists purely to move the
// real capture earlier, to match the upstream "History and Forecast" report's
// own move to 6am. It builds and posts NOTHING — revenue-report still owns
// the Teams post at 10:30 ET, unchanged, and still calls persistDailySnapshots
// itself too (see the comment there) as a backstop if this run fails; that is
// deliberate duplication, not a bug to "clean up."
//
// Safe to run twice a day: bankDailySnapshot (lib/db.ts) is CAPTURE-ONCE — its
// upsert only fills a still-empty row (`transient_nights = 0 AND
// lease_nights = 0`), so revenue-report's later call is a no-op once this run
// has already banked real counts.
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

  const url = new URL(req.url);

  // DST WINDOW GUARD (same shape as revenue-report's, mirrored on purpose):
  // Vercel Cron schedules are fixed UTC, so a single entry drifts an hour
  // against Eastern wall-clock twice a year. Two entries are scheduled an
  // hour apart (vercel.json) and this guard lets exactly one through:
  //     10:00 UTC = 06:00 EDT (runs, summer) / 05:00 EST (skipped)
  //     11:00 UTC = 07:00 EDT (skipped)      / 06:00 EST (runs, winter)
  // The window is [DAILY_CAPTURE_ET_HOUR:00, DAILY_CAPTURE_ET_HOUR+1:00) ET —
  // a full hour wide, which comfortably fits one of the two entries (5:00 or
  // 6:00, or 6:00 or 7:00) while excluding the other, since they are 60
  // minutes apart and the window is only 60 minutes wide starting exactly on
  // the target hour. `?force=1` bypasses it for a manual run.
  const minutes = easternMinutesNow();
  const inWindow =
    minutes >= DAILY_CAPTURE_ET_HOUR * 60 && minutes < (DAILY_CAPTURE_ET_HOUR + 1) * 60;
  if (!inWindow && url.searchParams.get("force") !== "1") {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: `outside the ${DAILY_CAPTURE_ET_HOUR}:00-${DAILY_CAPTURE_ET_HOUR + 1}:00 ET capture window (now ${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")} ET)`,
      written: 0,
    });
  }

  try {
    const asOf = shiftYmd(easternToday(), -1);
    const { written } = await persistDailySnapshots(asOf);
    return NextResponse.json({ ok: true, asOf, written });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
