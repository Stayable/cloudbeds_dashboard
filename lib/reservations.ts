// Merge per-property reservation aggregates into a portfolio rollup for the
// /crystal §4 view. Pure (no I/O) so it's unit-testable. All inputs are already
// PII-free aggregates (see lib/cloudbeds getReservationAggregates).

import type { PropertyReservations, ReservationAggregates } from "@/lib/cloudbeds";

export type ReservationSummary = {
  reporting: number; // properties that returned data
  rooms: number;
  roomNights: number;
  guests: number;
  grandTotal: number;
  paid: number;
  balanceDue: number;
  fees: number;
  taxes: number;
  commission: number;
  statusMix: Record<string, number>;
  leaseMix: { monthly: number; weekly: number; transient: number; total: number };
  roomTypeCategoryMix: Record<string, number>;
};

function addInto(target: Record<string, number>, src: Record<string, number>) {
  for (const [k, v] of Object.entries(src)) target[k] = (target[k] ?? 0) + v;
}

// A selectable view in the §4 UI: the merged "ALL" roll-up plus one per
// reporting property. Same display shape either way.
export type ReservationView = {
  key: string; // "ALL" or property code
  label: string;
  rooms: number;
  roomNights: number;
  guests: number;
  grandTotal: number;
  paid: number;
  balanceDue: number;
  fees: number;
  taxes: number;
  commission: number;
  statusMix: Record<string, number>;
  leaseMix: { monthly: number; weekly: number; transient: number; total: number };
  roomTypeCategoryMix: Record<string, number>;
};

/** Build [ALL, ...per reporting property] views. Empty when nothing reports. */
export function buildReservationViews(list: PropertyReservations[]): ReservationView[] {
  const reporting = list.filter((p) => p.result?.ok);
  if (reporting.length === 0) return [];

  const all = buildReservationSummary(list);
  const allView: ReservationView = {
    key: "ALL",
    label: "All properties",
    rooms: all.rooms,
    roomNights: all.roomNights,
    guests: all.guests,
    grandTotal: all.grandTotal,
    paid: all.paid,
    balanceDue: all.balanceDue,
    fees: all.fees,
    taxes: all.taxes,
    commission: all.commission,
    statusMix: all.statusMix,
    leaseMix: all.leaseMix,
    roomTypeCategoryMix: all.roomTypeCategoryMix,
  };

  const propViews: ReservationView[] = reporting.map((p) => {
    const a = p.result!.ok ? p.result!.data : null;
    return {
      key: p.property.code,
      label: p.property.name,
      rooms: a?.rooms ?? 0,
      roomNights: a?.roomNights ?? 0,
      guests: a?.guests ?? 0,
      grandTotal: a?.grandTotal ?? 0,
      paid: a?.paid ?? 0,
      balanceDue: a?.balanceDue ?? 0,
      fees: a?.fees ?? 0,
      taxes: a?.taxes ?? 0,
      commission: a?.commission ?? 0,
      statusMix: a?.statusMix ?? {},
      leaseMix: a?.leaseMix ?? { monthly: 0, weekly: 0, transient: 0, total: 0 },
      roomTypeCategoryMix: a?.roomTypeCategoryMix ?? {},
    };
  });

  return [allView, ...propViews];
}

export function buildReservationSummary(list: PropertyReservations[]): ReservationSummary {
  const out: ReservationSummary = {
    reporting: 0,
    rooms: 0,
    roomNights: 0,
    guests: 0,
    grandTotal: 0,
    paid: 0,
    balanceDue: 0,
    fees: 0,
    taxes: 0,
    commission: 0,
    statusMix: {},
    leaseMix: { monthly: 0, weekly: 0, transient: 0, total: 0 },
    roomTypeCategoryMix: {},
  };

  for (const p of list) {
    if (!p.result?.ok) continue;
    const a: ReservationAggregates = p.result.data;
    out.reporting += 1;
    out.rooms += a.rooms;
    out.roomNights += a.roomNights;
    out.guests += a.guests;
    out.grandTotal += a.grandTotal;
    out.paid += a.paid;
    out.balanceDue += a.balanceDue;
    out.fees += a.fees;
    out.taxes += a.taxes;
    out.commission += a.commission;
    addInto(out.statusMix, a.statusMix);
    out.leaseMix.monthly += a.leaseMix.monthly;
    out.leaseMix.weekly += a.leaseMix.weekly;
    out.leaseMix.transient += a.leaseMix.transient;
    out.leaseMix.total += a.leaseMix.total;
    addInto(out.roomTypeCategoryMix, a.roomTypeCategoryMix);
  }
  return out;
}
