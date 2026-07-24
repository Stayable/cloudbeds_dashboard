// Probe: list ALL Data Insights dataset-1 transaction_type values (with summed
// debit/credit) for Davenport over a date range — to verify our revenue pull
// (transaction_type = "Room Rate" only) captures Monica's "rate and revenue"
// and that no distinct "Room Revenue" type is being materially dropped.
//
// Usage:  node scripts/probe-transaction-types.mjs [start] [end]
// Reads CLOUDBEDS_API_KEY_DP from .env.local. Read-only, no writes.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = {};
for (const line of readFileSync(join(root, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const KEY = env.CLOUDBEDS_API_KEY_DP;
if (!KEY) throw new Error("CLOUDBEDS_API_KEY_DP missing from .env.local");

const DI_BASE = "https://api.cloudbeds.com/datainsights/v1.1";
const PROPERTY = "318197"; // Davenport apiPropertyId
const start = process.argv[2] ?? "2026-07-01";
const end = process.argv[3] ?? "2026-07-19";

const body = {
  property_ids: [Number(PROPERTY)],
  dataset_id: 1,
  columns: [{ cdf: { column: "debit_amount" } }, { cdf: { column: "credit_amount" } }],
  group_rows: [{ cdf: { column: "transaction_type" } }],
  filters: {
    and: [
      { cdf: { column: "service_date" }, operator: "greater_than_or_equal", value: start },
      { cdf: { column: "service_date" }, operator: "less_than_or_equal", value: end },
    ],
  },
  settings: { totals: false, details: true },
};

const res = await fetch(`${DI_BASE}/reports/query/data?mode=Run`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${KEY}`,
    "X-PROPERTY-ID": PROPERTY,
    "Content-Type": "application/json",
    Accept: "application/json",
  },
  body: JSON.stringify(body),
});
const text = await res.text();
if (!res.ok) {
  console.error(`HTTP ${res.status}\n${text}`);
  process.exit(1);
}
const p = JSON.parse(text);
const idx = (p.index ?? []).map((r) => (Array.isArray(r) ? r[0] : r));
const debit = p.records?.debit_amount ?? [];
const credit = p.records?.credit_amount ?? [];

// Aggregate the detail rows by transaction_type label.
const agg = new Map();
idx.forEach((t, i) => {
  const key = String(t);
  const cur = agg.get(key) ?? { d: 0, c: 0, n: 0 };
  cur.d += debit[i] ?? 0;
  cur.c += credit[i] ?? 0;
  cur.n += 1;
  agg.set(key, cur);
});

console.log(`Davenport (318197) dataset-1 transaction_type  ${start} → ${end}\n`);
console.log(`${"transaction_type".padEnd(28)}${"debit".padStart(15)}${"credit".padStart(15)}${"rows".padStart(7)}`);
console.log("-".repeat(65));
const rows = [...agg.entries()].map(([t, v]) => ({ t, ...v })).sort((a, b) => b.d - a.d);
let totalDebit = 0;
for (const r of rows) {
  totalDebit += r.d;
  console.log(
    `${r.t.padEnd(28)}${r.d.toLocaleString(undefined, { minimumFractionDigits: 2 }).padStart(15)}${r.c.toLocaleString(undefined, { minimumFractionDigits: 2 }).padStart(15)}${String(r.n).padStart(7)}`,
  );
}
console.log("-".repeat(65));
const roomRate = agg.get("Room Rate")?.d ?? 0;
const roomRev = agg.get("Room Revenue")?.d ?? 0;
console.log(`All-types debit  = ${totalDebit.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
console.log(`"Room Rate"      = ${roomRate.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
console.log(`"Room Revenue"   = ${roomRev.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
console.log(`rate+revenue     = ${(roomRate + roomRev).toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
