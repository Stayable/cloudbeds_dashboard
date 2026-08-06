// Does the (GLOBAL_SESSION_ID, EVENT_TYPE) dedupe silently destroy funnel rows?
//
// 98,490 of 217,946 rows in EVENTS_LEASING_RISE8 have a NULL GLOBAL_SESSION_ID.
// Snowflake's ROW_NUMBER() PARTITION BY treats all NULLs as ONE partition, so
// every null-session row of a given event type collapses to a SINGLE row. If any
// funnel-stage event has null sessions, Steph's query undercounts that stage
// catastrophically and silently. Aggregate / PII-free.
//
//   node scripts/probe-events-leasing-nulls.mjs
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

const FUNNEL = "'state','first_lead_engagement','tour_booked','tour_attended','lease_applied','application_approved','lease_signed'";

try {
  console.log("## null GLOBAL_SESSION_ID by event type (funnel stages only)");
  for (const r of await q(`SELECT EVENT_TYPE, COUNT(*) AS N,
             COUNT_IF(GLOBAL_SESSION_ID IS NULL) AS NULL_SESSION,
             COUNT(DISTINCT GLOBAL_SESSION_ID) AS DISTINCT_SESSIONS
           FROM RISE8_DATA.DA.EVENTS_LEASING_RISE8
           WHERE EVENT_TYPE IN (${FUNNEL}) AND IS_INTEREST = FALSE
           GROUP BY 1 ORDER BY N DESC`))
    console.log("  ", JSON.stringify(r));

  console.log("\n## does the dedupe drop real duplicates, or distinct people? June 2026");
  for (const r of await q(`SELECT EVENT_TYPE, COUNT(*) AS RAW,
             COUNT(DISTINCT GLOBAL_SESSION_ID) AS SESSIONS,
             COUNT(DISTINCT GUEST_CARD_ID) AS GUEST_CARDS
           FROM RISE8_DATA.DA.EVENTS_LEASING_RISE8
           WHERE EVENT_TYPE IN (${FUNNEL}) AND IS_INTEREST = FALSE
             AND CONVERT_TIMEZONE('UTC','America/New_York', EVENT_DATETIME) >= '2026-06-01'
             AND CONVERT_TIMEZONE('UTC','America/New_York', EVENT_DATETIME) <  '2026-07-01'
           GROUP BY 1 ORDER BY RAW DESC`))
    console.log("  ", JSON.stringify(r));

  console.log("\n## IS_IGNORED — a filter Steph did not mention");
  for (const r of await q(`SELECT IS_IGNORED, COUNT(*) AS N FROM RISE8_DATA.DA.EVENTS_LEASING_RISE8
           WHERE EVENT_TYPE IN (${FUNNEL}) GROUP BY 1`))
    console.log("  ", JSON.stringify(r));

  console.log("\n## are application_approved and lease_signed the same event in disguise?");
  for (const r of await q(`SELECT
             COUNT_IF(EVENT_TYPE='application_approved') AS APPROVED,
             COUNT_IF(EVENT_TYPE='lease_signed')         AS SIGNED,
             COUNT(DISTINCT CASE WHEN EVENT_TYPE='application_approved' THEN GLOBAL_SESSION_ID END) AS APPROVED_SESSIONS,
             COUNT(DISTINCT CASE WHEN EVENT_TYPE='lease_signed'         THEN GLOBAL_SESSION_ID END) AS SIGNED_SESSIONS
           FROM RISE8_DATA.DA.EVENTS_LEASING_RISE8 WHERE IS_INTEREST = FALSE`))
    console.log("  ", JSON.stringify(r));

  console.log("\n## buildings present, with names, so the map can be checked");
  for (const r of await q(`SELECT BUILDING_ID, ANY_VALUE(BUILDING_NAME) AS NAME, COUNT(*) AS N
           FROM RISE8_DATA.DA.EVENTS_LEASING_RISE8 GROUP BY 1 ORDER BY N DESC`))
    console.log("  ", JSON.stringify(r));
} catch (e) {
  console.log("QUERY FAILED:", String(e.message ?? e));
} finally {
  conn.destroy(() => {});
}
