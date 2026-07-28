// Throwaway probe: dump banked report_daily_snapshot rows for a date window as
// JSON, so a parity comparison against Monica's PDF can run offline.
// Run: node scripts/probe-monica-parity.mjs 2026-07-01 2026-08-03
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}

const sql = neon(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL);
const [start, end] = [process.argv[2] ?? "2026-01-01", process.argv[3] ?? "2026-08-03"];

const rows = await sql`
  select property_code, to_char(stay_date,'YYYY-MM-DD') as stay_date,
         transient_nights, lease_nights, other_blocks, ooo, inventory,
         transient_rev::float8 as transient_rev, lease_rev::float8 as lease_rev,
         updated_at::text as updated_at
  from report_daily_snapshot
  where stay_date >= ${start} and stay_date <= ${end}
  order by stay_date, property_code`;

process.stdout.write(JSON.stringify(rows));
