// Throwaway probe: snapshot-store coverage by year/property — how much history
// exists for the report's Last-Year columns, and where counts vs revenue-only.
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}
const sql = neon(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL);

const byYear = await sql`
  select extract(year from stay_date)::int as yr, property_code,
         count(*)::int as days,
         count(*) filter (where transient_nights + lease_nights + other_blocks + ooo > 0)::int as with_counts,
         count(*) filter (where transient_rev + lease_rev > 0)::int as with_rev,
         to_char(min(stay_date),'YYYY-MM-DD') as first_day,
         to_char(max(stay_date),'YYYY-MM-DD') as last_day
  from report_daily_snapshot
  group by 1,2 order by 1,2`;
console.table(byYear);
