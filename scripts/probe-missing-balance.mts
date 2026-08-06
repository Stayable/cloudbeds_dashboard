// Why is a guest with a real balance missing from Bea's §3 table?
//
//   npx tsx scripts/probe-missing-balance.mts "krick" [asOf]
//
// Read-only. Widens §3's query in the two ways it is narrow — no
// reservation_status filter, and no checkout_date > asOf window — then reports:
//   1. every reservation matching the name, with status / dates / balance;
//   2. per property, how much outstanding balance each status holds, i.e. how
//      much money the In-House filter is hiding.
//
// Prints guest names for the matched search term only (that is the point of the
// probe); the status roll-up is counts and sums, no names.
import { readFileSync } from "node:fs";
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}
const { PROPERTIES } = await import("../config/properties.ts");
const { readKey } = await import("../lib/cloudbeds.ts");
const { easternToday } = await import("../lib/dates.ts");

const DI_BASE = "https://api.cloudbeds.com/datainsights/v1.1";
const needle = (process.argv[2] ?? "").toLowerCase();
const asOf = process.argv.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) ?? easternToday();
const BALANCE_COL = "reservation_balance_due_amount";
// Wide enough to include anyone in-house now or departed recently, narrow
// enough not to walk the whole history.
const WINDOW_START = "2026-01-01";
const money = (n: number) => `$${n.toFixed(2)}`;

if (!needle) {
  console.error('usage: npx tsx scripts/probe-missing-balance.mts "<name fragment>" [asOf]');
  process.exit(1);
}

type Rows = { dims: string[][]; records: Record<string, number[]> };

async function q(apiKey: string, apiPropertyId: string, groups: string[], filters: unknown[]): Promise<Rows> {
  const res = await fetch(`${DI_BASE}/reports/query/data?mode=Run`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "X-PROPERTY-ID": apiPropertyId,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      property_ids: [Number(apiPropertyId)],
      dataset_id: 3,
      columns: [{ cdf: { column: BALANCE_COL } }],
      group_rows: groups.map((column) => ({ cdf: { column } })),
      filters: { and: filters },
      settings: { totals: false, details: true },
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  const p = JSON.parse(text) as { index?: unknown[]; records?: Record<string, unknown[]> };
  const dims = (Array.isArray(p.index) ? p.index : []).map((r) =>
    Array.isArray(r) ? r.map((v) => String(v ?? "")) : [String(r ?? "")],
  );
  const arr = Array.isArray(p.records?.[BALANCE_COL]) ? p.records![BALANCE_COL] : [];
  return { dims, records: { [BALANCE_COL]: arr.map((x) => (typeof x === "number" ? x : 0)) } };
}

// No status filter, no checkout window — only "touches 2026".
const wide = [{ cdf: { column: "checkout_date" }, operator: "greater_than_or_equal", value: WINDOW_START }];

console.log(`Hunting "${needle}"  ·  asOf ${asOf}  ·  checkout_date >= ${WINDOW_START}\n`);

for (const property of PROPERTIES) {
  const key = readKey(property.code);
  const tag = `${property.name} (${property.id})`;
  if (!key || !property.apiPropertyId) {
    console.log(`${tag}: awaiting key`);
    continue;
  }

  let ident: Rows;
  let dates: Rows;
  try {
    [ident, dates] = await Promise.all([
      q(key, property.apiPropertyId, ["reservation_number", "primary_guest_full_name", "reservation_status"], wide),
      q(key, property.apiPropertyId, ["reservation_number", "checkin_date", "checkout_date"], wide),
    ]);
  } catch (e) {
    console.log(`${tag}: ERROR ${String(e).slice(0, 200)}`);
    continue;
  }

  const dateByRes = new Map<string, { ci: string; co: string }>();
  for (const [resNo, ci, co] of dates.dims) if (resNo && !dateByRes.has(resNo)) dateByRes.set(resNo, { ci, co });

  const due = ident.records[BALANCE_COL] ?? [];
  // Status roll-up over reservations carrying a positive balance.
  const byStatus = new Map<string, { n: number; sum: number }>();
  const hits: string[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < ident.dims.length; i++) {
    const [resNo, guest, status] = ident.dims[i];
    if (!resNo || seen.has(resNo)) continue;
    seen.add(resNo);
    const bal = due[i] ?? 0;
    const d = dateByRes.get(resNo);

    if (bal > 0.005) {
      const inHouseWindow = d && d.ci <= asOf && d.co > asOf;
      const bucket = `${status}${inHouseWindow ? "" : "  [outside checkout>asOf window]"}`;
      const cur = byStatus.get(bucket) ?? { n: 0, sum: 0 };
      byStatus.set(bucket, { n: cur.n + 1, sum: cur.sum + bal });
    }

    if (guest.toLowerCase().includes(needle)) {
      const wouldShow = status === "In-House" && d && d.ci <= asOf && d.co > asOf && bal > 0.005;
      hits.push(
        `    ${guest.padEnd(26)} res ${resNo.padEnd(12)} ${money(bal).padStart(11)}  ` +
          `${status.padEnd(12)} in ${d?.ci ?? "?"} out ${d?.co ?? "?"}  ` +
          `${wouldShow ? "SHOWS in §3" : "MISSING from §3"}`,
      );
    }
  }

  const statusLine = [...byStatus.entries()]
    .sort((a, b) => b[1].sum - a[1].sum)
    .map(([s, v]) => `${s} ${v.n}×${money(v.sum)}`)
    .join(" · ");
  console.log(`${tag}: ${statusLine || "no positive balances"}`);
  for (const h of hits) console.log(h);
}
