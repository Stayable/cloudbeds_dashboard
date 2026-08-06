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
//
// DEFECT FIXED 08/06/26 — DO NOT REINTRODUCE `checkout_date > asOf`.
// The original filter was `status = In-House AND checkin <= asOf AND checkout >
// asOf`. That third clause silently dropped two kinds of row, both of which are
// the ones a collections table exists to show:
//   1. guests DEPARTING TODAY (checkout == asOf) — the last day Bea can collect;
//   2. OVERSTAYS (checkout < asOf, status still In-House) — i.e. evictions, who
//      are still in the room and owe the most.
// Reported by Bea via Kyle: a Davenport (44199) guest under active eviction,
// $4,793.60 outstanding, checkin 07-01, checkout 08-06, was invisible on 08-06
// and would have stayed invisible every day after. Measured blast radius at the
// time of the fix: 9 In-House reservations holding $15,108.87 across 7
// properties were being hidden portfolio-wide.
// The fix is to trust Cloudbeds' own `reservation_status`: it is the authority
// on who is physically in a room, and a date window cannot outvote it. Probe:
// scripts/probe-missing-balance.mts "<name>".

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
  checkout: string; // blank when the departures query did not resolve
  /** Scheduled departure vs `asOf`. `overdue` means still In-House per Cloudbeds
   *  with a checkout date already past — an overstay / eviction. `unknown` when
   *  `checkout` is blank. */
  departure: "overdue" | "today" | "future" | "unknown";
};

export type BalanceSummary = {
  rows: BalanceRow[]; // balance > 0 only, sorted by balance desc
  total: number; // Σ balanceDue over `rows`
  leaseCount: number;
  transientCount: number;
  creditCount: number; // reservations in credit (negative balance), excluded from rows
  creditTotal: number; // Σ of those negatives, as a positive number
  inHouseCount: number; // all in-house reservations considered, for context
  overdueCount: number; // rows whose checkout date has passed — overstays / evictions
  overdueTotal: number; // Σ balanceDue over those rows
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
        // Presence is defined by Cloudbeds' own status, NOT by a date window —
        // see the "DEFECT FIXED 08/06/26" note in the file header. `checkin_date`
        // still guards against future arrivals; there is deliberately no
        // checkout_date clause, so guests departing today and overstays
        // (evictions) both remain visible.
        { cdf: { column: "checkin_date" }, operator: "less_than_or_equal", value: asOf },
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
 *  plan) and the departures query (checkout) on reservation number, then keep
 *  only non-zero balances. Pure — the network shape is the only input, so this
 *  is unit-testable.
 *
 *  Three queries rather than one because `group_rows` caps at THREE columns and
 *  the table needs six fields (the same cap `diDataset1Rows` documents).
 *
 *  A reservation missing from `terms` or `departures` still appears (those
 *  fields render blank) rather than being dropped: an unclassified balance is
 *  still a balance Bea needs to see. */
export function foldBalanceRows(
  identity: Dataset3Rows,
  terms: Dataset3Rows,
  departures: Dataset3Rows,
  asOf: string,
): BalanceSummary {
  const termsByRes = new Map<string, { checkin: string; ratePlan: string }>();
  for (const dims of terms.dims) {
    const [resNo, checkin, ratePlan] = dims;
    if (resNo && !termsByRes.has(resNo)) termsByRes.set(resNo, { checkin: checkin ?? "", ratePlan: ratePlan ?? "" });
  }
  const checkoutByRes = new Map<string, string>();
  for (const dims of departures.dims) {
    const [resNo, checkout] = dims;
    if (resNo && !checkoutByRes.has(resNo)) checkoutByRes.set(resNo, checkout ?? "");
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
    const checkout = checkoutByRes.get(resNo) ?? "";
    rows.push({
      reservationNumber: resNo,
      guest: guest || "—",
      rooms: rooms || "—",
      balanceDue: balance,
      ratePlan: t?.ratePlan ?? "",
      leaseClass: classifyRatePlan(t?.ratePlan),
      checkin: t?.checkin ?? "",
      checkout,
      // ISO dates compare correctly as strings, which is why they are read raw.
      departure: !checkout ? "unknown" : checkout < asOf ? "overdue" : checkout === asOf ? "today" : "future",
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

  const overdue = rows.filter((r) => r.departure === "overdue");
  return {
    rows,
    total: rows.reduce((sum, r) => sum + r.balanceDue, 0),
    leaseCount: rows.filter((r) => r.leaseClass !== "transient").length,
    transientCount: rows.filter((r) => r.leaseClass === "transient").length,
    creditCount,
    creditTotal,
    inHouseCount,
    overdueCount: overdue.length,
    overdueTotal: overdue.reduce((sum, r) => sum + r.balanceDue, 0),
  };
}

/** Outstanding balances for one property's in-house reservations on `asOf`. */
export async function getBalanceDue(
  apiKey: string,
  apiPropertyId: string,
  asOf: string,
): Promise<CloudbedsResult<BalanceSummary>> {
  const [identity, terms, departures] = await Promise.all([
    diDataset3Rows(apiKey, apiPropertyId, ["reservation_number", "primary_guest_full_name", "room_numbers"], [BALANCE_COL], asOf),
    diDataset3Rows(apiKey, apiPropertyId, ["reservation_number", "checkin_date", "public_rate_plan"], [BALANCE_COL], asOf),
    diDataset3Rows(apiKey, apiPropertyId, ["reservation_number", "checkout_date"], [BALANCE_COL], asOf),
  ]);

  if (!identity.ok) return identity;
  // Terms and departures are supplementary — a failure there degrades the table
  // (blank check-in / rate plan / checkout) rather than losing the balances
  // entirely. `departure` then reads "unknown" instead of silently claiming the
  // stay is current.
  const empty = { dims: [], records: {} };
  return {
    ok: true,
    data: foldBalanceRows(identity.data, terms.ok ? terms.data : empty, departures.ok ? departures.data : empty, asOf),
  };
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
