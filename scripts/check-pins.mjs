// Which dashboard levels can actually log in? PINs live ONLY in the Neon
// `dashboard_pins` table (lib/pins.ts) — there is NO env-var fallback, so a
// level with no row simply cannot log in. Reports presence and length; NEVER
// prints a PIN value. Run: node scripts/check-pins.mjs
import { readFileSync } from "node:fs";
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}
const { neon } = await import("@neondatabase/serverless");
const { ALL_LEVELS } = await import("../lib/auth.ts").catch(() => ({ ALL_LEVELS: null }));

const sql = neon(process.env.DATABASE_URL);
const rows = await sql`select level, length(pin) as len from dashboard_pins order by level`;
const have = new Set(rows.map((r) => String(r.level)));

console.log("PIN rows in Neon (values never printed):");
for (const r of rows) console.log(`  ${String(r.level).padEnd(9)} length ${r.len}`);

const expected = ALL_LEVELS ?? ["base", "exec", "crystal", "monica", "bea", "ops", "elise"];
const missing = expected.filter((l) => !have.has(l));
console.log(missing.length ? `\nMISSING (cannot log in): ${missing.join(", ")}` : "\nEvery level has a PIN.");
console.log(have.has("bea") ? "BEA: present -> Bea can reach /bea." : "BEA: MISSING -> Bea cannot log in; seed it.");
