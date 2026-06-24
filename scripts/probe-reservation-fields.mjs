// Read-only probe: discover dataset-3 (Reservations) column names for Crystal's
// section-4 aggregates. No guest scope, Davenport (318197) only.
// Run: node scripts/probe-reservation-fields.mjs [asOf]
import { readFileSync } from "node:fs";
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}
const KEY = process.env.CLOUDBEDS_API_KEY_DP;
const PROP = "318197";
const DI = "https://api.cloudbeds.com/datainsights/v1.1";
const H = { Authorization: `Bearer ${KEY}`, "X-PROPERTY-ID": PROP, Accept: "application/json" };
const asOf = process.argv[2] || new Date().toISOString().slice(0, 10);

const detail = await (await fetch(`${DI}/datasets/3`, { headers: H })).json();
const cols = (detail.cdfs ?? []).flatMap((g) => (g.cdfs ?? []).map((c) => ({ column: c.column, type: c.type, name: c.name })));
const show = (label, re) => {
  console.log(`\n## ${label}`);
  for (const c of cols.filter((c) => re.test(c.column) || re.test(c.name ?? ""))) {
    console.log(`  ${c.column}  [${c.type}]  ${c.name ?? ""}`);
  }
};
console.log(`dataset 3 has ${cols.length} columns`);
show("room type", /room.?type|roomtype/i);
show("guest / occupancy count", /guest|adult|child|occup|pax/i);
show("nights", /night/i);
show("rate plan", /rate.?plan|plan/i);
show("status", /status|state/i);
show("currency / totals", /total|grand|balance|paid|due|amount|revenue|price|rate$/i);

// Try aggregate queries for the currency + count columns we want to SUM.
async function runQuery(label, body) {
  const r = await fetch(`${DI}/reports/query/data?mode=Run`, {
    method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const j = await r.json();
  console.log(`\n=== ${label} (status ${r.status}) ===`);
  if (r.status !== 200) { console.log(JSON.stringify(j).slice(0, 400)); return null; }
  return j;
}

// Range overlap for a reservations-active-in-range view (last 7d ending asOf).
const start = (() => { const d = new Date(asOf); d.setUTCDate(d.getUTCDate() - 6); return d.toISOString().slice(0, 10); })();
const overlap = [
  { cdf: { column: "checkin_date" }, operator: "less_than_or_equal", value: asOf },
  { cdf: { column: "checkout_date" }, operator: "greater_than_or_equal", value: start },
];

// Verified-name measure columns to test summing (details:true → parallel arrays).
const candidates = ["room_count", "room_nights_count", "adults_count", "children_count", "guest_count", "grand_total_amount", "reservation_balance_due_amount", "reservation_paid_amount", "room_revenue_total_amount"];
for (const col of candidates) {
  if (!cols.some((c) => c.column === col)) { console.log(`\n[skip] '${col}' not a dataset-3 column`); continue; }
  const j = await runQuery(`sum ${col} grouped by reservation_status`, {
    property_ids: [Number(PROP)], dataset_id: 3,
    columns: [{ cdf: { column: col } }],
    group_rows: [{ cdf: { column: "reservation_status" } }],
    filters: { and: [...overlap, { cdf: { column: "reservation_status" }, operator: "equals", value: "In-House" }] },
    settings: { totals: false, details: true },
  });
  if (j) {
    const arr = j.records?.[col] ?? [];
    const nums = arr.filter((x) => typeof x === "number");
    const sum = nums.reduce((a, b) => a + b, 0);
    console.log(`  rows=${arr.length} numeric=${nums.length} sum(${col})=${sum} sample=${JSON.stringify(arr.slice(0, 3))}`);
  }
}
