// Nightly PII-FREE aggregate sync: EliseAI Snowflake data share → Neon.
// Reads two aggregate (GROUP BY) queries from RISE8_DATA.DA — no name/email/
// phone/transcript column is ever selected, so PII never leaves Snowflake —
// maps Elise BUILDING_ID → Stayable code (config/elise-buildings.json), and
// upserts into Neon (elise_funnel_daily + elise_pipeline_snapshot).
//
// Same logic runs in prod via app/api/cron/elise-sync (lib/elise-sync.ts). This
// standalone .mjs is for the initial backfill and local verification.
// Run:  node scripts/elise-sync.mjs
import { readFileSync } from "node:fs";
import snowflake from "snowflake-sdk";
import { neon } from "@neondatabase/serverless";

// --- load .env.local (no dep) ---
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}

// Shared building→code map (single source of truth with config/elise.ts).
const BUILDING_TO_CODE = JSON.parse(
  readFileSync(new URL("../config/elise-buildings.json", import.meta.url), "utf8"),
);

const dbUrl = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!dbUrl) { console.error("No DATABASE_URL(_UNPOOLED) in .env.local"); process.exit(1); }
const sql = neon(dbUrl);

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
const sfQuery = (sqlText) =>
  new Promise((resolve, reject) =>
    conn.execute({ sqlText, complete: (err, _s, rows) => (err ? reject(err) : resolve(rows)) }),
  );

// Snowflake DATE columns arrive as JS Date (UTC midnight) or string → YYYY-MM-DD.
const ymd = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

async function bulkUpsertFunnel(rows) {
  const CHUNK = 400;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const values = [];
    const params = [];
    chunk.forEach((r, j) => {
      const b = j * 5;
      values.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5})`);
      params.push(r.buildingId, r.code, r.day, r.eventType, r.n);
    });
    await sql.query(
      `insert into elise_funnel_daily (building_id, code, day, event_type, n)
       values ${values.join(",")}
       on conflict (building_id, day, event_type)
       do update set n = excluded.n, code = excluded.code`,
      params,
    );
  }
}

async function replaceSnapshot(rows) {
  await sql.query("delete from elise_pipeline_snapshot");
  if (!rows.length) return;
  const values = [];
  const params = [];
  rows.forEach((r, j) => {
    const b = j * 4;
    values.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4})`);
    params.push(r.buildingId, r.code, r.status, r.n);
  });
  await sql.query(
    `insert into elise_pipeline_snapshot (building_id, code, prospect_status, n)
     values ${values.join(",")}`,
    params,
  );
}

await new Promise((resolve, reject) => conn.connect((e) => (e ? reject(e) : resolve())));

try {
  // 1) Funnel — one row per (building, event date, event_type). Aggregate only.
  const funnelRaw = await sfQuery(`
    SELECT BUILDING_ID, EVENT_DATETIME::DATE AS DAY, EVENT_TYPE, COUNT(*) AS N
    FROM RISE8_DATA.DA.PROSPECT_EVENTS_RISE8
    WHERE BUILDING_ID IS NOT NULL AND EVENT_DATETIME IS NOT NULL AND EVENT_TYPE IS NOT NULL
    GROUP BY BUILDING_ID, EVENT_DATETIME::DATE, EVENT_TYPE`);

  let skipped = 0;
  const funnel = [];
  for (const r of funnelRaw) {
    const code = BUILDING_TO_CODE[String(r.BUILDING_ID)];
    if (!code) { skipped++; continue; }
    funnel.push({ buildingId: Number(r.BUILDING_ID), code, day: ymd(r.DAY), eventType: r.EVENT_TYPE, n: Number(r.N) });
  }

  // 2) Pipeline snapshot — current prospect-status counts. Aggregate only.
  const snapRaw = await sfQuery(`
    SELECT ELISE_PROPERTY_ID AS BUILDING_ID, PROSPECT_STATUS, COUNT(*) AS N
    FROM RISE8_DATA.DA.PROSPECTS_RISE8
    WHERE ELISE_PROPERTY_ID IS NOT NULL AND PROSPECT_STATUS IS NOT NULL
    GROUP BY ELISE_PROPERTY_ID, PROSPECT_STATUS`);
  const snapshot = [];
  for (const r of snapRaw) {
    const code = BUILDING_TO_CODE[String(r.BUILDING_ID)];
    if (!code) { skipped++; continue; }
    snapshot.push({ buildingId: Number(r.BUILDING_ID), code, status: r.PROSPECT_STATUS, n: Number(r.N) });
  }

  await bulkUpsertFunnel(funnel);
  await replaceSnapshot(snapshot);

  console.log(`Sync complete.`);
  console.log(`  funnel rows upserted:   ${funnel.length}`);
  console.log(`  snapshot rows written:  ${snapshot.length}`);
  console.log(`  rows skipped (unmapped building): ${skipped}`);
} catch (e) {
  console.error("SYNC ERROR:", e.message || e);
  process.exitCode = 1;
} finally {
  conn.destroy(() => {});
}
