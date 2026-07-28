// Apply config `sellableOverrides` retroactively to already-banked days.
//
// Going forward, buildRowInputs takes max(Cloudbeds block-nights, override) on
// every fresh derivation, and the nightly restatement pass repairs the trailing
// window. But the restatement window is only ~31 days, so months of banked
// history keep the understated figure — Jacksonville North reads OOO 20 and
// Available 89 for every day since it reopened on 2026-04-01, at a property that
// can sell about 20 rooms. This is a pure arithmetic repair over the store: no
// Cloudbeds call, so it can be run without the per-property API key.
//
// Only ever RAISES ooo (never lowers it) and only where the override implies
// more than what is banked, so a real Cloudbeds block set always wins. Marks the
// touched rows `ooo_source = 'override'` so the report badges them.
//
// Idempotent. Dry-run by default.
//   node scripts/apply-ooo-overrides.mjs [--apply]
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}
const sql = neon(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL);
const APPLY = process.argv.includes("--apply");

// Mirrors config/properties.ts `sellableOverrides`. Kept literal so this
// one-shot needs no TS build; update both if the config changes.
const OVERRIDES = {
  JN: [{ from: "2026-04-01", to: null, rooms: 20 }],
};

const rows = await sql`
  select property_code, to_char(stay_date,'YYYY-MM-DD') as stay_date,
         inventory, ooo, transient_nights, lease_nights, other_blocks, is_final
  from report_daily_snapshot
  where property_code = any(${Object.keys(OVERRIDES)})
  order by property_code, stay_date`;

const planned = [];
for (const r of rows) {
  const o = (OVERRIDES[r.property_code] ?? []).find(
    (w) => r.stay_date >= w.from && (w.to == null || r.stay_date <= w.to),
  );
  if (!o || r.inventory <= 0) continue;
  const implied = Math.max(0, r.inventory - o.rooms);
  // `<` not `<=`: when the banked figure already EQUALS the override (e.g. days
  // whose counts came from Monica's workbook, which carries the same 107), the
  // value still originates from the override, so stamp the provenance rather
  // than leaving it labelled Cloudbeds-sourced.
  if (implied < r.ooo) continue;
  planned.push({ ...r, implied, availableBefore: r.inventory - (r.transient_nights + r.lease_nights + r.other_blocks) - r.ooo });
}

const finalRows = planned.filter((p) => p.is_final);
const open = planned.filter((p) => !p.is_final);

console.log(`${rows.length} rows scanned for ${Object.keys(OVERRIDES).join(", ")}.`);
console.log(`${planned.length} days would have OOO raised (${finalRows.length} already finalized — skipped).`);
if (open.length) {
  const first = open[0];
  const last = open[open.length - 1];
  const avgAvail = open.reduce((a, p) => a + p.availableBefore, 0) / open.length;
  console.log(`  ${first.property_code} ${first.stay_date} .. ${last.stay_date}`);
  console.log(`  OOO ${first.ooo} -> ${first.implied} per day; average Available drops from ${avgAvail.toFixed(1)} rooms to about ${(first.inventory - 20).toFixed(0) === "107" ? "0-2" : "the sellable remainder"}`);
}

if (!APPLY) {
  console.log("\nDry run — nothing written. Re-run with --apply.");
  process.exit(0);
}

let n = 0;
const CHUNK = 500;
for (let i = 0; i < open.length; i += CHUNK) {
  const chunk = open.slice(i, i + CHUNK);
  const values = [];
  const params = [];
  chunk.forEach((r, j) => {
    const b = j * 3;
    values.push(`($${b + 1}, $${b + 2}::date, $${b + 3}::int)`);
    params.push(r.property_code, r.stay_date, r.implied);
  });
  await sql.query(
    `update report_daily_snapshot s
       set ooo = v.ooo, ooo_source = 'override', updated_at = now()
     from (values ${values.join(",")}) as v(code, day, ooo)
     where s.property_code = v.code and s.stay_date = v.day and s.is_final = false`,
    params,
  );
  n += chunk.length;
}
console.log(`\nRaised OOO on ${n} rows (ooo_source = 'override').`);
