// Read-only probe: can we get PER-ROOM occupancy (which rooms are occupied today)
// WITHOUT any guest scope? Looks at DI Reservations dataset 3 for a room-identifier
// column, then groups in-house reservations by it. Davenport (318197) only.
// Run:  node scripts/probe-room-occupancy.mjs
import { readFileSync } from "node:fs";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}
const KEY = process.env.CLOUDBEDS_API_KEY_DP;
const PROP = "318197";
if (!KEY) { console.error("No CLOUDBEDS_API_KEY_DP"); process.exit(1); }

const DI = "https://api.cloudbeds.com/datainsights/v1.1";
const H = { Authorization: `Bearer ${KEY}`, Accept: "application/json", "X-PROPERTY-ID": PROP, "Content-Type": "application/json" };
const today = new Date().toISOString().slice(0, 10);

async function j(url, opts = {}) {
  const r = await fetch(url, { headers: H, ...opts });
  const t = await r.text();
  try { return { status: r.status, body: JSON.parse(t) }; } catch { return { status: r.status, body: t }; }
}

const detail = await j(`${DI}/datasets/3`);
const cols = detail.body?.cdfs ?? detail.body?.columns ?? detail.body?.data?.cdfs ?? [];
const roomCols = cols
  .map((c) => c.column ?? c.name ?? c.id)
  .filter((n) => typeof n === "string" && /room|unit/i.test(n));
console.log("room-ish columns in dataset 3:", roomCols);

for (const col of roomCols) {
  const body = {
    property_ids: [Number(PROP)],
    dataset_id: 3,
    columns: [{ cdf: { column: "reservation_id" } }],
    group_rows: [{ cdf: { column: col } }],
    filters: {
      and: [
        { cdf: { column: "checkin_date" }, operator: "less_than_or_equal", value: today },
        { cdf: { column: "checkout_date" }, operator: "greater_than_or_equal", value: today },
        { cdf: { column: "reservation_status" }, operator: "equal_to", value: "In-House" },
      ],
    },
    settings: { totals: false, details: false },
  };
  const res = await j(`${DI}/reports/query/data?mode=Run`, { method: "POST", body: JSON.stringify(body) });
  const recs = res.body?.records ?? {};
  const keys = Object.keys(recs);
  console.log(`\n=== group by ${col} (status In-House, ${today}) HTTP ${res.status} ===`);
  console.log(`  ${keys.length} distinct values; sample:`, keys.slice(0, 12));
}
