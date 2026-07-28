// Seed HISTORICAL per-day room inventory from Monica's workbook.
//
// INVENTORY-ONLY + IDEMPOTENT: writes only `inventory`. Never touches counts or
// revenue. Companion to backfill-counts-from-monica.mjs (counts) and
// run-backfill.mjs (revenue).
//
// WHY: Cloudbeds only reports capacity as of NOW, so every historical writer
// stamped today's capacity on every past day — and capacity genuinely moves.
// Monica's workbook is the only point-in-time record we have, and it shows:
//   DP 2026: 151 rooms for 126 days, then 150, 152 and 153   (we stamped 153)
//   OR 2026: 133 for 30 days, then 135                       (we stamped 135)
//   KE 2025: 196 for 112 days, then 167                      (we stamped 168)
//   OR 2025: 193 for 112 days, then 133                      (we stamped 135)
// It also independently corroborates config/properties.ts `inServiceWindows`:
// her inventory is 0 on exactly the days JN was dark (245 days of 2025, 90 of
// 2026) and DP was pre-opening (151 days of 2025).
//
// KNOWN DISPUTE, deliberately not resolved here: her Kissimmee East inventory is
// 167 every day while Cloudbeds `getDashboard` reports 168. Seeding history from
// her file adopts 167 for past days; the going-forward value is settled by
// scripts/audit-room-counts.mjs against the actual room list, not by this
// script. Flagged rather than silently reconciled.
//
// Usage:
//   python scripts/parse-monica-counts.py "<workbook.xlsx>" <year> <cap> out.json
//   node scripts/backfill-inventory-from-monica.mjs out.json [--apply]
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}
const jsonPath = process.argv[2];
if (!jsonPath) {
  console.error("Usage: node scripts/backfill-inventory-from-monica.mjs <counts.json> [--apply]");
  process.exit(1);
}
const APPLY = process.argv.includes("--apply");
const sql = neon(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL);

const data = JSON.parse(readFileSync(jsonPath, "utf8")).filter((r) => Number.isFinite(r.inventory));
if (!data.length) {
  console.error("No inventory values in that file — did the parser run with a current layout?");
  process.exit(1);
}
const range = data.reduce(
  (a, r) => ({ min: r.date < a.min ? r.date : a.min, max: r.date > a.max ? r.date : a.max }),
  { min: data[0].date, max: data[0].date },
);
console.log(`${data.length} property-days from ${range.min} to ${range.max}.`);

// Compare against what is banked, so the change is visible before it is written.
const current = await sql`
  select property_code, to_char(stay_date,'YYYY-MM-DD') as d, inventory
  from report_daily_snapshot
  where stay_date >= ${range.min} and stay_date <= ${range.max}`;
const have = new Map(current.map((r) => [`${r.property_code}|${r.d}`, r.inventory]));

const diffs = data.filter((r) => have.has(`${r.code}|${r.date}`) && have.get(`${r.code}|${r.date}`) !== r.inventory);
const missing = data.filter((r) => !have.has(`${r.code}|${r.date}`));

const byProp = {};
for (const r of diffs) {
  const was = have.get(`${r.code}|${r.date}`);
  byProp[r.code] ??= { days: 0, net: 0, pairs: new Set() };
  byProp[r.code].days++;
  byProp[r.code].net += r.inventory - was;
  byProp[r.code].pairs.add(`${was}->${r.inventory}`);
}
console.log(`${diffs.length} banked days disagree with the workbook:`);
for (const [code, v] of Object.entries(byProp)) {
  console.log(`  ${code}: ${v.days} days, net ${v.net >= 0 ? "+" : ""}${v.net.toLocaleString()} room-nights  [${[...v.pairs].join(", ")}]`);
}
if (missing.length) console.log(`${missing.length} workbook days have no banked row (skipped — nothing to update).`);

if (!APPLY) {
  console.log("\nDry run — nothing written. Re-run with --apply.");
  process.exit(0);
}

// Batched: one round trip per 500 rows. Row-at-a-time took minutes for ~1,400
// updates against Neon.
let n = 0;
const CHUNK = 500;
for (let i = 0; i < diffs.length; i += CHUNK) {
  const chunk = diffs.slice(i, i + CHUNK);
  const values = [];
  const params = [];
  chunk.forEach((r, j) => {
    const b = j * 3;
    values.push(`($${b + 1}, $${b + 2}::date, $${b + 3}::int)`);
    params.push(r.code, r.date, r.inventory);
  });
  await sql.query(
    `update report_daily_snapshot s set inventory = v.inv, updated_at = now()
     from (values ${values.join(",")}) as v(code, day, inv)
     where s.property_code = v.code and s.stay_date = v.day`,
    params,
  );
  n += chunk.length;
  console.log(`  ${n}/${diffs.length}`);
}
console.log(`\nUpdated inventory on ${n} rows.`);
