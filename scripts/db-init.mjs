// One-shot migration: create the `submissions` table (spec §6a).
// Idempotent (CREATE TABLE IF NOT EXISTS). Uses the DIRECT (unpooled) Neon URL.
// Run:  node scripts/db-init.mjs
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

// load .env.local (no dep)
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) { console.error("No DATABASE_URL(_UNPOOLED) in .env.local"); process.exit(1); }

const sql = neon(url);

await sql`
  create table if not exists submissions (
    id          bigserial primary key,
    created_at  timestamptz not null default now(),
    source      text not null,
    name        text,
    role        text,
    team        text,
    metrics     jsonb,
    notes       text
  )
`;

const cols = await sql`
  select column_name, data_type
  from information_schema.columns
  where table_name = 'submissions'
  order by ordinal_position
`;
console.log("submissions table ready:");
for (const c of cols) console.log(`  ${c.column_name}  ${c.data_type}`);
