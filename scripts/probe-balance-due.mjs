// Read-only probe for Bea's "Balance Due" table (per-property tab).
// Two questions this answers empirically:
//   Q1. Per-reservation balance due — how many in-house reservations carry a
//       balance, split lease vs transient? (dataset 3, details:true)
//   Q2. Does lease rent post PERIODICALLY or ACCRUE NIGHTLY? (dataset 1)
//       If nightly, "previous rent due" cannot come from transaction dates —
//       every in-house guest would show yesterday. Decisive for the Due Date
//       column. Measured as: distinct Room Rate service-dates per
//       reservation-room over a trailing window.
//
// Prints NO guest names — counts, room numbers and amounts only, so the output
// is safe to paste. Run: node scripts/probe-balance-due.mjs [CODE] [days]
import { readFileSync } from "node:fs";
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}

const CODE = (process.argv[2] || "LL").toUpperCase();
const DAYS = Number(process.argv[3] || 28);
// apiPropertyId per config/properties.ts (business id -> API id).
const API_ID = { DP: "318197", LL: "210972", KE: "210986", KW: "210969", JW: "210987", JN: "206628", SA: "208155", OR: "210971" };
const KEY = process.env[`CLOUDBEDS_API_KEY_${CODE}`];
const PROP = API_ID[CODE];
if (!KEY || !PROP) { console.error(`No key/propertyId for ${CODE}`); process.exit(1); }

const DI = "https://api.cloudbeds.com/datainsights/v1.1";
const H = { Authorization: `Bearer ${KEY}`, "X-PROPERTY-ID": PROP, "Content-Type": "application/json", Accept: "application/json" };

const ymd = (d) => d.toISOString().slice(0, 10);
const today = new Date();
const asOf = ymd(today);
const shift = (n) => { const d = new Date(today); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };

async function q(body) {
  const r = await fetch(`${DI}/reports/query/data?mode=Run`, { method: "POST", headers: H, body: JSON.stringify(body) });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = t; }
  if (r.status !== 200) return { http: r.status, err: JSON.stringify(j).slice(0, 300) };
  const dims = (Array.isArray(j?.index) ? j.index : []).map((x) => (Array.isArray(x) ? x.map((v) => String(v ?? "")) : [String(x ?? "")]));
  return { http: 200, dims, records: j?.records ?? {}, capped: j?.aggregated_count === 1500 };
}

const isLease = (plan) => /monthly|weekly/i.test(plan || "");

// ---- Q1: per-reservation balance due, in-house today -----------------------
console.log(`\n=== ${CODE} (api ${PROP}) · in-house on ${asOf} · balance due per reservation ===`);
const bal = await q({
  property_ids: [Number(PROP)], dataset_id: 3,
  columns: [{ cdf: { column: "reservation_balance_due_amount" } }, { cdf: { column: "grand_total_amount" } }, { cdf: { column: "reservation_paid_amount" } }],
  group_rows: [{ cdf: { column: "public_rate_plan" } }, { cdf: { column: "room_numbers" } }, { cdf: { column: "checkin_date" } }],
  filters: { and: [
    { cdf: { column: "checkin_date" }, operator: "less_than_or_equal", value: asOf },
    { cdf: { column: "checkout_date" }, operator: "greater_than", value: asOf },
    { cdf: { column: "reservation_status" }, operator: "equals", value: "In-House" },
  ] },
  settings: { totals: false, details: true },
});

if (bal.http !== 200) {
  console.log(`  FAILED http ${bal.http}: ${bal.err}`);
} else {
  const due = bal.records.reservation_balance_due_amount ?? [];
  let withBal = 0, leaseWith = 0, transWith = 0, sum = 0, neg = 0;
  const sample = [];
  for (let i = 0; i < bal.dims.length; i++) {
    const [plan, room, checkin] = bal.dims[i];
    const d = due[i] ?? 0;
    if (d > 0.005) {
      withBal++; sum += d;
      if (isLease(plan)) leaseWith++; else transWith++;
      if (sample.length < 8) sample.push({ room, checkin, due: d.toFixed(2), lease: isLease(plan) });
    } else if (d < -0.005) neg++;
  }
  console.log(`  in-house reservation rows: ${bal.dims.length}${bal.capped ? "  [CAPPED at 1500]" : ""}`);
  console.log(`  rows with balance due > 0: ${withBal}  (lease ${leaseWith} / transient ${transWith})`);
  console.log(`  rows with NEGATIVE balance (credit): ${neg}`);
  console.log(`  total balance due: $${sum.toFixed(2)}`);
  console.log(`  sample (room / checkin / due / lease):`);
  for (const s of sample) console.log(`    ${s.room.padEnd(10)} ${s.checkin}  $${String(s.due).padStart(10)}  ${s.lease ? "LEASE" : "trans"}`);
}

// ---- Q2: is rent nightly or periodic? --------------------------------------
// Per-day chunking keeps each query well under the 1500 detail-row cap.
console.log(`\n=== ${CODE} · Room Rate charge cadence, trailing ${DAYS}d ===`);
const days = Array.from({ length: DAYS }, (_, i) => shift(-(DAYS - i)));
const perDay = await Promise.all(days.map(async (d) => ({ d, r: await q({
  property_ids: [Number(PROP)], dataset_id: 1,
  columns: [{ cdf: { column: "debit_amount" } }],
  group_rows: [{ cdf: { column: "public_rate_plan" } }, { cdf: { column: "res_room_identifier" } }],
  filters: { and: [
    { cdf: { column: "service_date" }, operator: "greater_than_or_equal", value: d },
    { cdf: { column: "service_date" }, operator: "less_than_or_equal", value: d },
    { cdf: { column: "transaction_type" }, operator: "equals", value: "Room Rate" },
  ] },
  settings: { totals: false, details: true },
}) })));

const failed = perDay.filter((x) => x.r.http !== 200);
if (failed.length) console.log(`  ${failed.length}/${DAYS} day-queries failed (first: http ${failed[0].r.http} ${failed[0].r.err ?? ""})`);

// resId -> { plan, days:Set, total }
const byRes = new Map();
for (const { d, r } of perDay) {
  if (r.http !== 200) continue;
  const amt = r.records.debit_amount ?? [];
  for (let i = 0; i < r.dims.length; i++) {
    const [plan, resId] = r.dims[i];
    if (!resId) continue;
    const e = byRes.get(resId) ?? { plan, days: new Set(), total: 0 };
    e.days.add(d); e.total += amt[i] ?? 0;
    if (!e.plan && plan) e.plan = plan;
    byRes.set(resId, e);
  }
}

const bucket = (n) => (n === 1 ? "1" : n <= 3 ? "2-3" : n <= 7 ? "4-7" : n <= Math.ceil(DAYS * 0.5) ? `8-${Math.ceil(DAYS * 0.5)}` : `>${Math.ceil(DAYS * 0.5)} (nightly)`);
for (const label of ["LEASE", "TRANSIENT"]) {
  const rows = [...byRes.values()].filter((e) => (label === "LEASE") === isLease(e.plan));
  const dist = {};
  for (const e of rows) dist[bucket(e.days.size)] = (dist[bucket(e.days.size)] ?? 0) + 1;
  const avg = rows.length ? (rows.reduce((a, e) => a + e.days.size, 0) / rows.length).toFixed(1) : "–";
  console.log(`  ${label}: ${rows.length} reservation-rooms · avg charge-days in ${DAYS}d = ${avg}`);
  for (const [k, v] of Object.entries(dist).sort()) console.log(`     ${String(k).padEnd(18)} ${v}`);
}
console.log(`\n  READ: avg charge-days ~= ${DAYS} means rent ACCRUES NIGHTLY (transaction dates cannot`);
console.log(`  give a rent-due date). avg 1-2 means rent posts PERIODICALLY (dates are usable).`);
