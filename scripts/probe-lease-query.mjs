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
