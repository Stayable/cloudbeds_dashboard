// Read-only: for the in-house LEASE reservations that carry a balance, what do
// their actual Room Rate charge dates look like? Decides how "Previous Rent Due"
// must be derived, since neither dataset has a due-date column.
//
// Hypothesis under test: rent posts on the CHECK-IN day-of-month anniversary.
// If true, previous-rent-due = most recent anniversary <= today (deterministic,
// no transaction join needed). If false, we need the last real charge date.
//
// Joins dataset 3 -> dataset 1 on `reservation_number` (present in both).
// Prints room numbers, dates and amounts — NO guest names.
// Run: node scripts/probe-rent-cycle.mjs [CODE] [lookbackDays]
import { readFileSync } from "node:fs";
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}
const CODE = (process.argv[2] || "LL").toUpperCase();
const LOOKBACK = Number(process.argv[3] || 90);
const API_ID = { DP: "318197", LL: "210972", KE: "210986", KW: "210969", JW: "210987", JN: "206628", SA: "208155", OR: "210971" };
const KEY = process.env[`CLOUDBEDS_API_KEY_${CODE}`];
const PROP = API_ID[CODE];
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

// --- 1. in-house reservations carrying a balance ----------------------------
const res = await q({
  property_ids: [Number(PROP)], dataset_id: 3,
  columns: [{ cdf: { column: "reservation_balance_due_amount" } }],
  group_rows: [{ cdf: { column: "reservation_number" } }, { cdf: { column: "checkin_date" } }, { cdf: { column: "room_numbers" } }],
  filters: { and: [
    { cdf: { column: "checkin_date" }, operator: "less_than_or_equal", value: asOf },
    { cdf: { column: "checkout_date" }, operator: "greater_than", value: asOf },
    { cdf: { column: "reservation_status" }, operator: "equals", value: "In-House" },
  ] },
  settings: { totals: false, details: true },
});
if (res.http !== 200) { console.error(`dataset 3 failed: ${res.http} ${res.err}`); process.exit(1); }

const due = res.records.reservation_balance_due_amount ?? [];
const targets = [];
for (let i = 0; i < res.dims.length; i++) {
  const [resNo, checkin, rooms] = res.dims[i];
  const d = due[i] ?? 0;
  if (d > 0.005 && resNo) targets.push({ resNo, checkin, rooms, due: d });
}
targets.sort((a, b) => b.due - a.due);
console.log(`${CODE}: ${targets.length} in-house reservations with a balance due\n`);
if (!targets.length) process.exit(0);

// --- 2. their Room Rate charge dates, in 45-day chunks to respect the cap ---
const orRes = { or: targets.map((t) => ({ cdf: { column: "reservation_number" }, operator: "equals", value: t.resNo })) };
const chunks = [];
for (let off = LOOKBACK; off > 0; off -= 45) chunks.push([shift(-off), shift(-Math.max(off - 45, 0))]);

const charges = new Map(); // resNo -> [{date, amt}]
for (const [s, e] of chunks) {
  const r = await q({
    property_ids: [Number(PROP)], dataset_id: 1,
    columns: [{ cdf: { column: "debit_amount" } }],
    group_rows: [{ cdf: { column: "reservation_number" } }, { cdf: { column: "service_date" } }],
    filters: { and: [
      { cdf: { column: "service_date" }, operator: "greater_than_or_equal", value: s },
      { cdf: { column: "service_date" }, operator: "less_than_or_equal", value: e },
      { cdf: { column: "transaction_type" }, operator: "equals", value: "Room Rate" },
      orRes,
    ] },
    settings: { totals: false, details: true },
  });
  if (r.http !== 200) { console.log(`  chunk ${s}..${e} failed: ${r.http} ${r.err}`); continue; }
  if (r.capped) console.log(`  [warn] chunk ${s}..${e} hit the 1500-row cap`);
  const amt = r.records.debit_amount ?? [];
  for (let i = 0; i < r.dims.length; i++) {
    const [resNo, date] = r.dims[i];
    if (!resNo || !date) continue;
    const arr = charges.get(resNo) ?? [];
    arr.push({ date: date.slice(0, 10), amt: amt[i] ?? 0 });
    charges.set(resNo, arr);
  }
}

// --- 3. report: charge pattern vs check-in anniversary ----------------------
let anniversaryHits = 0, evaluated = 0;
console.log("room       checkin     balance    chargeDays  distinctAmts  lastCharge   charge day-of-month set");
console.log("-".repeat(118));
for (const t of targets) {
  const arr = (charges.get(t.resNo) ?? []).sort((a, b) => a.date.localeCompare(b.date));
  const doms = [...new Set(arr.map((c) => Number(c.date.slice(8, 10))))].sort((a, b) => a - b);
  const amts = [...new Set(arr.map((c) => Math.round(c.amt * 100) / 100))];
  const last = arr.length ? arr[arr.length - 1].date : "—";
  const ciDom = Number(t.checkin.slice(8, 10));
  // "periodic" = few charge days relative to the window; nightly ~= LOOKBACK
  const periodic = arr.length > 0 && doms.length <= 6;
  if (periodic) { evaluated++; if (doms.includes(ciDom)) anniversaryHits++; }
  console.log(
    `${String(t.rooms).slice(0, 9).padEnd(10)} ${t.checkin}  ${("$" + t.due.toFixed(2)).padStart(9)}  ` +
    `${String(arr.length).padStart(10)}  ${String(amts.length).padStart(12)}  ${last}   ` +
    `[${doms.join(",")}]${periodic && doms.includes(ciDom) ? "  <- incl. check-in DOM " + ciDom : periodic ? "  (check-in DOM " + ciDom + " NOT in set)" : "  nightly-ish"}`,
  );
}
console.log("-".repeat(118));
console.log(`periodic-billing reservations: ${evaluated} · of those, charge dates include the check-in day-of-month: ${anniversaryHits}`);
console.log(`\nREAD: if anniversaryHits ~= evaluated, previous-rent-due = most recent check-in anniversary <= today.`);
console.log(`      if not, the only defensible source is the LAST ACTUAL Room Rate charge date (lastCharge above).`);
