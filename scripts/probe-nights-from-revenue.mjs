// Read-only probe answering two questions the Monica-parity analysis left open,
// Davenport (318197) only. No writes, no guest scope.
//
// Q-A (DRIFT): is the transient/lease REVENUE split for a PAST day stable when
//     re-queried today, or does it move? Compare a live re-query against the
//     value our snapshot store banked for the same day. If they match, the
//     divergence from Monica is on HER side (or in her blended lease source),
//     not our historical reclassification.
//
// Q-B (NIGHTS FROM REVENUE): does the ROW COUNT of dataset-1 "Room Rate"
//     transactions equal paid room-nights? The Task-1 spike saw 94 Room Rate
//     rows on 2026-07-19 = Monica's 10 transient + 84 lease exactly, while the
//     dataset-3 In-House row count gave 8/84. If that holds across dates, nights
//     should be sourced from the same query as revenue (ADR then reconciles by
//     construction and cannot drift with reservation status).
//
// Run: node scripts/probe-nights-from-revenue.mjs [date ...]
import { readFileSync } from "node:fs";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}
const KEY = process.env.CLOUDBEDS_API_KEY_DP;
if (!KEY) { console.error("No CLOUDBEDS_API_KEY_DP"); process.exit(1); }

const PROP = "318197";
const DI = "https://api.cloudbeds.com/datainsights/v1.1";
const H = { Authorization: `Bearer ${KEY}`, "X-PROPERTY-ID": PROP, Accept: "application/json", "Content-Type": "application/json" };

// lib/revenue-report.ts classifyForReport, verbatim.
const LEASE_KEYS = ["monthly lease", "weekly lease", "long term"];
const classify = (p) => (LEASE_KEYS.some((k) => (p ?? "").toLowerCase().includes(k)) ? "lease" : "transient");

async function roomRateByPlan(day) {
  const r = await fetch(`${DI}/reports/query/data?mode=Run`, {
    method: "POST", headers: H,
    body: JSON.stringify({
      property_ids: [Number(PROP)], dataset_id: 1,
      columns: [{ cdf: { column: "debit_amount" } }],
      group_rows: [{ cdf: { column: "public_rate_plan" } }],
      filters: { and: [
        { cdf: { column: "service_date" }, operator: "equals", value: day },
        { cdf: { column: "transaction_type" }, operator: "equals", value: "Room Rate" },
      ] },
      settings: { totals: false, details: true },
    }),
  });
  const j = await r.json();
  if (r.status !== 200) return { error: `${r.status} ${JSON.stringify(j).slice(0, 200)}` };
  const index = Array.isArray(j.index) ? j.index : [];
  const amounts = j.records?.debit_amount ?? [];
  const out = { plans: {}, nights: { transient: 0, lease: 0 }, paid: { transient: 0, lease: 0 }, zero: 0, rev: { transient: 0, lease: 0 }, rows: index.length };
  for (let i = 0; i < index.length; i++) {
    const plan = String(Array.isArray(index[i]) ? index[i][0] ?? "" : index[i] ?? "");
    const amt = typeof amounts[i] === "number" ? amounts[i] : 0;
    const cls = classify(plan);
    out.plans[plan] ??= { rows: 0, amount: 0 };
    out.plans[plan].rows += 1;
    out.plans[plan].amount += amt;
    out.nights[cls] += 1;
    if (amt > 0) out.paid[cls] += 1; else out.zero += 1;
    out.rev[cls] += amt;
  }
  return out;
}

const days = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["2026-02-15", "2026-03-15", "2026-05-20", "2026-06-10", "2026-07-24", "2026-07-25", "2026-07-26"];

for (const day of days) {
  const r = await roomRateByPlan(day);
  if (r.error) { console.log(`${day}  ERROR ${r.error}`); continue; }
  const f = (n) => `$${n.toFixed(2)}`;
  console.log(`\n${day}  RoomRate rows=${r.rows}`);
  console.log(`  nights  transient=${r.nights.transient}  lease=${r.nights.lease}  total=${r.nights.transient + r.nights.lease}`);
  console.log(`  revenue transient=${f(r.rev.transient)}  lease=${f(r.rev.lease)}  total=${f(r.rev.transient + r.rev.lease)}`);
  console.log(`  nights excl $0 rows  transient=${r.paid.transient}  lease=${r.paid.lease}  ($0 rows: ${r.zero})`);
  console.log(`  plans: ${Object.entries(r.plans).map(([p, v]) => `${p} [rows ${v.rows}, ${f(v.amount)}]`).join(" | ")}`);
}
