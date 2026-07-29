import { NextResponse } from "next/server";
import { easternToday } from "@/lib/dates";
import { captureEndOfDayBlocks } from "@/lib/cloudbeds";

// END-OF-DAY room-block capture (Vercel Cron, 03:00 UTC — see vercel.json).
//
// Cloudbeds room blocks erode: changing a block drops it from the days already
// gone, and a past block cannot be re-added, so a stay date's out-of-order count
// can only DECREASE on re-query and the earliest reading is the truest. The
// 06:00 ET flash runs the morning AFTER the stay date and has already lost
// anything tidied up during the day — banked Lakeland read 3 for 2026-07-28
// where both Monica's report and a live re-query said 6.
//
// 03:00 UTC is late evening Eastern on the day being captured (23:00 EDT, or
// 22:00 EST in winter), so `easternToday()` returns the day that is just ending
// in both halves of the year. Blocks only — nights and revenue still belong to
// the morning flash. PII-free, aggregates only (CLAUDE.md §5).
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
    // ?date= overrides the target day, for a manual catch-up. It is only ever
    // sound for TODAY or a past day — a future date would record a plan as an
    // actual (see captureEndOfDayBlocks).
    const url = new URL(req.url);
    const today = easternToday();
    const requested = url.searchParams.get("date");
    if (requested && requested > today) {
      return NextResponse.json(
        { ok: false, error: `refusing a future date: ${requested} > ${today}` },
        { status: 400 },
      );
    }
    const stayDate = requested ?? today;

    const { observed, skipped } = await captureEndOfDayBlocks(stayDate);
    return NextResponse.json({
      ok: skipped.length === 0,
      stayDate,
      observedCount: observed.length,
      observed,
      // A skipped property is one whose blocks could NOT be read — deliberately
      // not written as 0, so the figure stays open for the morning flash.
      skippedCount: skipped.length,
      skipped,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
