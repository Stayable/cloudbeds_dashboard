// Print the banked report_daily_snapshot rows for a stay date (default: the last
// 2 days), so what the crons stored can be compared against what a report render
// shows. Read-only.
//   node scripts/show-snapshot.mjs [YYYY-MM-DD]
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const sql = neon(process.env.DATABASE_URL);
const day = process.argv[2];

const rows = day
  ? await sql`
      select property_code, stay_date::text as d, transient_nights, lease_nights,
             other_blocks, ooo, ooo_source, inventory,
             transient_rev::float8 as transient_rev, lease_rev::float8 as lease_rev,
             flash_room_rev::float8 as flash_room_rev, is_final,
             first_captured_at::text, restated_at::text, updated_at::text
      from report_daily_snapshot where stay_date = ${day}
      order by property_code`
  : await sql`
      select property_code, stay_date::text as d, transient_nights, lease_nights,
             other_blocks, ooo, ooo_source, inventory,
             transient_rev::float8 as transient_rev, lease_rev::float8 as lease_rev,
             flash_room_rev::float8 as flash_room_rev, is_final,
             first_captured_at::text, restated_at::text, updated_at::text
      from report_daily_snapshot where stay_date >= current_date - 2
      order by stay_date, property_code`;

for (const r of rows) {
  const rev = r.transient_rev + r.lease_rev;
  const drift = r.flash_room_rev == null ? "n/a" : (rev - r.flash_room_rev).toFixed(2);
  console.log(
    `${r.d} ${r.property_code.padEnd(3)} occ=${String(r.transient_nights + r.lease_nights).padStart(4)}` +
      ` (tr ${String(r.transient_nights).padStart(3)} / le ${String(r.lease_nights).padStart(4)})` +
      ` other=${String(r.other_blocks).padStart(3)} ooo=${String(r.ooo).padStart(4)}[${r.ooo_source}]` +
      ` inv=${String(r.inventory).padStart(4)} rev=${rev.toFixed(2).padStart(11)}` +
      ` flash=${(r.flash_room_rev ?? 0).toFixed(2).padStart(11)} drift=${String(drift).padStart(9)}` +
      ` final=${r.is_final}`,
  );
  console.log(
    `        first_captured=${r.first_captured_at} restated=${r.restated_at} updated=${r.updated_at}`,
  );
}
console.log(`\n${rows.length} rows`);
