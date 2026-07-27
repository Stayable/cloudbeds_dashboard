// Read-only: distinct value cardinality for the dimensions we intend to surface.
// COUNTS ONLY — no PII columns selected.
import { readFileSync } from "node:fs";
import snowflake from "snowflake-sdk";
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}
snowflake.configure({ logLevel: "ERROR" });
const conn = snowflake.createConnection({
  account: process.env.SNOWFLAKE_ACCOUNT, username: process.env.SNOWFLAKE_USER,
  password: process.env.SNOWFLAKE_PASSWORD, warehouse: process.env.SNOWFLAKE_WAREHOUSE,
  database: process.env.SNOWFLAKE_DATABASE, schema: process.env.SNOWFLAKE_SCHEMA, role: process.env.SNOWFLAKE_ROLE,
});
const q = (s) => new Promise((res, rej) => conn.execute({ sqlText: s, complete: (e, _x, r) => (e ? rej(e) : res(r)) }));
await new Promise((res, rej) => conn.connect((e) => (e ? rej(e) : res())));

const probes = [
  ["PROSPECT_EVENTS", "EVENT_TYPE"], ["PROSPECT_EVENTS", "MARKETING_SOURCE"],
  ["PROSPECT_EVENTS", "CHANNEL"], ["PROSPECT_EVENTS", "IS_AI_BOOKED"],
  ["PROSPECT_EVENTS", "IS_AFTER_HOURS"], ["PROSPECT_EVENTS", "TOUR_TYPE_STANDARDIZED"],
  ["PROSPECT_EVENTS", "CANCELLATION_REASON"],
  ["PROSPECTS", "PROSPECT_STATUS"], ["PROSPECTS", "PRIMARY_LEAD_SOURCE"],
  ["PROSPECTS", "PROSPECT_CANCELLATION_REASON"], ["PROSPECTS", "LEAD_SCORE_CATEGORY"],
  ["CALENDAR_EVENTS", "STATUS"], ["CALENDAR_EVENTS", "TOUR_TYPE"], ["CALENDAR_EVENTS", "EVENT_TYPE"],
  ["VOICE_CALLS", "DIRECTION"], ["VOICE_CALLS", "ANSWERED_TYPE"], ["VOICE_CALLS", "TYPE"],
  ["VOICE_CALLS", "CALL_COMPLETED_STATUS"], ["VOICE_CALLS", "TRANSFER_REASON"],
  ["VOICE_CALLS", "AFTER_HOURS"], ["VOICE_CALLS", "IS_MAINTENANCE"], ["VOICE_CALLS", "CALL_TRANSFERRED"],
  ["HANDOFFS", "TYPE"], ["HANDOFFS", "HANDOFF_REASONS"], ["HANDOFFS", "DOMAIN"],
  ["TASKS", "TASK_TYPE"], ["TASKS", "RESOLVED"], ["TASKS", "RESOLUTION_TYPE"], ["TASKS", "DOMAIN"],
  ["RESIDENTS", "RESIDENT_STATUS"], ["RESIDENTS", "OCCUPANT_TYPE"],
];
try {
  for (const [v, c] of probes) {
    try {
      const rows = await q(`SELECT "${c}"::string AS V, COUNT(*) AS N FROM RISE8_DATA.DA."${v}_RISE8"
        GROUP BY 1 ORDER BY N DESC LIMIT 12`);
      const tot = rows.reduce((s, r) => s + Number(r.N), 0);
      console.log(`\n${v}.${c}  (${rows.length}${rows.length === 12 ? "+" : ""} distinct, ${tot} rows shown)`);
      for (const r of rows) console.log(`   ${String(r.V ?? "NULL").slice(0, 60).padEnd(60)} ${r.N}`);
    } catch (e) { console.log(`\n${v}.${c}  ERROR ${String(e.message).slice(0, 60)}`); }
  }
} finally { conn.destroy(() => {}); }
