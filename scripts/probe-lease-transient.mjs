// Read-only probe: can we classify Lease vs Transient WITHOUT guest PII?
// Looks at the Data Insights Reservations dataset for fields like rate_plan,
// market_segment, reservation_type, length_of_stay — and dumps distinct values
// so we can see whether monthly/weekly leases separate cleanly from transients.
//
// No guest scope used. No names requested. Davenport (318197) only.
// Run:  node scripts/probe-lease-transient.mjs
import { readFileSync } from "node:fs";

// --- load .env.local (no dep) ---
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}

const KEY = process.env.CLOUDBEDS_API_KEY_DP;
const PROP = "318197"; // Davenport API propertyID
if (!KEY) { console.error("No CLOUDBEDS_API_KEY_DP in .env.local"); process.exit(1); }

const DI = "https://api.cloudbeds.com/datainsights/v1.1";
const H = { Authorization: `Bearer ${KEY}`, Accept: "application/json", "X-PROPERTY-ID": PROP };

async function j(url, opts = {}) {
  const r = await fetch(url, { headers: H, ...opts });
  const t = await r.text();
  try { return { status: r.status, body: JSON.parse(t) }; }
  catch { return { status: r.status, body: t }; }
}

// 1) datasets
const ds = await j(`${DI}/datasets`);
const list = Array.isArray(ds.body) ? ds.body : ds.body?.data ?? [];
console.log("=== datasets ===");
for (const d of list) console.log(`  id ${d.id}: ${d.name}`);

// 2) find a reservations-ish dataset; dump its columns
const resv = list.find((d) => /reserv/i.test(d.name || "")) || list.find((d) => d.id === 3 || d.id === 2);
if (!resv) { console.log("No reservations dataset visible — stopping."); process.exit(0); }
console.log(`\n=== columns of dataset ${resv.id} (${resv.name}) ===`);
const detail = await j(`${DI}/datasets/${resv.id}`);
const cats = detail.body?.cdfs ?? [];
const cols = [];
for (const g of cats) {
  for (const c of g.cdfs ?? []) {
    cols.push(c.column);
    if (/segment|rate|plan|type|length|stay|nights|status|source|channel|lease|term/i.test(`${c.column} ${c.name}`)) {
      console.log(`  [${g.category}] ${c.column}  (${c.name}) kind=${c.kind}`);
    }
  }
}

// 3) group + count reservations by each real classifier column.
// room_nights_count carried as a summed measure so we see volume per bucket.
const candidates = [
  "market_segment_names", "market_segment_group_names",
  "public_rate_plan", "private_rate_plan", "channel_rate_plan",
  "reservation_source_category", "room_type_categories",
].filter((c) => cols.includes(c));
console.log(`\nGrouping by: ${candidates.join(", ")}`);

for (const col of candidates) {
  const body = {
    property_ids: [Number(PROP)],
    dataset_id: resv.id,
    columns: [],
    group_rows: [{ cdf: { column: col } }],
    settings: { totals: false, details: false },
  };
  const q = await j(`${DI}/reports/query/data?mode=Run`, {
    method: "POST",
    headers: { ...H, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  console.log(`\n--- group by ${col} (status ${q.status}) ---`);
  const idx = q.body?.index, rec = q.body?.records;
  if (Array.isArray(idx)) {
    for (const r of idx) {
      const key = Array.isArray(r) ? r[0] : r;
      const v = rec?.[key]?.room_nights_count?.aggregated ?? "";
      console.log(`  ${key}  ·  room-nights=${v}`);
    }
  } else console.log(JSON.stringify(q.body).slice(0, 800));
}
