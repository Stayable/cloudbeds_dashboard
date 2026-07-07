// Read-only probe of the EliseAI Snowflake data share (RISE8_DATA.DA).
// Pulls the funnel VOCABULARY (distinct EVENT_TYPE / PROSPECT_STATUS + counts),
// per-building row presence (to catch the unlaunched "New" dupes 859088/859089),
// and date ranges — all AGGREGATE / PII-FREE. Selects no name/email/phone columns.
//
// Creds come from .env.local (gitignored). No secrets in this file.
// Run:  node scripts/snowflake-probe.mjs
import { readFileSync } from "node:fs";
import snowflake from "snowflake-sdk";

// --- load .env.local (no dep) ---
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}

snowflake.configure({ logLevel: "ERROR" });

const conn = snowflake.createConnection({
  account: process.env.SNOWFLAKE_ACCOUNT,
  username: process.env.SNOWFLAKE_USER,
  password: process.env.SNOWFLAKE_PASSWORD,
  warehouse: process.env.SNOWFLAKE_WAREHOUSE,
  database: process.env.SNOWFLAKE_DATABASE,
  schema: process.env.SNOWFLAKE_SCHEMA,
  role: process.env.SNOWFLAKE_ROLE,
});

const q = (sqlText) =>
  new Promise((resolve, reject) =>
    conn.execute({ sqlText, complete: (err, _stmt, rows) => (err ? reject(err) : resolve(rows)) })
  );

const show = (title, rows) => {
  console.log(`\n=== ${title} ===`);
  if (!rows?.length) return console.log("  (no rows)");
  console.table(rows);
};

await new Promise((resolve, reject) =>
  conn.connect((err) => (err ? reject(err) : resolve()))
);

try {
  const [ver] = await q("SELECT CURRENT_VERSION() AS V, CURRENT_ROLE() AS R, CURRENT_WAREHOUSE() AS W");
  console.log(`Connected. Snowflake ${ver.V} · role ${ver.R} · wh ${ver.W}`);

  show("EVENTS_LEASING — EVENT_TYPE vocab", await q(`
    SELECT EVENT_TYPE, COUNT(*) AS N
    FROM RISE8_DATA.DA.EVENTS_LEASING_RISE8
    GROUP BY EVENT_TYPE ORDER BY N DESC`));

  show("PROSPECT_EVENTS — EVENT_TYPE vocab", await q(`
    SELECT EVENT_TYPE, COUNT(*) AS N
    FROM RISE8_DATA.DA.PROSPECT_EVENTS_RISE8
    GROUP BY EVENT_TYPE ORDER BY N DESC`));

  show("PROSPECTS — PROSPECT_STATUS vocab", await q(`
    SELECT PROSPECT_STATUS, COUNT(*) AS N
    FROM RISE8_DATA.DA.PROSPECTS_RISE8
    GROUP BY PROSPECT_STATUS ORDER BY N DESC`));

  show("EVENTS_LEASING — rows per building (watch for 859088/859089)", await q(`
    SELECT BUILDING_ID, ANY_VALUE(BUILDING_NAME) AS NAME, COUNT(*) AS N,
           MIN(EVENT_DATETIME)::DATE AS FIRST, MAX(EVENT_DATETIME)::DATE AS LAST
    FROM RISE8_DATA.DA.EVENTS_LEASING_RISE8
    GROUP BY BUILDING_ID ORDER BY N DESC`));

  show("PROSPECTS — rows per building", await q(`
    SELECT ELISE_PROPERTY_ID AS BUILDING_ID, ANY_VALUE(BUILDING_NAME) AS NAME, COUNT(*) AS N,
           MIN(PROSPECT_CREATED_TIME)::DATE AS FIRST, MAX(PROSPECT_CREATED_TIME)::DATE AS LAST
    FROM RISE8_DATA.DA.PROSPECTS_RISE8
    GROUP BY ELISE_PROPERTY_ID ORDER BY N DESC`));

  show("PROSPECTS — stage-timestamp fill (funnel depth, last 90d by created)", await q(`
    SELECT
      COUNT(*) AS PROSPECTS,
      COUNT(APPLICATION_STARTED_TIME)   AS APP_STARTED,
      COUNT(APPLICATION_COMPLETED_TIME) AS APP_COMPLETED,
      COUNT(APPLICATION_APPROVED_TIME)  AS APP_APPROVED,
      COUNT(LEASE_STARTED_TIME)         AS LEASE_STARTED,
      COUNT(LEASE_COMPLETED_TIME)       AS LEASE_COMPLETED
    FROM RISE8_DATA.DA.PROSPECTS_RISE8
    WHERE PROSPECT_CREATED_TIME >= DATEADD(day, -90, CURRENT_DATE())`));
} catch (e) {
  console.error("PROBE ERROR:", e.message || e);
  process.exitCode = 1;
} finally {
  conn.destroy(() => {});
}
