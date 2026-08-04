// Read-only probe: how do we count UNIQUE NAMED GUESTS across the portfolio?
// For an insurance application, so the method has to be defensible.
//
// Establishes, for ONE property:
//   1. DI dataset 2 (Guests) column list — is there a guest master with an id?
//   2. Whether a distinct-count is obtainable, and what row caps apply.
//   3. v1.3 /getGuestList pagination totals (often the cheapest true count).
//
// Prints NO guest names — column metadata, counts and pagination fields only.
// Run: node scripts/probe-guest-count.mjs [CODE]
import { readFileSync } from "node:fs";
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}
const CODE = (process.argv[2] || "DP").toUpperCase();
const API_ID = { DP: "318197", LL: "210972", KE: "210986", KW: "210969", JW: "210987", JN: "206628", SA: "208155", OR: "210971" };
const KEY = process.env[`CLOUDBEDS_API_KEY_${CODE}`];
const PROP = API_ID[CODE];
if (!KEY) { console.error(`no key for ${CODE}`); process.exit(1); }

const V13 = "https://hotels.cloudbeds.com/api/v1.3";
const DI = "https://api.cloudbeds.com/datainsights/v1.1";
const H = { Authorization: `Bearer ${KEY}`, Accept: "application/json" };
const DIH = { ...H, "X-PROPERTY-ID": PROP, "Content-Type": "application/json" };

console.log(`=== ${CODE} (api ${PROP}) ===\n`);

// --- 1. dataset 2 (Guests) columns ------------------------------------------
try {
  const d2 = await (await fetch(`${DI}/datasets/2`, { headers: DIH })).json();
  const cols = (d2.cdfs ?? []).flatMap((g) => (g.cdfs ?? []).map((c) => ({ column: c.column, type: c.type, name: c.name })));
  console.log(`## DI dataset 2 "${d2.name ?? "?"}" — ${cols.length} columns`);
  const want = /guest_id|^id$|full_name|first|last|email|created|checkin|checkout|status|reservation/i;
  for (const c of cols.filter((c) => want.test(c.column))) console.log(`   ${c.column}  [${c.type}]  ${c.name ?? ""}`);
} catch (e) {
  console.log(`## dataset 2 failed: ${e}`);
}

// --- 2. v1.3 /getGuestList pagination totals --------------------------------
// Cheapest possible true count IF the response carries a total.
console.log(`\n## v1.3 /getGuestList pagination`);
for (const qs of ["pageNumber=1&pageSize=1", "pageNumber=1&pageSize=100"]) {
  const r = await fetch(`${V13}/getGuestList?${qs}`, { headers: H });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = null; }
  if (!j) { console.log(`   ${qs} -> http ${r.status}, unparseable`); continue; }
  // Report ONLY structural fields, never row contents.
  const keys = Object.keys(j).filter((k) => k !== "data");
  const meta = {};
  for (const k of keys) if (typeof j[k] !== "object") meta[k] = j[k];
  console.log(`   ${qs} -> http ${r.status} rows=${Array.isArray(j.data) ? j.data.length : "n/a"} meta=${JSON.stringify(meta)}`);
  if (Array.isArray(j.data) && j.data[0]) {
    console.log(`     row field names: ${Object.keys(j.data[0]).join(", ")}`);
  }
}

// --- 3. DI dataset 2 row behaviour: does details:true cap, and is there a count?
console.log(`\n## DI dataset 2 query shapes`);
async function di(label, body) {
  const r = await fetch(`${DI}/reports/query/data?mode=Run`, { method: "POST", headers: DIH, body: JSON.stringify(body) });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = t; }
  if (r.status !== 200) { console.log(`   ${label} -> http ${r.status} ${JSON.stringify(j).slice(0, 200)}`); return null; }
  const idx = Array.isArray(j.index) ? j.index.length : 0;
  console.log(`   ${label} -> 200 indexRows=${idx} aggregated_count=${j.aggregated_count ?? "—"} type=${j.type ?? "—"} recordKeys=${Object.keys(j.records ?? {}).join(",")}`);
  return j;
}

// Group by a guest identifier and see how many distinct groups come back.
await di("group by primary_guest_id (no filter)", {
  property_ids: [Number(PROP)], dataset_id: 2,
  columns: [], group_rows: [{ cdf: { column: "guest_id" } }],
  settings: { totals: false, details: true },
});
await di("group by guest_id w/ reservation_count-ish measure", {
  property_ids: [Number(PROP)], dataset_id: 2,
  columns: [{ cdf: { column: "guest_id" } }], group_rows: [{ cdf: { column: "guest_id" } }],
  settings: { totals: false, details: true },
});
