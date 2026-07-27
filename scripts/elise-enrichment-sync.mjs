// Standalone backfill/refresh for the Elise ENRICHMENT metrics
// (elise_metric_daily). Mirrors lib/snowflake.ts fetchEliseEnrichment +
// lib/db.ts upsertEliseMetrics, but runnable from the CLI with .env.local —
// same pattern as scripts/elise-sync.mjs. Read-only against Snowflake,
// PII-free (counts / durations / category labels only).
//   node scripts/elise-enrichment-sync.mjs
import { readFileSync } from "node:fs";
import snowflake from "snowflake-sdk";
import { neon } from "@neondatabase/serverless";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}
const buildingMap = JSON.parse(readFileSync(new URL("../config/elise-buildings.json", import.meta.url), "utf8"));

const CLEAN_SOURCE = `NULLIF(TRIM(REPLACE(REPLACE(REPLACE(MARKETING_SOURCE, '[', ''), ']', ''), '"', '')), '-')`;
const CLEAN_HANDOFF = `TRIM(REPLACE(REPLACE(REPLACE(HANDOFF_REASONS::string, '[', ''), ']', ''), '"', ''))`;

const QUERIES = [
  { metric: "lead_source", sql: `SELECT BUILDING_ID, EVENT_DATETIME::DATE AS DAY, COALESCE(${CLEAN_SOURCE}, 'Unknown') AS DIM, COUNT(*) AS N, 0 AS TOTAL
      FROM RISE8_DATA.DA.PROSPECT_EVENTS_RISE8
      WHERE BUILDING_ID IS NOT NULL AND EVENT_DATETIME IS NOT NULL AND EVENT_TYPE = 'prospect' GROUP BY 1,2,3` },
  { metric: "channel", sql: `SELECT BUILDING_ID, EVENT_DATETIME::DATE AS DAY, COALESCE(CHANNEL,'Unknown') AS DIM, COUNT(*) AS N, 0 AS TOTAL
      FROM RISE8_DATA.DA.PROSPECT_EVENTS_RISE8
      WHERE BUILDING_ID IS NOT NULL AND EVENT_DATETIME IS NOT NULL GROUP BY 1,2,3` },
  { metric: "ai_booked", sql: `SELECT BUILDING_ID, EVENT_DATETIME::DATE AS DAY, IFF(IS_AI_BOOKED,'ai','human') AS DIM, COUNT(*) AS N, 0 AS TOTAL
      FROM RISE8_DATA.DA.PROSPECT_EVENTS_RISE8
      WHERE BUILDING_ID IS NOT NULL AND EVENT_DATETIME IS NOT NULL AND IS_AI_BOOKED IS NOT NULL GROUP BY 1,2,3` },
  { metric: "after_hours", sql: `SELECT BUILDING_ID, EVENT_DATETIME::DATE AS DAY, IFF(IS_AFTER_HOURS,'after_hours','business_hours') AS DIM, COUNT(*) AS N, 0 AS TOTAL
      FROM RISE8_DATA.DA.PROSPECT_EVENTS_RISE8
      WHERE BUILDING_ID IS NOT NULL AND EVENT_DATETIME IS NOT NULL AND IS_AFTER_HOURS IS NOT NULL GROUP BY 1,2,3` },
  { metric: "tour_type", sql: `SELECT BUILDING_ID, EVENT_DATETIME::DATE AS DAY, TOUR_TYPE_STANDARDIZED AS DIM, COUNT(*) AS N, 0 AS TOTAL
      FROM RISE8_DATA.DA.PROSPECT_EVENTS_RISE8
      WHERE BUILDING_ID IS NOT NULL AND EVENT_DATETIME IS NOT NULL AND TOUR_TYPE_STANDARDIZED IS NOT NULL GROUP BY 1,2,3` },
  { metric: "cancel_reason", sql: `SELECT BUILDING_ID, EVENT_DATETIME::DATE AS DAY, CANCELLATION_REASON AS DIM, COUNT(*) AS N, 0 AS TOTAL
      FROM RISE8_DATA.DA.PROSPECT_EVENTS_RISE8
      WHERE BUILDING_ID IS NOT NULL AND EVENT_DATETIME IS NOT NULL AND CANCELLATION_REASON IS NOT NULL
        AND EVENT_TYPE = 'prospect_canceled' GROUP BY 1,2,3` },
  { metric: "voice_answered", sql: `SELECT ELISE_PROPERTY_ID AS BUILDING_ID, EVENT_DATETIME::DATE AS DAY, COALESCE(ANSWERED_TYPE,'unanswered') AS DIM, COUNT(*) AS N, COALESCE(SUM(CALL_DURATION_SEC),0) AS TOTAL
      FROM RISE8_DATA.DA.VOICE_CALLS_RISE8
      WHERE ELISE_PROPERTY_ID IS NOT NULL AND EVENT_DATETIME IS NOT NULL GROUP BY 1,2,3` },
  { metric: "voice_after_hours", sql: `SELECT ELISE_PROPERTY_ID AS BUILDING_ID, EVENT_DATETIME::DATE AS DAY, IFF(AFTER_HOURS,'after_hours','business_hours') AS DIM, COUNT(*) AS N, 0 AS TOTAL
      FROM RISE8_DATA.DA.VOICE_CALLS_RISE8
      WHERE ELISE_PROPERTY_ID IS NOT NULL AND EVENT_DATETIME IS NOT NULL AND AFTER_HOURS IS NOT NULL GROUP BY 1,2,3` },
  { metric: "voice_transfer", sql: `SELECT ELISE_PROPERTY_ID AS BUILDING_ID, EVENT_DATETIME::DATE AS DAY, TRANSFER_REASON AS DIM, COUNT(*) AS N, 0 AS TOTAL
      FROM RISE8_DATA.DA.VOICE_CALLS_RISE8
      WHERE ELISE_PROPERTY_ID IS NOT NULL AND EVENT_DATETIME IS NOT NULL AND TRANSFER_REASON IS NOT NULL GROUP BY 1,2,3` },
  { metric: "handoff_reason", sql: `SELECT ELISE_PROPERTY_ID AS BUILDING_ID, CREATED_AT::DATE AS DAY, COALESCE(NULLIF(${CLEAN_HANDOFF},''),'unspecified') AS DIM, COUNT(*) AS N, 0 AS TOTAL
      FROM RISE8_DATA.DA.HANDOFFS_RISE8
      WHERE ELISE_PROPERTY_ID IS NOT NULL AND CREATED_AT IS NOT NULL GROUP BY 1,2,3` },
  { metric: "task_type", sql: `SELECT ELISE_PROPERTY_ID AS BUILDING_ID, TRIGGER_TIME::DATE AS DAY, TASK_TYPE AS DIM, COUNT(*) AS N, COUNT_IF(RESOLVED) AS TOTAL
      FROM RISE8_DATA.DA.TASKS_RISE8
      WHERE ELISE_PROPERTY_ID IS NOT NULL AND TRIGGER_TIME IS NOT NULL AND TASK_TYPE IS NOT NULL GROUP BY 1,2,3` },
];

const ymd = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

snowflake.configure({ logLevel: "ERROR" });
const conn = snowflake.createConnection({
  account: process.env.SNOWFLAKE_ACCOUNT, username: process.env.SNOWFLAKE_USER,
  password: process.env.SNOWFLAKE_PASSWORD, warehouse: process.env.SNOWFLAKE_WAREHOUSE,
  database: process.env.SNOWFLAKE_DATABASE ?? "RISE8_DATA",
  schema: process.env.SNOWFLAKE_SCHEMA ?? "DA", role: process.env.SNOWFLAKE_ROLE,
});
const q = (sqlText) => new Promise((res, rej) =>
  conn.execute({ sqlText, complete: (e, _s, rows) => (e ? rej(e) : res(rows ?? [])) }));
await new Promise((res, rej) => conn.connect((e) => (e ? rej(e) : res())));

const merged = new Map();
let skipped = 0;
try {
  for (const { metric, sql } of QUERIES) {
    const raw = await q(sql);
    for (const r of raw) {
      const code = buildingMap[String(r.BUILDING_ID)];
      if (!code) { skipped++; continue; }
      const day = ymd(r.DAY);
      const dimension = String(r.DIM ?? "Unknown").slice(0, 120);
      const key = `${code}|${day}|${metric}|${dimension}`;
      const prev = merged.get(key);
      if (prev) { prev.n += Number(r.N ?? 0); prev.total += Number(r.TOTAL ?? 0); }
      else merged.set(key, { code, day, metric, dimension, n: Number(r.N ?? 0), total: Number(r.TOTAL ?? 0) });
    }
    console.log(`  ${metric}: ${raw.length} raw rows`);
  }
} finally { conn.destroy(() => {}); }

const rows = [...merged.values()];
console.log(`\n${rows.length} merged rows, ${skipped} skipped (unmapped buildings)`);

const sql = neon(process.env.DATABASE_URL);
const CHUNK = 400;
for (let i = 0; i < rows.length; i += CHUNK) {
  const chunk = rows.slice(i, i + CHUNK);
  const values = [];
  const params = [];
  chunk.forEach((r, j) => {
    const b = j * 6;
    values.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6})`);
    params.push(r.code, r.day, r.metric, r.dimension, r.n, r.total);
  });
  await sql.query(
    `insert into elise_metric_daily (code, day, metric, dimension, n, total)
     values ${values.join(",")}
     on conflict (code, day, metric, dimension) do update set n = excluded.n, total = excluded.total`,
    params,
  );
}
console.log(`upserted ${rows.length} rows into elise_metric_daily.`);
