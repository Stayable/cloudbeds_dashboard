import { NextResponse } from "next/server";
import { runEliseSync } from "@/lib/elise-sync";

// Nightly EliseAI → Neon leasing-funnel sync.
//
// ⚠ THE CRON ENTRY IS DISABLED (Kyle, 08/08/26). This route still works and is
// still the production sync path — it simply is not scheduled. Removed from
// `vercel.json` because the EliseAI reader password is rejected (Snowflake
// 390100 "Incorrect username or password") and the account had been temporarily
// locked: repeated failed logins FROM THIS CRON are what locked it. Leaving it
// scheduled would re-lock the account the moment EliseAI resets it, making us the
// cause of our own blocker.
//
// To re-enable, once a working SNOWFLAKE_PASSWORD is set in Vercel, restore:
//     { "path": "/api/cron/elise-sync", "schedule": "0 12 * * *" }
// Until then recovery is manual — `npx tsx scripts/elise-sync.mts` records the
// attempt and clears the dashboard banner exactly as the cron would, because both
// go through runEliseSync().
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
