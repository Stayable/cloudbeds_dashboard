import { NextResponse } from "next/server";
import { easternToday, shiftYmd } from "@/lib/dates";
import { findAvailabilityAnomalies, findSnapshotGaps } from "@/lib/db";
import { PROPERTIES } from "@/config/properties";

// Snapshot gap detector. Our Neon store is the source of truth going forward, so
// a missing daily snapshot = silent, permanent data loss (a cron miss, an
// expired Cloudbeds key, a DB blip). This reports any (active property × day)
// with no snapshot over a recent window so it can be re-banked before it's lost.
// Guarded by CRON_SECRET (same as the other cron routes); safe to hit manually.
//   GET /api/cron/gaps?days=30   → { ok, start, end, totalMissing, byProperty }
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    const days = Math.max(1, Math.min(400, Number(url.searchParams.get("days") ?? 30)));
    // Check through yesterday — today isn't banked until tomorrow's cron.
    const end = shiftYmd(easternToday(), -1);
    const start = shiftYmd(end, -(days - 1));
    const codes = PROPERTIES.filter((p) => p.active === true).map((p) => p.code);

    const [gaps, availability] = await Promise.all([
      findSnapshotGaps(start, end, codes),
      // Second failure mode, added 07/28/26: a day can be banked and still be
      // wrong. Sustained implausible availability means inventory or OOO is off
      // (JN sat at 70% "available" for months because its renovation rooms were
      // never blocked in Cloudbeds).
      findAvailabilityAnomalies(start, end),
    ]);
    const byProperty: Record<string, string[]> = {};
    for (const g of gaps) (byProperty[g.propertyCode] ??= []).push(g.stayDate);

    return NextResponse.json({
      ok: true,
      window: { start, end, days },
      propertiesChecked: codes,
      totalMissing: gaps.length,
      byProperty,
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
