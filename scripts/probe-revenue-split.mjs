// Read-only data-availability spike (Task 1 of the revenue-report plan).
// Determines how to source: (Q1) Room Revenue total, (Q2) Transient/Lease
// REVENUE split, (Q3) range room-night counts — against live Davenport DI.
// No writes. No guest scope. No guest PII columns. Davenport (318197) only.
// Run:  node scripts/probe-revenue-split.mjs [asOf=YYYY-MM-DD]
//
// Monica's Davenport (44199) "Yesterday" targets (from her PDF), used only as
// a sanity comparison, never fabricated:
//   Room Revenue = $3,198.18  (Transient $492.05 + Lease $2,706.13)
//   Transient nights = 10, Lease nights = 84 (Occupied = 95 incl. otherBlocks=1)

import { readFileSync } from "node:fs";

// --- load .env.local (no dep), same pattern as other scripts/probe-*.mjs ---
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}

const KEY = process.env.CLOUDBEDS_API_KEY_DP;
if (!KEY) {
  console.error("No CLOUDBEDS_API_KEY_DP in .env.local");
  process.exit(1);
}
const PROP = "318197"; // Davenport apiPropertyId
const DI = "https://api.cloudbeds.com/datainsights/v1.1";
const H = { Authorization: `Bearer ${KEY}`, "X-PROPERTY-ID": PROP, Accept: "application/json" };
const asOf = process.argv[2] || "2026-07-19";

const MONICA = {
  roomRevenue: 3198.18,
  transientRev: 492.05,
  leaseRev: 2706.13,
  transientNights: 10,
  leaseNights: 84,
};

async function runQuery(label, body) {
  const r = await fetch(`${DI}/reports/query/data?mode=Run`, {
    method: "POST",
    headers: { ...H, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  console.log(`\n=== ${label} (status ${r.status}) ===`);
  console.log(JSON.stringify(json, null, 2).slice(0, 1200));
  return { status: r.status, json };
}

// Same classification rule as lib/lease.ts classifyRatePlan (monthly takes
// precedence over weekly; anything else => transient). Verified keyword list.
function classifyLeaseTs(plan) {
  const s = (plan ?? "").toLowerCase();
  if (["monthly lease", "long term", "discounted long term"].some((k) => s.includes(k))) return "lease";
  if (["weekly lease", "weekly rate", "discounted weekly", "employee weekly"].some((k) => s.includes(k))) return "lease";
  return "transient";
}
// Monica's apparent revenue-report convention (see Q2 finding): ONLY the
// literal "Monthly Lease" rate-plan name is Lease; every weekly/base/combo
// plan is Transient. This reproduces her exact split — it is NOT the same
// rule as lib/lease.ts classifyRatePlan. Flagged as a real conflict.
function classifyMonica(plan) {
  const s = (plan ?? "").toLowerCase();
  return s.includes("monthly lease") ? "lease" : "transient";
}

// Zip a `details:true` parallel-array response (index[i] = [dimVal], records.<m>[i])
// into { dimVal: { measure: number, rows: number } } — mirrors getLeaseMix's zip logic.
function zipByDimension(json, measures) {
  const index = Array.isArray(json?.index) ? json.index : [];
  const out = {};
  for (let i = 0; i < index.length; i++) {
    const row = index[i];
    const key = Array.isArray(row) ? String(row[0] ?? "") : String(row ?? "");
    if (!out[key]) out[key] = { rows: 0 };
    out[key].rows += 1;
    for (const m of measures) {
      const arr = json?.records?.[m];
      const v = Array.isArray(arr) ? arr[i] : undefined;
      out[key][m] = (out[key][m] ?? 0) + (typeof v === "number" ? v : 0);
    }
  }
  return out;
}

function splitBy(byPlan, classifier, valueKey) {
  let transient = 0;
  let lease = 0;
  for (const [plan, v] of Object.entries(byPlan)) {
    const n = v[valueKey] || 0;
    if (classifier(plan) === "lease") lease += n;
    else transient += n;
  }
  return { transient, lease, total: transient + lease };
}

console.log(`Probe target: Davenport (318197), asOf=${asOf}`);
console.log(`Monica targets: RoomRevenue=$${MONICA.roomRevenue} (T $${MONICA.transientRev} / L $${MONICA.leaseRev}); T=${MONICA.transientNights}n L=${MONICA.leaseNights}n`);

// --- discover dataset 1 columns (date/type/amount-ish) so we query real names ---
{
  const detail = await (await fetch(`${DI}/datasets/1`, { headers: H })).json();
  const cols = (detail.cdfs ?? []).flatMap((g) => (g.cdfs ?? []).map((c) => c.column));
  console.log("\ndataset 1 date-ish columns:", cols.filter((c) => /date/i.test(c)).join(", "));
  console.log("dataset 1 type/category-ish columns:", cols.filter((c) => /type|categ/i.test(c)).join(", "));
  console.log("dataset 1 amount-ish columns:", cols.filter((c) => /amount|revenue|debit|credit/i.test(c)).join(", "));
  console.log("dataset 1 rate-plan-ish columns:", cols.filter((c) => /rate|plan/i.test(c)).join(", "));
}

// ============================================================
// Q1 — Room Revenue total: dataset 1 grouped by transaction_type
// ============================================================
// NOTE: dataset 1 (Financial) has no `transaction_date` column (confirmed
// live: 400 "Cdf: transaction_date not found for this dataset: Financial").
// Of the date-ish columns dataset 1 actually exposes (booking_datetime,
// checkin_date, checkout_date, invoice_created_datetime,
// last_modified_datetime, service_date, transaction_datetime),
// `service_date` is confirmed live to accept `operator:"equals"` with a plain
// YYYY-MM-DD value and return non-empty rows (transaction_datetime /
// booking_datetime with the same equals+date-only value returned an EMPTY
// result set — they need full datetime granularity, not a bare date).
const DATE_COL = "service_date";
const q1 = await runQuery("Q1: dataset1 debit/credit by transaction_type", {
  property_ids: [Number(PROP)],
  dataset_id: 1,
  columns: [{ cdf: { column: "debit_amount" } }, { cdf: { column: "credit_amount" } }],
  group_rows: [{ cdf: { column: "transaction_type" } }],
  filters: { and: [{ cdf: { column: DATE_COL }, operator: "equals", value: asOf }] },
  settings: { totals: false, details: true },
});
if (q1.status === 200) {
  const byType = zipByDimension(q1.json, ["debit_amount", "credit_amount"]);
  console.log("\nQ1 type -> {debit_amount, credit_amount, rows} map:");
  console.log(JSON.stringify(byType, null, 2));
  const roomLike = Object.entries(byType).filter(([t]) => /room rate/i.test(t));
  const roomSum = roomLike.reduce((a, [, v]) => a + (v.debit_amount || 0), 0);
  console.log(`Room-revenue type(s): ${roomLike.map(([t]) => t).join(", ") || "(none matched /room rate/i)"}`);
  console.log(`Sum of debit_amount for "Room Rate": $${roomSum.toFixed(2)}  vs Monica $${MONICA.roomRevenue}`);
}

// ============================================================
// Q2 — Transient/Lease REVENUE split: dataset 1 grouped by public_rate_plan,
// ADDITIONALLY filtered to transaction_type="Room Rate" (the Q1 answer) so
// fees/tax/payments don't pollute the split. debit_amount, details:true.
// (fallback path: reservation_status, if public_rate_plan is ever rejected)
// ============================================================
let q2 = await runQuery('Q2: dataset1 debit_amount by public_rate_plan (transaction_type="Room Rate")', {
  property_ids: [Number(PROP)],
  dataset_id: 1,
  columns: [{ cdf: { column: "debit_amount" } }],
  group_rows: [{ cdf: { column: "public_rate_plan" } }],
  filters: {
    and: [
      { cdf: { column: DATE_COL }, operator: "equals", value: asOf },
      { cdf: { column: "transaction_type" }, operator: "equals", value: "Room Rate" },
    ],
  },
  settings: { totals: false, details: true },
});
let q2Dimension = "public_rate_plan";
if (q2.status !== 200) {
  console.log("\n[Q2] public_rate_plan rejected on dataset 1 — falling back to reservation_status");
  q2 = await runQuery("Q2 fallback: dataset1 debit_amount by reservation_status", {
    property_ids: [Number(PROP)],
    dataset_id: 1,
    columns: [{ cdf: { column: "debit_amount" } }],
    group_rows: [{ cdf: { column: "reservation_status" } }],
    filters: {
      and: [
        { cdf: { column: DATE_COL }, operator: "equals", value: asOf },
        { cdf: { column: "transaction_type" }, operator: "equals", value: "Room Rate" },
      ],
    },
    settings: { totals: false, details: true },
  });
  q2Dimension = "reservation_status";
}
if (q2.status === 200) {
  const byPlan = zipByDimension(q2.json, ["debit_amount"]);
  console.log(`\nQ2 ${q2Dimension} -> debit_amount map (transaction_type="Room Rate" only):`);
  console.log(JSON.stringify(byPlan, null, 2));
  if (q2Dimension === "public_rate_plan") {
    const viaLeaseTs = splitBy(byPlan, classifyLeaseTs, "debit_amount");
    const viaMonica = splitBy(byPlan, classifyMonica, "debit_amount");
    console.log(`\nQ2 split using lib/lease.ts classifyRatePlan (weekly=lease): transient=$${viaLeaseTs.transient.toFixed(2)} lease=$${viaLeaseTs.lease.toFixed(2)}  vs Monica T=$${MONICA.transientRev} L=$${MONICA.leaseRev}`);
    console.log(`Q2 split using Monica convention (only "Monthly Lease" literal=lease, weekly=transient): transient=$${viaMonica.transient.toFixed(2)} lease=$${viaMonica.lease.toFixed(2)}  vs Monica T=$${MONICA.transientRev} L=$${MONICA.leaseRev}`);
  }
}

// ============================================================
// Q3 — Range room-night counts: dataset 3 room_count by public_rate_plan,
// stay-overlap bounds for the single day `asOf`. Test both WITH and WITHOUT
// the reservation_status=In-House filter, and compare summing `room_count`
// (per plan-getLeaseMix convention) vs. simply COUNTING ROWS (reservations)
// per plan, since prior work flagged room_count as possibly not physical.
// ============================================================
const overlap = [
  { cdf: { column: "checkin_date" }, operator: "less_than_or_equal", value: asOf },
  { cdf: { column: "checkout_date" }, operator: "greater_than", value: asOf },
];
const q3Without = await runQuery("Q3 WITHOUT status filter: dataset3 room_count by public_rate_plan (overlap)", {
  property_ids: [Number(PROP)],
  dataset_id: 3,
  columns: [{ cdf: { column: "room_count" } }],
  group_rows: [{ cdf: { column: "public_rate_plan" } }],
  filters: { and: overlap },
  settings: { totals: false, details: true },
});
const q3With = await runQuery("Q3 WITH reservation_status=In-House: dataset3 room_count by public_rate_plan (overlap)", {
  property_ids: [Number(PROP)],
  dataset_id: 3,
  columns: [{ cdf: { column: "room_count" } }, { cdf: { column: "room_numbers" } }],
  group_rows: [{ cdf: { column: "public_rate_plan" } }],
  filters: {
    and: [...overlap, { cdf: { column: "reservation_status" }, operator: "equals", value: "In-House" }],
  },
  settings: { totals: false, details: true },
});

function summarize(json, label) {
  if (json.status !== 200) return;
  const byPlan = zipByDimension(json.json, ["room_count"]);
  console.log(`\n${label} — per-plan {room_count sum, rows}:`);
  console.log(JSON.stringify(byPlan, null, 2));
  const sumViaRoomCount = splitBy(byPlan, classifyMonica, "room_count");
  const sumViaRows = splitBy(byPlan, classifyMonica, "rows");
  console.log(`${label}: sum(room_count) => transient=${sumViaRoomCount.transient} lease=${sumViaRoomCount.lease} total=${sumViaRoomCount.total}`);
  console.log(`${label}: count(rows)     => transient=${sumViaRows.transient} lease=${sumViaRows.lease} total=${sumViaRows.total}`);
  console.log(`  vs Monica: transient=${MONICA.transientNights} lease=${MONICA.leaseNights} total=${MONICA.transientNights + MONICA.leaseNights}`);
}
summarize(q3Without, "Q3 WITHOUT-filter (Monica convention: only literal Monthly Lease = lease)");
summarize(q3With, "Q3 WITH-filter In-House (Monica convention: only literal Monthly Lease = lease)");

console.log("\n--- Probe complete. See docs/superpowers/notes/2026-07-22-revenue-report-probe-findings.md for the recorded decision. ---");
