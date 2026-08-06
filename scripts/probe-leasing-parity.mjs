// Prove the SQL we are about to SHIP reproduces Steph's numbers exactly.
//
//   node scripts/probe-leasing-parity.mjs
//
// Two things this checks, both of which would be silent errors:
//
//  A. IS_INTEREST must be filtered AFTER the dedupe, as Steph does. Filtering it
//     BEFORE changes which row wins its (session, event_type) partition: a
//     session whose earliest 'state' is an interest row contributes 0 leads her
//     way and 1 lead the other way. Prints both so the difference is visible.
//  B. Our sync stores (day, event_type) rollups and the UI SUMS them over a
//     window. That only equals her windowed query if the dedupe is GLOBAL and
//     each surviving row lands on exactly one local day. Verified by summing our
//     rollup over June and comparing to her single query.
import { readFileSync } from "node:fs";
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}
import snowflake from "snowflake-sdk";
snowflake.configure({ logLevel: "ERROR" });
const conn = snowflake.createConnection({
  account: process.env.SNOWFLAKE_ACCOUNT,
  username: process.env.SNOWFLAKE_USER,
  password: process.env.SNOWFLAKE_PASSWORD,
  warehouse: process.env.SNOWFLAKE_WAREHOUSE,
  database: process.env.SNOWFLAKE_DATABASE ?? "RISE8_DATA",
  schema: process.env.SNOWFLAKE_SCHEMA ?? "DA",
  role: process.env.SNOWFLAKE_ROLE ?? "SYSADMIN",
});
const q = (sqlText) =>
  new Promise((resolve, reject) =>
    conn.execute({ sqlText, complete: (err, _s, rows) => (err ? reject(err) : resolve(rows ?? [])) }),
  );
await new Promise((resolve, reject) => conn.connect((e) => (e ? reject(e) : resolve())));

const TYPES = `'state','first_lead_engagement','tour_booked','tour_attended','lease_applied','application_approved','lease_signed'`;
const TZ = `CONVERT_TIMEZONE('UTC','America/New_York', EVENT_DATETIME)`;

// The shipping query: dedupe globally, keep event_type pre-filter (SAFE - the
// partition is BY event_type, so other types cannot affect a winner), leave
// IS_INTEREST to the outer WHERE (NOT safe to move inward).
const SHIPPING = `
  SELECT BUILDING_ID, EVENT_LOCAL::DATE AS DAY, EVENT_TYPE, COUNT(*) AS N
  FROM (
    SELECT BUILDING_ID, EVENT_TYPE, IS_INTEREST, ${TZ} AS EVENT_LOCAL
    FROM RISE8_DATA.DA.EVENTS_LEASING_RISE8
    WHERE EVENT_TYPE IN (${TYPES})
      AND BUILDING_ID IS NOT NULL AND EVENT_DATETIME IS NOT NULL
    QUALIFY ROW_NUMBER() OVER (
      PARTITION BY GLOBAL_SESSION_ID, EVENT_TYPE ORDER BY EVENT_DATETIME) = 1
  )
  WHERE IS_INTEREST = FALSE
  GROUP BY 1, 2, 3`;

const june = (rows, type) =>
  rows.filter((r) => r.EVENT_TYPE === type && r.DAY >= "2026-06-01" && r.DAY <= "2026-06-30")
      .reduce((s, r) => s + Number(r.N), 0);

try {
  console.log("## A. interest filtered AFTER the dedupe (Steph's way) vs BEFORE");
  const after = await q(`SELECT COUNT_IF(EVENT_TYPE='state') AS LEADS FROM (
      SELECT EVENT_TYPE, IS_INTEREST, ${TZ} AS EVENT_LOCAL FROM RISE8_DATA.DA.EVENTS_LEASING_RISE8
      QUALIFY ROW_NUMBER() OVER (PARTITION BY GLOBAL_SESSION_ID, EVENT_TYPE ORDER BY EVENT_DATETIME)=1)
    WHERE IS_INTEREST=FALSE AND EVENT_LOCAL>='2026-06-01' AND EVENT_LOCAL<'2026-07-01'`);
  const before = await q(`SELECT COUNT_IF(EVENT_TYPE='state') AS LEADS FROM (
      SELECT EVENT_TYPE, ${TZ} AS EVENT_LOCAL FROM RISE8_DATA.DA.EVENTS_LEASING_RISE8
      WHERE IS_INTEREST=FALSE
      QUALIFY ROW_NUMBER() OVER (PARTITION BY GLOBAL_SESSION_ID, EVENT_TYPE ORDER BY EVENT_DATETIME)=1)
    WHERE EVENT_LOCAL>='2026-06-01' AND EVENT_LOCAL<'2026-07-01'`);
  console.log(`   after (ship this): ${after[0].LEADS}   before (wrong): ${before[0].LEADS}`);

  console.log("\n## B. our stored rollup, summed over June, vs Steph's single query");
  // Snowflake DATE arrives as a JS Date, so String() yields "Wed Jun 03 2026..."
  // rather than an ISO day. Same coercion as ymd() in lib/snowflake.ts.
  const ymd = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
  const rollup = (await q(SHIPPING)).map((r) => ({ ...r, DAY: ymd(r.DAY) }));
  const hers = { LEADS: 1863, ENGAGED: 781, TOURS_BOOKED: 223, TOURS_ATTENDED: 90, APPS_STARTED: 274, APPS_APPROVED: 146, LEASES_SIGNED: 146 };
  const map = {
    LEADS: "state", ENGAGED: "first_lead_engagement", TOURS_BOOKED: "tour_booked",
    TOURS_ATTENDED: "tour_attended", APPS_STARTED: "lease_applied",
    APPS_APPROVED: "application_approved", LEASES_SIGNED: "lease_signed",
  };
  let allMatch = true;
  for (const [label, type] of Object.entries(map)) {
    const ours = june(rollup, type);
    const ok = ours === hers[label];
    if (!ok) allMatch = false;
    console.log(`   ${label.padEnd(15)} ours ${String(ours).padStart(5)}  hers ${String(hers[label]).padStart(5)}  ${ok ? "MATCH" : "*** MISMATCH ***"}`);
  }
  console.log(`\n   ${allMatch ? "ALL SEVEN STAGES MATCH - safe to ship" : "MISMATCH - do not ship"}`);
  console.log(`   rollup rows to store: ${rollup.length}`);
} catch (e) {
  console.log("QUERY FAILED:", String(e.message ?? e));
} finally {
  conn.destroy(() => {});
}
