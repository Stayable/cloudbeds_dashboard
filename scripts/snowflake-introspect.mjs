// Read-only introspection of the EliseAI Snowflake share: list ALL views and
// their columns in RISE8_DATA.DA, so we can see what's available vs. surfaced.
// Metadata only (no row data / no PII). Creds from .env.local. Run:
//   node scripts/snowflake-introspect.mjs
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
    SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE
    FROM RISE8_DATA.INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'DA'
    ORDER BY TABLE_NAME, ORDINAL_POSITION`);
  const byView = {};
  for (const r of cols) (byView[r.TABLE_NAME] ??= []).push(`${r.COLUMN_NAME}`);
  const names = Object.keys(byView).sort();
  console.log(`\n${names.length} views in RISE8_DATA.DA:\n`);
  for (const v of names) {
    console.log(`• ${v}  (${byView[v].length} cols)`);
    console.log(`    ${byView[v].join(", ")}`);
  }
} catch (e) {
  console.error("INTROSPECT ERROR:", e.message || e); process.exitCode = 1;
} finally { conn.destroy(() => {}); }
