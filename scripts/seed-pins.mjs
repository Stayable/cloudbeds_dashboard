// Seed/verify the Neon `dashboard_pins` table — Neon is the sole source of PINs
// (no env fallback). Lists current rows, upserts any pin passed as KEY=VALUE
// args (e.g. `node scripts/seed-pins.mjs ops=OPERATION`), then re-lists.
// Read-only if no args. Uses the DIRECT (unpooled) Neon URL.
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) { console.error("No DATABASE_URL(_UNPOOLED) in .env.local"); process.exit(1); }
const sql = neon(url);

const LEVELS = ["exec", "crystal", "monica", "bea", "ops"]; // login levels (base is public)

async function list(label) {
  const rows = await sql`select level, pin, updated_at from dashboard_pins order by level`;
  const have = new Set(rows.map((r) => r.level));
  console.log(`\n${label}:`);
  for (const r of rows) console.log(`  ${r.level.padEnd(8)} ${String(r.pin).padEnd(12)} ${r.updated_at.toISOString?.() ?? r.updated_at}`);
  const missing = LEVELS.filter((l) => !have.has(l));
  if (missing.length) console.log(`  MISSING (cannot log in): ${missing.join(", ")}`);
}

await list("BEFORE");

for (const arg of process.argv.slice(2)) {
  const [level, ...rest] = arg.split("=");
  const pin = rest.join("=");
  if (!LEVELS.includes(level) || !pin) { console.error(`skip bad arg: ${arg}`); continue; }
  await sql`
    insert into dashboard_pins (level, pin, updated_at) values (${level}, ${pin}, now())
    on conflict (level) do update set pin = excluded.pin, updated_at = now()
  `;
  console.log(`upserted ${level} = ${pin}`);
}

if (process.argv.length > 2) await list("AFTER");
