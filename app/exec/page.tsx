import Link from "next/link";
import ExecView, { type ExecData, type ExecProperty } from "@/components/ExecView";
import OccupancyView from "@/components/OccupancyView";
import { resolveRange, priorWindow, priorMonthWindow } from "@/lib/dates";
import { getPortfolio, getPortfolioInsights, getPortfolioLeaseMix } from "@/lib/cloudbeds";
import { buildOccProperties } from "@/lib/occupancy";
import PeriodControls from "@/components/PeriodControls";
import SectionNav, { type NavItem } from "@/components/SectionNav";

export const dynamic = "force-dynamic";

const NAV: NavItem[] = [
  { id: "analytics", label: "Analytics", n: 1 },
  { id: "operational", label: "Operational", n: 2 },
  { id: "legend", label: "Legend", n: null },
];

// Raw average occupancy (vs full capacity) over a property's daily rows.
function avgOcc(rows: { occupancy: number }[]): number | null {
  return rows.length ? rows.reduce((s, r) => s + r.occupancy, 0) / rows.length : null;
}
// Simple mean — used only for ADR/RevPAR (the occupancy decision does not apply).
function portfolioMean(values: (number | null)[]): number | null {
  const v = values.filter((x): x is number => x !== null);
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
}
// Re-base raw occupancy onto effective (post-adjustment) capacity, mirroring
// components/OccupancyView.tsx effOcc: occ_adj = occ × cap/(cap+adj).
function effOcc(rawOcc: number | null, capacity: number, adjustment: number): number | null {
  if (rawOcc === null) return null;
  const eff = capacity + adjustment;
  if (adjustment !== 0 && capacity > 0 && eff > 0) return rawOcc * (capacity / eff);
  return rawOcc;
}
// Capacity-weighted + reno-adjusted portfolio occupancy over included props,
// matching the base / view: weight by effective capacity max(0, cap+adj).
function weightedPortfolioOcc(
  rows: { rawOcc: number | null; capacity: number; adjustment: number }[],
): number | null {
  let num = 0;
  let den = 0;
  for (const r of rows) {
    const occ = effOcc(r.rawOcc, r.capacity, r.adjustment);
    if (occ === null || r.capacity <= 0) continue;
    const eff = Math.max(0, r.capacity + r.adjustment);
    num += occ * eff;
    den += eff;
  }
  return den > 0 ? num / den : null;
}

export default async function ExecPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; start?: string; end?: string }>;
}) {
  const sp = await searchParams;
  const { preset, start, end } = resolveRange(sp.preset, sp.start, sp.end);
  const pw = priorWindow(start, end);
  const pm = priorMonthWindow(start, end);

  const [portfolio, cur, prevW, prevM, lease] = await Promise.all([
    getPortfolio(), // live capacities (weights for the capacity-weighted occupancy)
    getPortfolioInsights(start, end),
    getPortfolioInsights(pw.start, pw.end),
    getPortfolioInsights(pm.start, pm.end),
    getPortfolioLeaseMix(end), // in-house mix as of the range end
  ]);

  const leaseByCode = new Map(lease.map((l) => [l.property.code, l]));
  const prevWByCode = new Map(prevW.map((p) => [p.property.code, p]));
  const prevMByCode = new Map(prevM.map((p) => [p.property.code, p]));
  // code → live capacity + reno adjustment (capacity = current inventory; it does
  // not vary by historical window, so prior windows reuse these weights).
  const capByCode = new Map(
    portfolio.map((pd) => [
      pd.property.code,
      {
        capacity: pd.result?.ok ? pd.result.data.capacity : 0,
        adjustment: pd.property.capacityAdjustment ?? 0,
      },
    ]),
  );
  const capOf = (code: string) => capByCode.get(code) ?? { capacity: 0, adjustment: 0 };

  const properties: ExecProperty[] = cur.map((ins) => {
    const rows = ins.result?.ok ? ins.result.data : [];
    const { capacity, adjustment } = capOf(ins.property.code);
    // Reno-adjusted (effective-capacity) occupancy so the leaderboard matches base /.
    const occ = effOcc(avgOcc(rows), capacity, adjustment);
    const adr = rows.length ? rows.reduce((s, r) => s + r.adr, 0) / rows.length : null;
    const revpar = rows.length ? rows.reduce((s, r) => s + r.revpar, 0) / rows.length : null;
    const lm = leaseByCode.get(ins.property.code);
    return {
      code: ins.property.code,
      name: ins.property.name,
      county: ins.property.county,
      id: ins.property.id,
      occupancy: occ,
      adr,
      revpar,
      lease: lm?.result?.ok ? lm.result.data : null,
      excludeDefault: !!ins.property.excludeFromAggregate,
    };
  });

  // Portfolio occupancy + deltas: capacity-weighted + reno-adjusted over included
  // props (exclude default-off, e.g. JN), mirroring the base / view exactly.
  const included = cur.filter((i) => !i.property.excludeFromAggregate);
  const weightedOcc = (byCode: Map<string, (typeof cur)[number]>) =>
    weightedPortfolioOcc(
      included.map((i) => {
        const r = byCode.get(i.property.code);
        const { capacity, adjustment } = capOf(i.property.code);
        return { rawOcc: r?.result?.ok ? avgOcc(r.result.data) : null, capacity, adjustment };
      }),
    );
  const curByCode = new Map(cur.map((i) => [i.property.code, i]));
  const portfolioOcc = weightedOcc(curByCode);
  const prevWOcc = weightedOcc(prevWByCode);
  const prevMOcc = weightedOcc(prevMByCode);

  const includedProps = properties.filter((p) => !p.excludeDefault);
  const portfolioAdr = portfolioMean(includedProps.map((p) => p.adr));
  const portfolioRevpar = portfolioMean(includedProps.map((p) => p.revpar));
  const portfolioLease = includedProps.reduce(
    (acc, p) => {
      if (p.lease) {
        acc.monthly += p.lease.monthly;
        acc.weekly += p.lease.weekly;
        acc.transient += p.lease.transient;
        acc.total += p.lease.total;
      }
      return acc;
    },
    { monthly: 0, weekly: 0, transient: 0, total: 0 },
  );

  const data: ExecData = {
    portfolioOcc,
    wow: portfolioOcc !== null && prevWOcc !== null ? portfolioOcc - prevWOcc : null,
    mom: portfolioOcc !== null && prevMOcc !== null ? portfolioOcc - prevMOcc : null,
    portfolioAdr,
    portfolioRevpar,
    portfolioLease,
    rangeLabel: start === end ? start : `${start} → ${end}`,
    leaseAsOf: end,
    properties,
  };

  // The same operational explorer the public / dashboard shows (property
  // selector, occupancy strip, per-property detail + "Today" live cards).
  const occProperties = buildOccProperties(portfolio, cur);

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <header className="mb-6 rounded-xl bg-ink px-5 py-4 text-white shadow-sm sm:mb-8 sm:px-6 sm:py-5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-medium uppercase tracking-widest text-white/60">
            Stayable · Executive Dashboard
          </p>
          <div className="flex shrink-0 gap-2">
            <Link
              href="/rob"
              className="rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/20"
            >
              Rob&apos;s view →
            </Link>
            <Link
              href="/"
              className="rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/20"
            >
              ← Dashboard
            </Link>
          </div>
        </div>
        <h1 className="mt-1 text-2xl font-semibold sm:text-3xl">Portfolio Performance</h1>
      </header>

      <section className="mb-6">
        <PeriodControls preset={preset} start={start} end={end} />
      </section>

      <div className="lg:flex lg:gap-8">
        <SectionNav items={NAV} />

        <div className="min-w-0 flex-1">
      {/* Executive analytics first. */}
      <section id="analytics" className="mb-8 scroll-mt-20 lg:scroll-mt-6">
        <h2 className="mb-3 text-lg font-semibold text-slate-900">Executive analytics</h2>
        <ExecView data={data} />
      </section>

      {/* Operational view below — same content as the public / dashboard. */}
      <section id="operational" className="mb-8 scroll-mt-20 lg:scroll-mt-6">
        <h2 className="mb-3 text-lg font-semibold text-slate-900">Operational dashboard</h2>
        <OccupancyView properties={occProperties} />
      </section>

      {/* Legend — abbreviations used across both sections. */}
      <section id="legend" className="mb-6 scroll-mt-20 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6 lg:scroll-mt-6">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Legend — abbreviations</p>
        <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div className="flex gap-2">
            <dt className="font-semibold text-slate-900">ADR</dt>
            <dd className="text-slate-600">Average Daily Rate — room revenue per occupied room-night.</dd>
          </div>
          <div className="flex gap-2">
            <dt className="font-semibold text-slate-900">RevPAR</dt>
            <dd className="text-slate-600">Revenue Per Available Room — room revenue per available room-night.</dd>
          </div>
          <div className="flex gap-2">
            <dt className="font-semibold text-slate-900">WoW</dt>
            <dd className="text-slate-600">Week-over-week — vs. the prior equal-length window.</dd>
          </div>
          <div className="flex gap-2">
            <dt className="font-semibold text-slate-900">MoM</dt>
            <dd className="text-slate-600">Month-over-month — vs. the same window one month earlier.</dd>
          </div>
          <div className="flex gap-2">
            <dt className="font-semibold text-slate-900">Occupancy</dt>
            <dd className="text-slate-600">Rooms sold ÷ capacity, capacity-adjusted for rooms out of service.</dd>
          </div>
          <div className="flex gap-2">
            <dt className="font-semibold text-slate-900">In-House</dt>
            <dd className="text-slate-600">Rooms with a currently checked-in guest.</dd>
          </div>
          <div className="flex gap-2">
            <dt className="font-semibold text-slate-900">Stayovers</dt>
            <dd className="text-slate-600">Guests staying through (not arriving or departing today).</dd>
          </div>
          <div className="flex gap-2">
            <dt className="font-semibold text-slate-900">OOO</dt>
            <dd className="text-slate-600">Out of service — rooms unsellable (maintenance/renovation).</dd>
          </div>
          <div className="flex gap-2">
            <dt className="font-semibold text-slate-900">Lease vs Transient</dt>
            <dd className="text-slate-600">In-house mix by rate plan (monthly/weekly lease vs. nightly), shown as a ratio.</dd>
          </div>
        </dl>
      </section>

      <p className="mt-6 text-xs text-slate-400">
        Occupancy/ADR/RevPAR are daily averages over the selected range (Cloudbeds Data Insights).
        Lease vs Transient is an in-house snapshot as of {end}, derived from rate plan only — no guest PII.
        Revenue is intentionally excluded. Aggregated metrics only · read-only · cached up to 10 min.
      </p>
        </div>
      </div>
    </main>
  );
}
