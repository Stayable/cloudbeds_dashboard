// Read-only probe: confirm the in-house overlap query for lease mix.
// No guest scope. Davenport (318197) only.  Run: node scripts/probe-lease-query.mjs
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

// dump dataset 3 column names so we can see exact date/room columns
const detail = await (await fetch(`${DI}/datasets/3`, { headers: H })).json();
const cols = (detail.cdfs ?? []).flatMap((g) => (g.cdfs ?? []).map((c) => c.column));
console.log("date-ish:", cols.filter((c) => /date|arriv|depart|check/i.test(c)).join(", "));
console.log("room-ish:", cols.filter((c) => /room|count|night/i.test(c)).join(", "));
console.log("status-ish:", cols.filter((c) => /status|state|stage/i.test(c)).join(", "));

// helper: run a grouped query and print index/measure
async function runQuery(label, body) {
  const r = await fetch(`${DI}/reports/query/data?mode=Run`, {
    method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const j = await r.json();
  console.log(`\n=== ${label} (status ${r.status}) ===`);
  if (r.status !== 200) { console.log(JSON.stringify(j).slice(0, 600)); return j; }
  return j;
}

// STEP 1: discover the reservation_status column + its distinct values, with
// summed room_count per status (overlap-filtered, same bounds as lease mix).
const overlap = [
  { cdf: { column: "checkin_date" }, operator: "less_than_or_equal", value: asOf },
  { cdf: { column: "checkout_date" }, operator: "greater_than", value: asOf },
];
for (const statusCol of ["reservation_status", "status", "stay_status"]) {
  if (!cols.includes(statusCol)) { console.log(`\n[skip] column '${statusCol}' not in dataset 3`); continue; }
  const j = await runQuery(`group by ${statusCol}`, {
    property_ids: [Number(PROP)], dataset_id: 3,
    columns: [{ cdf: { column: "room_count" } }],
    group_rows: [{ cdf: { column: statusCol } }],
    filters: { and: overlap },
    settings: { totals: false, details: true },
  });
  if (j && Array.isArray(j.index)) {
    const rooms = j.records?.room_count ?? [];
    const byStatus = {};
    for (let i = 0; i < j.index.length; i++) {
      const s = Array.isArray(j.index[i]) ? String(j.index[i][0] ?? "") : String(j.index[i] ?? "");
      const n = typeof rooms[i] === "number" ? rooms[i] : 0;
      byStatus[s] = (byStatus[s] ?? 0) + n;
    }
    console.log(`distinct ${statusCol} -> summed room_count:`, JSON.stringify(byStatus, null, 2));
    console.log("total room_count:", Object.values(byStatus).reduce((a, b) => a + b, 0));
  }
}

// classify a (possibly comma-joined) rate-plan string into lease buckets,
// mirroring lib/lease.ts classifyRatePlan (monthly precedence).
function classify(plan) {
  const s = (plan ?? "").toLowerCase();
  if (["monthly lease", "long term", "discounted long term"].some((k) => s.includes(k))) return "monthly";
  if (["weekly lease", "weekly rate", "discounted weekly", "employee weekly"].some((k) => s.includes(k))) return "weekly";
  return "transient";
}
function mixOf(j) {
  const rooms = j.records?.room_count ?? [];
  const m = { monthly: 0, weekly: 0, transient: 0, total: 0 };
  for (let i = 0; i < (j.index?.length ?? 0); i++) {
    const plan = Array.isArray(j.index[i]) ? String(j.index[i][0] ?? "") : String(j.index[i] ?? "");
    const n = typeof rooms[i] === "number" ? rooms[i] : 0;
    m[classify(plan)] += n; m.total += n;
  }
  return m;
}

// STEP 2: confirm the status filter operator + quantify the delta.
const inHouseFilter = { cdf: { column: "reservation_status" }, operator: "equals", value: "In-House" };
const planQuery = (filters) => ({
  property_ids: [Number(PROP)], dataset_id: 3,
  columns: [{ cdf: { column: "room_count" } }],
  group_rows: [{ cdf: { column: "public_rate_plan" } }],
  filters: { and: filters },
  settings: { totals: false, details: true },
});
const jWithout = await runQuery("WITHOUT status filter (date overlap only)", planQuery(overlap));
console.log("WITHOUT-filter mix:", JSON.stringify(mixOf(jWithout)));
const jWith = await runQuery("WITH reservation_status=In-House", planQuery([...overlap, inHouseFilter]));
console.log("WITH-filter mix:", JSON.stringify(mixOf(jWith)));

// Verified working overlap query (confirmed live 2026-06-24):
//  - bounds use `checkin_date`/`checkout_date` (NOT check_in_date/check_out_date).
//  - measure `room_count` requested bare; `modifier:"sum"` is rejected ("Unknown field").
//  - settings.details MUST be true: details:false drops the measure (empty records).
//    The response returns index[i]=[ratePlanName] parallel to records.room_count[i].
const body = {
  property_ids: [Number(PROP)],
  dataset_id: 3,
  columns: [{ cdf: { column: "room_count" } }],
  group_rows: [{ cdf: { column: "public_rate_plan" } }],
  filters: {
    and: [
      { cdf: { column: "checkin_date" }, operator: "less_than_or_equal", value: asOf },
      { cdf: { column: "checkout_date" }, operator: "greater_than", value: asOf },
    ],
  },
  settings: { totals: false, details: true },
};
const r = await fetch(`${DI}/reports/query/data?mode=Run`, {
  method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify(body),
});
console.log("query status", r.status);
console.log(JSON.stringify(await r.json(), null, 2).slice(0, 2000));
