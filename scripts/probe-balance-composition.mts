// What is ON Bea's §3 table, and what is NOT. Read-only, no names printed.
//
//   npx tsx scripts/probe-balance-composition.mts [asOf]
//
// Answers three questions that came out of Bea's 08/06/26 review:
//   A. TAX — are the rows carrying balances the tax-exempt (lease) ones, and are
//      "regular" transient guests really absent? Cross-tabs rate-plan class
//      against `taxes_value_amount` (there is NO boolean tax-exempt column in DI
//      dataset 1 or 3 — checked; $0 taxes is the only available signal).
//   B. IN-HOUSE ROWS THE `checkin_date <= asOf` GUARD STILL DROPS, plus any
//      overstay (In-House with checkout already past).
//   C. DEPARTED ARREARS — balances on Checked Out reservations, which §3 does not
//      show at all because it is scoped to in-house.
import { readFileSync } from "node:fs";
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}
const { PROPERTIES } = await import("../config/properties.ts");
const { readKey } = await import("../lib/cloudbeds.ts");
const { classifyRatePlan } = await import("../lib/lease.ts");
const { easternToday } = await import("../lib/dates.ts");

const DI_BASE = "https://api.cloudbeds.com/datainsights/v1.1";
const asOf = process.argv.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) ?? easternToday();
const BAL = "reservation_balance_due_amount";
const TAX = "taxes_value_amount";
const DEPARTED_SINCE = "2025-01-01";
// Six months before asOf, as a plain ISO string (dates compare lexically).
const SIX_MONTHS_AGO = (() => {
  const [y, m, d] = asOf.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCMonth(t.getUTCMonth() - 6);
  return t.toISOString().slice(0, 10);
})();
const money = (n: number) => `$${n.toFixed(2)}`;

async function q(
  apiKey: string,
  apiPropertyId: string,
  groups: string[],
  measures: string[],
  filters: unknown[],
): Promise<{ dims: string[][]; records: Record<string, number[]> }> {
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
      columns: measures.map((column) => ({ cdf: { column } })),
      group_rows: groups.map((column) => ({ cdf: { column } })),
      filters: { and: filters },
      settings: { totals: false, details: true },
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  const p = JSON.parse(text) as { index?: unknown[]; records?: Record<string, unknown[]> };
  const dims = (Array.isArray(p.index) ? p.index : []).map((r) =>
    Array.isArray(r) ? r.map((v) => String(v ?? "")) : [String(r ?? "")],
  );
  const records: Record<string, number[]> = {};
  for (const c of measures) {
    const arr = Array.isArray(p.records?.[c]) ? p.records![c] : [];
    records[c] = arr.map((x) => (typeof x === "number" ? x : 0));
  }
  return { dims, records };
}

const IN_HOUSE = { cdf: { column: "reservation_status" }, operator: "equals", value: "In-House" };

// A. tax cross-tab, portfolio-wide, keyed by the FULL rate-plan class: a taxed
// weekly lease is expected (under six months), a taxed monthly one is not
// obviously so, and lumping them as "lease" hides that distinction.
const tab = new Map<string, { n: number; sum: number }>();
const bump = (key: string, bal: number) => {
  const cur = tab.get(key) ?? { n: 0, sum: 0 };
  tab.set(key, { n: cur.n + 1, sum: cur.sum + bal });
};
let departedN = 0;
let departedSum = 0;
// Departed arrears by checkout YEAR — tests whether the balance is live
// collections or residue from the 2025 Yardi -> Cloudbeds migration.
const departedByYear = new Map<string, { n: number; sum: number }>();

console.log(`Balance-due composition · asOf ${asOf}\n`);

for (const property of PROPERTIES) {
  const key = readKey(property.code);
  const tag = `${property.name} (${property.id})`;
  if (!key || !property.apiPropertyId) {
    console.log(`${tag}: awaiting key`);
    continue;
  }
  const pid = property.apiPropertyId;

  let taxed, allInHouse, departed;
  try {
    [taxed, allInHouse, departed] = await Promise.all([
      // A
      q(key, pid, ["reservation_number", "public_rate_plan", "checkin_date"], [BAL, TAX], [
        IN_HOUSE,
        { cdf: { column: "checkin_date" }, operator: "less_than_or_equal", value: asOf },
      ]),
      // B — status only, so nothing is hidden by a date guard
      q(key, pid, ["reservation_number", "checkin_date", "checkout_date"], [BAL], [IN_HOUSE]),
      // C
      q(key, pid, ["reservation_number", "checkout_date"], [BAL], [
        { cdf: { column: "reservation_status" }, operator: "equals", value: "Checked Out" },
        { cdf: { column: "checkout_date" }, operator: "greater_than_or_equal", value: DEPARTED_SINCE },
      ]),
    ]);
  } catch (e) {
    console.log(`${tag}: ERROR ${String(e).slice(0, 160)}`);
    continue;
  }

  // A
  const seenA = new Set<string>();
  for (let i = 0; i < taxed.dims.length; i++) {
    const [resNo, plan, ci] = taxed.dims[i];
    if (!resNo || seenA.has(resNo)) continue;
    seenA.add(resNo);
    const bal = taxed.records[BAL][i] ?? 0;
    if (bal <= 0.005) continue;
    const tx = taxed.records[TAX][i] ?? 0;
    const cls = classifyRatePlan(plan);
    bump(`${cls} · ${tx > 0.005 ? "taxed" : "$0 tax"}`, bal);
    // A taxed lease is only anomalous if the guest has been resident long
    // enough to be exempt. Florida's transient-rental exemption turns on ~6
    // months' continuous residency (or a bona fide written lease longer than
    // that) — so print the residency length and let a human rule on it rather
    // than asserting a tax error from a rate-plan name.
    if (tx > 0.005 && cls !== "transient" && ci && ci <= SIX_MONTHS_AGO) {
      console.log(
        `    ?? ${tag}: res ${resNo} ${cls} taxed ${money(tx)} but resident since ${ci} ` +
          `(>= 6 months) — check whether the exemption should apply`,
      );
    }
  }

  // B
  const seenB = new Set<string>();
  const anomalies: string[] = [];
  for (let i = 0; i < allInHouse.dims.length; i++) {
    const [resNo, ci, co] = allInHouse.dims[i];
    if (!resNo || seenB.has(resNo)) continue;
    seenB.add(resNo);
    const bal = allInHouse.records[BAL][i] ?? 0;
    if (bal <= 0.005) continue;
    if (ci > asOf) anomalies.push(`res ${resNo} ${money(bal)} checkin ${ci} IS AFTER asOf — dropped by the checkin guard`);
    else if (co <= asOf && co) anomalies.push(`res ${resNo} ${money(bal)} checkout ${co} already past — OVERSTAY, now shown`);
  }

  // C
  const seenC = new Set<string>();
  let dn = 0;
  let ds = 0;
  let biggest = { res: "", bal: 0, co: "" };
  for (let i = 0; i < departed.dims.length; i++) {
    const [resNo, co] = departed.dims[i];
    if (!resNo || seenC.has(resNo)) continue;
    seenC.add(resNo);
    const bal = departed.records[BAL][i] ?? 0;
    if (bal > 0.005) {
      dn++;
      ds += bal;
      const year = (co || "?").slice(0, 4);
      const cur = departedByYear.get(year) ?? { n: 0, sum: 0 };
      departedByYear.set(year, { n: cur.n + 1, sum: cur.sum + bal });
      if (bal > biggest.bal) biggest = { res: resNo, bal, co: co || "?" };
    }
  }
  departedN += dn;
  departedSum += ds;

  console.log(
    `${tag}: departed-and-owing since ${DEPARTED_SINCE}: ${dn} × ${money(ds)}` +
      (biggest.res ? `  · largest ${money(biggest.bal)} (res ${biggest.res}, out ${biggest.co})` : ""),
  );
  for (const a of anomalies) console.log(`    !! ${a}`);
}

console.log(`\n--- A. TAX vs TYPE (in-house rows carrying a balance, portfolio) ---`);
for (const [k, v] of [...tab.entries()].sort((a, b) => b[1].sum - a[1].sum))
  console.log(`  ${k.padEnd(26)} ${String(v.n).padStart(4)} res  ${money(v.sum).padStart(13)}`);
console.log(`\n--- C. DEPARTED ARREARS NOT ON §3 (Checked Out, checkout >= ${DEPARTED_SINCE}) ---`);
console.log(`  ${departedN} reservations, ${money(departedSum)}`);
for (const [year, v] of [...departedByYear.entries()].sort())
  console.log(`    checkout ${year}: ${String(v.n).padStart(4)} res  ${money(v.sum).padStart(13)}`);
