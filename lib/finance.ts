// Merge per-property finance aggregates into [ALL, ...per property] views for
// Rob's §5. Pure (unit-testable). Inputs are PII-free aggregates from
// lib/cloudbeds getFinanceAggregates.

import type { PropertyFinance, FinanceAggregates } from "@/lib/cloudbeds";

export type FinanceView = {
  key: string; // "ALL" or property code
  label: string;
  charges: number;
  paymentsCredits: number;
  net: number;
  typeMix: Record<string, number>;
  paymentMethodMix: Record<string, number>;
  capped: boolean; // totals may undercount (a day hit the 1500-row cap)
};

function addInto(target: Record<string, number>, src: Record<string, number>) {
  for (const [k, v] of Object.entries(src)) target[k] = (target[k] ?? 0) + v;
}

export function buildFinanceViews(list: PropertyFinance[]): FinanceView[] {
  const reporting = list.filter((p) => p.result?.ok);
  if (reporting.length === 0) return [];

  const all: FinanceView = {
    key: "ALL",
    label: "All properties",
    charges: 0,
    paymentsCredits: 0,
    net: 0,
    typeMix: {},
    paymentMethodMix: {},
    capped: false,
  };
  const perProperty: FinanceView[] = reporting.map((p) => {
    const a = p.result!.ok ? (p.result!.data as FinanceAggregates) : null;
    const v: FinanceView = {
      key: p.property.code,
      label: p.property.name,
      charges: a?.charges ?? 0,
      paymentsCredits: a?.paymentsCredits ?? 0,
      net: a?.net ?? 0,
      typeMix: a?.typeMix ?? {},
      paymentMethodMix: a?.paymentMethodMix ?? {},
      capped: a?.capped ?? false,
    };
    all.charges += v.charges;
    all.paymentsCredits += v.paymentsCredits;
    all.net += v.net;
    addInto(all.typeMix, v.typeMix);
    addInto(all.paymentMethodMix, v.paymentMethodMix);
    if (v.capped) all.capped = true;
    return v;
  });

  return [all, ...perProperty];
}
