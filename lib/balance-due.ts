// Outstanding balances for in-house reservations — Bea's §3 table.
//
// CONTAINS GUEST NAMES. This is the one place in the app that requests guest
// PII, authorised by Kyle on 08/04/26 as an explicit amendment to CLAUDE.md §5
// rule 2 (see that file, and TODO.md session 9d). Every other surface remains
// aggregate-only. Consequences, recorded so they are not rediscovered:
//   - the standing "re-issue all 8 keys without Guest scope" task can no longer
//     drop the Guest / Data Insights Guests scopes;
//   - `/bea` is gated (BEA_PIN or exec/CEO) and must stay gated;
//   - nothing here may be surfaced on `/` or any ungated route.
//
// WHY THERE IS NO DUE-DATE COLUMN (measured 08/04/26, do not re-derive):
// neither DI dataset carries a rent/payment due date — a column dump of
// datasets 1 and 3 returned zero due/lease/cycle/recurring/term fields, and the
// only "due" columns are balance AMOUNTS. Rent also accrues NIGHTLY rather than
// posting on a cycle: all 19 balance-carrying reservations at Lakeland had Room
// Rate charges on every day of a 90-day window with the last charge dated
// today, and Kissimmee East / Davenport match (avg 13.6 charge-days per 28).
// So "date of last rent charge" would render as today for every row, and a
// check-in-anniversary due date would be an unverifiable inference in a
// collections workflow. Probes: scripts/probe-balance-due.mjs,
// probe-due-date-cols.mjs, probe-rent-cycle.mjs.
//
// If an aging dimension is ever wanted, the grounded derivation is "unpaid
// since" — walk each reservation's debits and credits chronologically and take
// the last date the running balance was <= 0. That is measured, not inferred.

import { PROPERTIES, type Property } from "@/config/properties";
import { readKey, type CloudbedsResult } from "@/lib/cloudbeds";
import { classifyRatePlan, type LeaseClass } from "@/lib/lease";

const DI_BASE = "https://api.cloudbeds.com/datainsights/v1.1";
const REVALIDATE_SECONDS = 600;
const BALANCE_EPSILON = 0.005; // sub-cent noise is not a balance

/** One in-house reservation carrying a non-zero balance. */
export type BalanceRow = {
  reservationNumber: string;
  guest: string; // primary_guest_full_name — PII, see header
  rooms: string; // comma-joined when a reservation holds more than one room
  balanceDue: number;
  ratePlan: string;
  leaseClass: LeaseClass;
  checkin: string;
};

export type BalanceSummary = {
  rows: BalanceRow[]; // balance > 0 only, sorted by balance desc
  total: number; // Σ balanceDue over `rows`
  leaseCount: number;
  transientCount: number;
  creditCount: number; // reservations in credit (negative balance), excluded from rows
  creditTotal: number; // Σ of those negatives, as a positive number
  inHouseCount: number; // all in-house reservations considered, for context
};

/** A dataset-3 `details:true` result: one entry per reservation row, `dims` in
 *  the order the group columns were requested. */
type Dataset3Rows = { dims: string[][]; records: Record<string, number[]> };

/** Dataset-3 detail rows grouped by up to THREE columns (the API rejects a
 *  fourth — the same cap `diDataset1Rows` documents). Bea's table needs five
 *  fields, so it takes two queries joined on `reservation_number`. */
async function diDataset3Rows(
  apiKey: string,
  apiPropertyId: string,
  groupColumns: string[],
  measureColumns: string[],
  asOf: string,
): Promise<CloudbedsResult<Dataset3Rows>> {
  const body = {
    property_ids: [Number(apiPropertyId)],
    dataset_id: 3,
    columns: measureColumns.map((column) => ({ cdf: { column } })),
    group_rows: groupColumns.map((column) => ({ cdf: { column } })),
    filters: {
      and: [
        // In-house on asOf: arrived on or before it, not yet departed.
        { cdf: { column: "checkin_date" }, operator: "less_than_or_equal", value: asOf },
        { cdf: { column: "checkout_date" }, operator: "greater_than", value: asOf },
        { cdf: { column: "reservation_status" }, operator: "equals", value: "In-House" },
      ],
    },
    settings: { totals: false, details: true },
  };

  let res: Response;
  try {
    res = await fetch(`${DI_BASE}/reports/query/data?mode=Run`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "X-PROPERTY-ID": apiPropertyId,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      next: { revalidate: REVALIDATE_SECONDS },
    });
  } catch (e) {
    return { ok: false, status: 0, error: `Network error reaching Data Insights: ${String(e)}` };
  }

  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* keep raw */
  }
  if (!res.ok) return { ok: false, status: res.status, error: `Data Insights HTTP ${res.status}`, body: parsed };

  const p = parsed as { index?: unknown[]; records?: Record<string, unknown[]> };
  const dims = (Array.isArray(p?.index) ? p.index : []).map((row) =>
    Array.isArray(row) ? row.map((v) => String(v ?? "")) : [String(row ?? "")],
  );
  const records: Record<string, number[]> = {};
  for (const col of measureColumns) {
    const arr = Array.isArray(p?.records?.[col]) ? p.records![col] : [];
    records[col] = arr.map((x) => (typeof x === "number" ? x : 0));
  }
  return { ok: true, data: { dims, records } };
}

const BALANCE_COL = "reservation_balance_due_amount";

/** Join the identity query (guest + rooms) to the terms query (check-in + rate
 *  plan) on reservation number, then keep only non-zero balances. Pure — the
 *  network shape is the only input, so this is unit-testable.
 *
 *  A reservation missing from `terms` still appears (its check-in / rate plan
 *  render blank) rather than being dropped: an unclassified balance is still a
 *  balance Bea needs to see. */
export function foldBalanceRows(identity: Dataset3Rows, terms: Dataset3Rows): BalanceSummary {
  const termsByRes = new Map<string, { checkin: string; ratePlan: string }>();
  for (const dims of terms.dims) {
    const [resNo, checkin, ratePlan] = dims;
    if (resNo && !termsByRes.has(resNo)) termsByRes.set(resNo, { checkin: checkin ?? "", ratePlan: ratePlan ?? "" });
  }

  const due = identity.records[BALANCE_COL] ?? [];
  const seen = new Set<string>();
  const rows: BalanceRow[] = [];
  let creditCount = 0;
  let creditTotal = 0;
  let inHouseCount = 0;

  for (let i = 0; i < identity.dims.length; i++) {
    const [resNo, guest, rooms] = identity.dims[i];
    if (!resNo || seen.has(resNo)) continue; // one row per reservation
    seen.add(resNo);
    inHouseCount++;

    const balance = due[i] ?? 0;
    if (balance < -BALANCE_EPSILON) {
      creditCount++;
      creditTotal += -balance;
      continue;
    }
    if (balance <= BALANCE_EPSILON) continue;

    const t = termsByRes.get(resNo);
    rows.push({
      reservationNumber: resNo,
      guest: guest || "—",
      rooms: rooms || "—",
      balanceDue: balance,
      ratePlan: t?.ratePlan ?? "",
      leaseClass: classifyRatePlan(t?.ratePlan),
      checkin: t?.checkin ?? "",
    });
  }

  // Balance desc, so the biggest arrears are the first thing Bea reads. Ties
  // break on room then reservation number to keep render order deterministic
  // (the same defect class as the nondeterministic property order in session 6).
  rows.sort(
    (a, b) =>
      b.balanceDue - a.balanceDue ||
      a.rooms.localeCompare(b.rooms) ||
      a.reservationNumber.localeCompare(b.reservationNumber),
  );

  return {
    rows,
    total: rows.reduce((sum, r) => sum + r.balanceDue, 0),
    leaseCount: rows.filter((r) => r.leaseClass !== "transient").length,
    transientCount: rows.filter((r) => r.leaseClass === "transient").length,
    creditCount,
    creditTotal,
    inHouseCount,
  };
}

/** Outstanding balances for one property's in-house reservations on `asOf`. */
export async function getBalanceDue(
  apiKey: string,
  apiPropertyId: string,
  asOf: string,
): Promise<CloudbedsResult<BalanceSummary>> {
  const [identity, terms] = await Promise.all([
    diDataset3Rows(apiKey, apiPropertyId, ["reservation_number", "primary_guest_full_name", "room_numbers"], [BALANCE_COL], asOf),
    diDataset3Rows(apiKey, apiPropertyId, ["reservation_number", "checkin_date", "public_rate_plan"], [BALANCE_COL], asOf),
  ]);

  if (!identity.ok) return identity;
  // Terms are supplementary — a failure there degrades the table (blank
  // check-in / rate plan) rather than losing the balances entirely.
  const termsData = terms.ok ? terms.data : { dims: [], records: {} };
  return { ok: true, data: foldBalanceRows(identity.data, termsData) };
}

export type PropertyBalance = {
  property: Property;
  configured: boolean;
  result: CloudbedsResult<BalanceSummary> | null; // null = no key configured
};

/** Every property's outstanding balances for `asOf`. */
export async function getPortfolioBalanceDue(asOf: string): Promise<PropertyBalance[]> {
  return Promise.all(
    PROPERTIES.map(async (property): Promise<PropertyBalance> => {
      const key = readKey(property.code);
      if (!key || !property.apiPropertyId) return { property, configured: false, result: null };
      return { property, configured: true, result: await getBalanceDue(key, property.apiPropertyId, asOf) };
    }),
  );
}
