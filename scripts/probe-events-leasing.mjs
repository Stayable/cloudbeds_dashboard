// Read-only probe of EVENTS_LEASING_RISE8 — the table EliseAI (Steph, 08/07/26)
// says the Leasing Dashboard actually uses, in place of PROSPECT_EVENTS_RISE8.
// AGGREGATE / PII-FREE: selects counts, dates, ids and event types only.
//
//   node scripts/probe-events-leasing.mjs
//
// Reports, in order:
//   0. whether the credentials even work (the password was being reset);
//   1. that the view exists and its column list;
//   2. the EVENT_TYPE vocabulary + IS_INTEREST split;
//   3. how much the (GLOBAL_SESSION_ID, EVENT_TYPE) dedupe actually removes;
//   4. Steph's exact sample query, so we can reproduce her June numbers.
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

try {
  await new Promise((resolve, reject) => conn.connect((e) => (e ? reject(e) : resolve())));
  console.log("CONNECTED as", process.env.SNOWFLAKE_USER, "\n");
} catch (e) {
  console.log("CONNECT FAILED:", String(e.message ?? e));
  console.log("\nIf this is an auth error the password reset has not landed yet.");
  process.exit(1);
}

const show = (label, rows) => {
  console.log(`\n## ${label}`);
  for (const r of rows) console.log("  ", JSON.stringify(r));
};

try {
  show(
    "1. columns of EVENTS_LEASING_RISE8",
    await q(`SELECT COLUMN_NAME, DATA_TYPE FROM RISE8_DATA.INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA='DA' AND TABLE_NAME='EVENTS_LEASING_RISE8' ORDER BY ORDINAL_POSITION`),
  );

  show(
    "2. EVENT_TYPE vocabulary x IS_INTEREST, with date range",
    await q(`SELECT EVENT_TYPE, IS_INTEREST, COUNT(*) AS N,
                    MIN(EVENT_DATETIME)::DATE AS FIRST_DAY, MAX(EVENT_DATETIME)::DATE AS LAST_DAY
             FROM RISE8_DATA.DA.EVENTS_LEASING_RISE8
             GROUP BY 1,2 ORDER BY N DESC`),
  );

  show(
    "3. what the (GLOBAL_SESSION_ID, EVENT_TYPE) dedupe removes",
    await q(`SELECT COUNT(*) AS RAW_ROWS,
                    COUNT(DISTINCT GLOBAL_SESSION_ID || '|' || EVENT_TYPE) AS DEDUPED,
                    COUNT_IF(GLOBAL_SESSION_ID IS NULL) AS NULL_SESSION
             FROM RISE8_DATA.DA.EVENTS_LEASING_RISE8`),
  );

  show(
    "4. Steph's sample query, June 2026 (America/New_York), portfolio-wide",
    await q(`SELECT
               COUNT_IF(EVENT_TYPE = 'state')                 AS LEADS,
               COUNT_IF(EVENT_TYPE = 'first_lead_engagement') AS ENGAGED,
               COUNT_IF(EVENT_TYPE = 'tour_booked')           AS TOURS_BOOKED,
               COUNT_IF(EVENT_TYPE = 'tour_attended')         AS TOURS_ATTENDED,
               COUNT_IF(EVENT_TYPE = 'lease_applied')         AS APPS_STARTED,
               COUNT_IF(EVENT_TYPE = 'application_approved')  AS APPS_APPROVED,
               COUNT_IF(EVENT_TYPE = 'lease_signed')          AS LEASES_SIGNED
             FROM (
               SELECT EVENT_TYPE, IS_INTEREST,
                      CONVERT_TIMEZONE('UTC','America/New_York', EVENT_DATETIME) AS EVENT_LOCAL
               FROM RISE8_DATA.DA.EVENTS_LEASING_RISE8
               QUALIFY ROW_NUMBER() OVER (
                 PARTITION BY GLOBAL_SESSION_ID, EVENT_TYPE ORDER BY EVENT_DATETIME) = 1
             )
             WHERE IS_INTEREST = FALSE
               AND EVENT_LOCAL >= '2026-06-01' AND EVENT_LOCAL < '2026-07-01'`),
  );

  show(
    "5. same, per BUILDING_ID (what we actually need to store)",
    await q(`SELECT BUILDING_ID,
               COUNT_IF(EVENT_TYPE = 'state')                 AS LEADS,
               COUNT_IF(EVENT_TYPE = 'first_lead_engagement') AS ENGAGED,
               COUNT_IF(EVENT_TYPE = 'tour_booked')           AS TOURS_BOOKED,
               COUNT_IF(EVENT_TYPE = 'tour_attended')         AS TOURS_ATTENDED,
               COUNT_IF(EVENT_TYPE = 'lease_applied')         AS APPS_STARTED,
               COUNT_IF(EVENT_TYPE = 'application_approved')  AS APPS_APPROVED,
               COUNT_IF(EVENT_TYPE = 'lease_signed')          AS LEASES_SIGNED
             FROM (
               SELECT BUILDING_ID, EVENT_TYPE, IS_INTEREST,
                      CONVERT_TIMEZONE('UTC','America/New_York', EVENT_DATETIME) AS EVENT_LOCAL
               FROM RISE8_DATA.DA.EVENTS_LEASING_RISE8
               QUALIFY ROW_NUMBER() OVER (
                 PARTITION BY GLOBAL_SESSION_ID, EVENT_TYPE ORDER BY EVENT_DATETIME) = 1
             )
             WHERE IS_INTEREST = FALSE
               AND EVENT_LOCAL >= '2026-06-01' AND EVENT_LOCAL < '2026-07-01'
             GROUP BY BUILDING_ID ORDER BY LEADS DESC`),
  );

  show(
    "6. OUR CURRENT SOURCE for the same window, for the delta",
    await q(`SELECT EVENT_TYPE, COUNT(*) AS N
             FROM RISE8_DATA.DA.PROSPECT_EVENTS_RISE8
             WHERE EVENT_DATETIME >= '2026-06-01' AND EVENT_DATETIME < '2026-07-01'
             GROUP BY 1 ORDER BY N DESC`),
  );
} catch (e) {
  console.log("\nQUERY FAILED:", String(e.message ?? e));
} finally {
  conn.destroy(() => {});
}
