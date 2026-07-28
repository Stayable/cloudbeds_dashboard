import { NextResponse } from "next/server";
import { easternToday } from "@/lib/dates";
import { getRatePlanInventory } from "@/lib/cloudbeds";
import { recordAndDiffRatePlans } from "@/lib/db";

// Rate-plan classifier audit. Lease/transient is detected purely from rate-plan
// strings, so a lease booked on a plan name missing from the keyword lists banks
// as transient forever. This lists every distinct plan actually in use per
// property with its volume and both classifier verdicts, plus the subset that
// reads lease-like but classifies transient (`reviewCandidates`).
//
// Read-only, PII-free. Guarded by CRON_SECRET like the other cron routes — it
// lives here (not /api/diagnostics) so the same bearer works and it stays out of
// the PIN-gated UI surface. Not scheduled; run manually.
//   GET /api/cron/rate-plans?start=2026-01-01&end=2026-07-27
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
    const today = easternToday();
    const end = url.searchParams.get("end") ?? today;
    const start = url.searchParams.get("start") ?? `${today.slice(0, 4)}-01-01`;

    const properties = await getRatePlanInventory(start, end);
    const reviewCandidates = properties.flatMap((p) =>
      p.plans
        .filter((plan) => plan.reviewCandidate)
        .map((plan) => ({ property: p.code, ...plan })),
    );
    const distinctPlans = [...new Set(properties.flatMap((p) => p.plans.map((x) => x.plan)))].sort();

    // Alert on plan names never seen before. A run that surfaces a new plan is
    // the ONLY warning that a lease may be banking as transient — the audit
    // itself has always listed plans, but nothing compared the list run to run.
    // Best-effort: an unreachable DB must not fail the audit.
    let newPlans: string[] = [];
    let planTrackingError: string | undefined;
    try {
      newPlans = await recordAndDiffRatePlans(distinctPlans);
    } catch (e) {
      planTrackingError = e instanceof Error ? e.message : String(e);
    }

    return NextResponse.json({
      ok: true,
      window: { start, end },
      propertiesFailed: properties.filter((p) => !p.ok).map((p) => ({ code: p.code, error: p.error })),
      distinctPlanCount: distinctPlans.length,
      distinctPlans,
      // Plans appearing for the first time — each needs a lease/transient ruling
      // before its nights and revenue can be trusted.
      newPlans,
      newPlanCount: newPlans.length,
      planTrackingError,
      reviewCandidates,
      properties,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
