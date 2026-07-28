// One-shot repair (07/28/26): zero the `inventory` on banked days a property
// was NOT in service, and delete rows that carry nothing but that phantom
// inventory.
//
// WHY: every writer stamped `capacity x days` regardless of whether the property
// was operating, so Jacksonville North's 2026 YTD denominator read 26,289
// room-nights (127 x 207 days, including Jan-Mar while it was dark) against
// Monica's 14,859 (127 x 117 days from its 2026-04-01 reopening). That single
// row pulled PORTFOLIO YTD occupancy from 79.7% to 75.8%. The Last-Year columns
// had the same defect and worse: Davenport's LY YTD occupancy was off by 33.4
// percentage points because 2025 rows carried 2026 capacity across months before
// the property opened.
//
// In-service windows live in config/properties.ts (`inServiceWindows`) and were
// derived from two independent sources that agree exactly — see the comments on
// the JN and DP entries.
//
// Idempotent. Dry-run by default; pass --apply to write.
//   node scripts/fix-out-of-service-inventory.mjs [--apply]
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}
const sql = neon(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL);
const APPLY = process.argv.includes("--apply");

// Mirrors config/properties.ts inServiceWindows. Kept as a literal here so this
// one-shot script needs no TS build step; if the config changes, update both.
const WINDOWS = {
  JN: [["2025-01-01", "2025-04-30"], ["2026-04-01", null]],
  DP: [["2025-06-01", null]],
};

const inService = (code, day) => {
  const w = WINDOWS[code];
  if (!w) return true;
  return w.some(([from, to]) => day >= from && (to == null || day <= to));
};

const rows = await sql`
  select property_code, to_char(stay_date,'YYYY-MM-DD') as stay_date, inventory,
         transient_nights, lease_nights, other_blocks, ooo,
         transient_rev::float8 as transient_rev, lease_rev::float8 as lease_rev
  from report_daily_snapshot order by property_code, stay_date`;

const offending = rows.filter((r) => !inService(r.property_code, r.stay_date) && r.inventory > 0);
const empty = offending.filter(
  (r) =>
    r.transient_nights === 0 && r.lease_nights === 0 && r.other_blocks === 0 && r.ooo === 0 &&
    Number(r.transient_rev) === 0 && Number(r.lease_rev) === 0,
);
const nonEmpty = offending.filter((r) => !empty.includes(r));

const byProp = {};
for (const r of offending) {
  byProp[r.property_code] ??= { days: 0, roomNights: 0, first: r.stay_date, last: r.stay_date };
  byProp[r.property_code].days++;
  byProp[r.property_code].roomNights += r.inventory;
  byProp[r.property_code].last = r.stay_date;
}

console.log(`${rows.length} banked rows scanned.`);
console.log(`${offending.length} rows carry inventory on out-of-service days:`);
for (const [code, v] of Object.entries(byProp)) {
  console.log(`  ${code}: ${v.days} days, ${v.roomNights.toLocaleString()} phantom room-nights (${v.first} .. ${v.last})`);
}
console.log(`  of those, ${empty.length} are completely empty (deletable) and ${nonEmpty.length} carry other data.`);

// Revenue outside a service window is a real business fact, not a data error —
// Jacksonville North kept collecting on existing leases for seven months after
// it stopped operating (May 2025 $22,176 tapering to Nov 2025 $3,495, with zero
// occupancy on every one of those days), and Monica's report excludes all of it:
// her JN 2025 YTD room revenue of $239,104.87 matches our Jan-Apr total, not our
// full-year total. We keep the revenue and only drop the phantom DENOMINATOR, so
// the difference stays visible instead of being quietly reconciled away.
if (nonEmpty.length) {
  const revByProp = {};
  for (const r of nonEmpty) {
    const rev = Number(r.transient_rev) + Number(r.lease_rev);
    revByProp[r.property_code] = (revByProp[r.property_code] ?? 0) + rev;
  }
  console.log("\nRevenue banked on out-of-service days (KEPT — inventory only is zeroed):");
  for (const [code, rev] of Object.entries(revByProp)) {
    console.log(`  ${code}: $${rev.toLocaleString(undefined, { minimumFractionDigits: 2 })} across ${nonEmpty.filter((r) => r.property_code === code).length} days`);
  }
  console.log("  -> Reconciliation item for Monica: her report excludes this revenue entirely.");
}

if (!APPLY) {
  console.log("\nDry run — nothing written. Re-run with --apply to zero the inventory.");
  process.exit(0);
}

// Zero the inventory rather than deleting, so the (property, day) row still
// records "we looked and the property was closed" instead of looking like a gap.
let zeroed = 0;
for (const r of offending) {
  await sql`
    update report_daily_snapshot set inventory = 0, updated_at = now()
    where property_code = ${r.property_code} and stay_date = ${r.stay_date}`;
  zeroed++;
}
console.log(`\nZeroed inventory on ${zeroed} rows.`);

const after = await sql`
  select property_code, sum(inventory)::bigint as inv_2026
  from report_daily_snapshot
  where stay_date between '2026-01-01' and '2026-07-26'
  group by property_code order by property_code`;
console.log("\n2026 YTD inventory through 7/26 (Monica: JN 14,859 · LL 32,499):");
for (const r of after) console.log(`  ${r.property_code}: ${Number(r.inv_2026).toLocaleString()}`);
