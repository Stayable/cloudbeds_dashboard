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
  statusMix: Record<string, number>;
  leaseMix: { monthly: number; weekly: number; transient: number; total: number };
  roomTypeCategoryMix: Record<string, number>;
};

function addInto(target: Record<string, number>, src: Record<string, number>) {
  for (const [k, v] of Object.entries(src)) target[k] = (target[k] ?? 0) + v;
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
    addInto(out.statusMix, a.statusMix);
    out.leaseMix.monthly += a.leaseMix.monthly;
    out.leaseMix.weekly += a.leaseMix.weekly;
    out.leaseMix.transient += a.leaseMix.transient;
    out.leaseMix.total += a.leaseMix.total;
    addInto(out.roomTypeCategoryMix, a.roomTypeCategoryMix);
  }
  return out;
}
