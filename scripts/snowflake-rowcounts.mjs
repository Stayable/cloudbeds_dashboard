// Read-only: row count + date span + per-property coverage for every view in
// the EliseAI share. Counts and MIN/MAX dates ONLY — no row data, no PII.
// Tells us which of the 30 shared views are actually populated for Stayable
// (an empty view is not worth building a dashboard section on).
//   node scripts/snowflake-rowcounts.mjs
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
const q = (sqlText) => new Promise((res, rej) =>
  conn.execute({ sqlText, complete: (e, _s, rows) => (e ? rej(e) : res(rows)) }));
await new Promise((res, rej) => conn.connect((e) => (e ? rej(e) : res())));

try {
  const cols = await q(`
    SELECT TABLE_NAME, COLUMN_NAME FROM RISE8_DATA.INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'DA' ORDER BY TABLE_NAME, ORDINAL_POSITION`);
  const byView = {};
  for (const r of cols) (byView[r.TABLE_NAME] ??= []).push(r.COLUMN_NAME);

  // Prefer a real event/created timestamp over UPDATED_AT (which is sync time).
  const DATE_PREF = [
    "EVENT_DATETIME", "TIME_CREATED", "CREATED_AT", "DATE_CREATED", "TRIGGER_TIME",
    "PROSPECT_CREATED_TIME", "START_TIME", "SCHEDULED_TIME", "TIME_SENT", "UPDATED_AT",
  ];
  const PROP_PREF = ["BUILDING_ID", "ELISE_PROPERTY_ID", "BUILDING_NAME", "PROPERTY_CODE"];

  const out = [];
  for (const view of Object.keys(byView).sort()) {
    const c = byView[view];
    const dateCol = DATE_PREF.find((d) => c.includes(d));
    const propCol = PROP_PREF.find((p) => c.includes(p));
    const parts = ["COUNT(*) AS N"];
    if (dateCol) parts.push(`MIN("${dateCol}")::string AS MIND`, `MAX("${dateCol}")::string AS MAXD`);
    if (propCol) parts.push(`COUNT(DISTINCT "${propCol}") AS NPROP`);
    try {
      const [r] = await q(`SELECT ${parts.join(", ")} FROM RISE8_DATA.DA."${view}"`);
      out.push({
        view: view.replace(/_RISE8$/, ""),
        rows: Number(r.N),
        props: r.NPROP == null ? "" : Number(r.NPROP),
        dateCol: dateCol ?? "—",
        from: (r.MIND ?? "").slice(0, 10),
        to: (r.MAXD ?? "").slice(0, 10),
      });
    } catch (e) {
      out.push({ view, rows: -1, props: "", dateCol: "ERROR", from: String(e.message).slice(0, 40), to: "" });
    }
  }
  out.sort((a, b) => b.rows - a.rows);
  console.table(out);
  console.log(`populated: ${out.filter((r) => r.rows > 0).length} / ${out.length} views`);
} finally {
  conn.destroy(() => {});
}
