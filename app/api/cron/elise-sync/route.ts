import { NextResponse } from "next/server";
import { runEliseSync } from "@/lib/elise-sync";

// Nightly EliseAI → Neon leasing-funnel sync. Scheduled 12:00 UTC in
// `vercel.json`.
//
// HISTORY, because the failure mode is worth not repeating: on 08/07-08/08/26 the
// EliseAI reader password stopped working (Snowflake 390100 "Incorrect username
// or password") and this cron's repeated failed logins then locked the account
// outright. The cron entry was removed rather than left to re-lock the account
// the moment EliseAI reset it. A new password arrived 08/10/26, a manual
// `npx tsx scripts/elise-sync.mts` succeeded (6,839 funnel rows, all seven
// stages back), and the schedule was restored.
//
// If it starts failing on auth again, REMOVE THE CRON ENTRY FIRST, then chase the
// credential — a daily retry against a bad password is what causes the lockout.
// Manual recovery is `npx tsx scripts/elise-sync.mts`: it records the attempt and
// clears the dashboard banner exactly as the cron would, because both go through
// runEliseSync().
// PII-free aggregates only. Guarded by CRON_SECRET: Vercel Cron sends
// `Authorization: Bearer <CRON_SECRET>` automatically when the env var is set;
// if it's unset the route is open (dev). snowflake-sdk needs the Node runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // Snowflake warehouse cold-start can take a few seconds

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }
  // `runEliseSync` records every attempt (success or failure) into
  // elise_sync_status itself, so the dashboard banner explains staleness whether
  // the sync ran from here or from scripts/elise-sync.mts. Before 08/08/26 a
  // failure 500'd and wrote nothing, so /ops §2 could see leasing data was stale
  // but had no way to say WHY. See lib/elise-status.ts.
  try {
    const result = await runEliseSync();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
