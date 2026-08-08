// ONE-OFF: backfill elise_sync_status with the attempts that happened BEFORE the
// table existed (added 08/08/26).
//
// Without this the banner would read "Leasing data has never synced", which is
// false — syncs succeeded nightly until 08/06. And because the cron is now
// disabled, no new attempt will ever arrive to correct it, so the wrong message
// would be permanent.
//
// EVERY ROW BELOW IS EVIDENCED, not reconstructed from memory:
//   08/06 17:07  SUCCESS  — max(updated_at) in elise_funnel_daily
//   08/07 12:00  FAILED   — Vercel runtime log, "Incorrect username or password"
//   08/08 12:00  FAILED   — Vercel runtime log, "temporarily locked"
//   08/08 16:50  FAILED   — a single deliberate login test run from this machine
//
// That order matters and is the diagnosis: the password died FIRST, then our own
// nightly retries locked the account. The lockout is a symptom, not the cause.
//
//   npx tsx scripts/seed-elise-sync-status.mts            # dry run
//   npx tsx scripts/seed-elise-sync-status.mts --apply
//
// Idempotent: refuses to write if the table already has rows, so a second run
// cannot double-seed.
import { readFileSync } from "node:fs";
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}
const { neon } = await import("@neondatabase/serverless");
const sql = neon(process.env.DATABASE_URL!);
const APPLY = process.argv.includes("--apply");

const ROWS: { at: string; ok: boolean; error: string | null; note: string }[] = [
  {
    at: "2026-08-06T17:07:00Z", ok: true, error: null,
    note: "evidence: max(updated_at) in elise_funnel_daily",
  },
  {
    at: "2026-08-07T12:00:37Z", ok: false,
    error: "Incorrect username or password was specified. [b08bbda5-2a97-4109-b27b-c5b7ae1d6db1]",
    note: "evidence: Vercel runtime log, cron run 08/07 12:00:37 UTC (500)",
  },
  {
    at: "2026-08-08T12:00:21Z", ok: false,
    error: "Your user account has been temporarily locked. Try again later or contact your account administrator for assistance. [98fc49f5-4543-4a01-89ab-d3719574275f]",
    note: "evidence: Vercel runtime log, cron run 08/08 12:00:21 UTC (500)",
  },
  {
    at: "2026-08-08T16:50:00Z", ok: false,
    error: "Incorrect username or password was specified. [9b7e8233-22e6-49e9-b617-f837621278ff]",
    note: "evidence: single deliberate login test, 08/08 — proves the lockout expired and the PASSWORD is the live problem",
  },
];

const existing = (await sql`select count(*)::int as n from elise_sync_status`) as { n: number }[];
console.log(`\nelise_sync_status currently holds ${existing[0].n} row(s).\n`);

if (existing[0].n > 0) {
  console.log("Table is not empty — refusing to seed. Nothing written.");
  process.exit(0);
}

for (const r of ROWS) {
  console.log(`  ${r.at}  ${r.ok ? "OK     " : "FAILED "} ${r.error ? r.error.slice(0, 60) + "…" : ""}`);
  console.log(`      ${r.note}`);
}

if (!APPLY) {
  console.log(`\nDRY RUN — ${ROWS.length} rows would be inserted. Re-run with --apply.`);
} else {
  for (const r of ROWS) {
    await sql`
      insert into elise_sync_status (attempted_at, ok, error)
      values (${r.at}, ${r.ok}, ${r.error})
    `;
  }
  console.log(`\nWROTE ${ROWS.length} rows.`);
}
