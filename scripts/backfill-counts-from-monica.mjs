// Load daily occupancy COUNTS parsed from Monica's workbook (by
// scripts/parse-monica-counts.py) into Neon report_daily_snapshot.
//
// COUNT-ONLY + IDEMPOTENT: writes only transient_nights / lease_nights /
// other_blocks / ooo. It NEVER touches revenue columns (transient_rev/lease_rev/
// inventory) — those are backfilled exactly from Cloudbeds by run-backfill.mjs.
// The parser caps at the day before the daily cron started banking counts, so
// this never clobbers a real cron-banked count snapshot. Safe to re-run.
//
// WHY from Monica's file (not Cloudbeds): historical daily counts drift when
// re-queried from CB (retroactive rate-plan reclassification shifts the
// transient/lease split and daily totals; verified 07/25/26). Monica's workbook
// is the frozen record. See memory monica-revenue-methodology.
//
// Usage:  node scripts/backfill-counts-from-monica.mjs <counts.json>
// Reads DATABASE_URL from .env.local.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const jsonPath = process.argv[2];
if (!jsonPath) {
  console.error("Usage: node scripts/backfill-counts-from-monica.mjs <counts.json>");
  process.exit(1);
}

const env = {};
for (const line of readFileSync(join(root, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
if (!env.DATABASE_URL) throw new Error("DATABASE_URL missing from .env.local");

const data = JSON.parse(readFileSync(jsonPath, "utf8"));
const { neon } = await import("@neondatabase/serverless");
const sql = neon(env.DATABASE_URL);

const pre = await sql`
  select to_char(min(stay_date),'YYYY-MM-DD') as d
  from report_daily_snapshot where (transient_nights+lease_nights+other_blocks+ooo)>0`;
console.log("earliest existing real-count date (cron-banked):", pre[0].d);
console.log(`upserting ${data.length} count rows (count columns only)...`);

let n = 0;
for (const r of data) {
  await sql`
    insert into report_daily_snapshot
      (property_code, stay_date, transient_nights, lease_nights, other_blocks, ooo)
    values
      (${r.code}, ${r.date}, ${r.transientNights}, ${r.leaseNights}, ${r.otherBlocks}, ${r.ooo})
    on conflict (property_code, stay_date) do update set
      transient_nights = excluded.transient_nights,
      lease_nights = excluded.lease_nights,
      other_blocks = excluded.other_blocks,
      ooo = excluded.ooo,
      updated_at = now()`;
  n++;
  if (n % 200 === 0) console.log(`  ${n}/${data.length}`);
}
console.log(`done — upserted ${n} rows.`);

const cov = await sql`
  select property_code,
    to_char(min(stay_date),'YYYY-MM-DD') as first_count,
    to_char(max(stay_date),'YYYY-MM-DD') as last_count
  from report_daily_snapshot where (transient_nights+lease_nights+other_blocks+ooo)>0
  group by property_code order by property_code`;
console.log("\nReal-count coverage per property:");
for (const x of cov) console.log(`  ${x.property_code}: ${x.first_count} -> ${x.last_count}`);
