import ExecView, { type ExecData, type ExecProperty } from "@/components/ExecView";
import { resolveRange, priorWindow, priorMonthWindow } from "@/lib/dates";
import { getPortfolioInsights, getPortfolioLeaseMix } from "@/lib/cloudbeds";
import PeriodControls from "@/components/PeriodControls";

export const dynamic = "force-dynamic";

// Capacity-adjusted average occupancy over a property's daily rows.
function avgOcc(rows: { occupancy: number }[]): number | null {
  return rows.length ? rows.reduce((s, r) => s + r.occupancy, 0) / rows.length : null;
}
// Capacity-weighted portfolio occupancy (simple mean of reporting props for the
// delta baseline; matches the headline's intent without re-fetching capacity).
function portfolioMean(values: (number | null)[]): number | null {
  const v = values.filter((x): x is number => x !== null);
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
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

  const [cur, prevW, prevM, lease] = await Promise.all([
    getPortfolioInsights(start, end),
    getPortfolioInsights(pw.start, pw.end),
    getPortfolioInsights(pm.start, pm.end),
    getPortfolioLeaseMix(end), // in-house mix as of the range end
  ]);

  const leaseByCode = new Map(lease.map((l) => [l.property.code, l]));
  const prevWByCode = new Map(prevW.map((p) => [p.property.code, p]));
  const prevMByCode = new Map(prevM.map((p) => [p.property.code, p]));

  const properties: ExecProperty[] = cur.map((ins) => {
    const rows = ins.result?.ok ? ins.result.data : [];
    const occ = avgOcc(rows);
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

  // Portfolio occupancy + deltas (exclude default-off props, e.g. JN).
  const included = properties.filter((p) => !p.excludeDefault);
  const portfolioOcc = portfolioMean(included.map((p) => p.occupancy));
  const prevWOcc = portfolioMean(
    cur.filter((i) => !i.property.excludeFromAggregate).map((i) => {
      const r = prevWByCode.get(i.property.code);
      return r?.result?.ok ? avgOcc(r.result.data) : null;
    }),
  );
  const prevMOcc = portfolioMean(
    cur.filter((i) => !i.property.excludeFromAggregate).map((i) => {
      const r = prevMByCode.get(i.property.code);
      return r?.result?.ok ? avgOcc(r.result.data) : null;
    }),
  );

  const portfolioAdr = portfolioMean(included.map((p) => p.adr));
  const portfolioRevpar = portfolioMean(included.map((p) => p.revpar));
  const portfolioLease = included.reduce(
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

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <header className="mb-6 rounded-xl bg-ink px-5 py-4 text-white shadow-sm sm:mb-8 sm:px-6 sm:py-5">
        <p className="text-xs font-medium uppercase tracking-widest text-white/60">
          Stayable · Executive Dashboard
        </p>
        <h1 className="mt-1 text-2xl font-semibold sm:text-3xl">Portfolio Performance</h1>
      </header>

      <section className="mb-6">
        <PeriodControls preset={preset} start={start} end={end} />
      </section>

      <ExecView data={data} />

      <p className="mt-6 text-xs text-slate-400">
        Occupancy/ADR/RevPAR are daily averages over the selected range (Cloudbeds Data Insights).
        Lease vs Transient is an in-house snapshot as of {end}, derived from rate plan only — no guest PII.
        Revenue is intentionally excluded. Aggregated metrics only · read-only · cached up to 10 min.
      </p>
    </main>
  );
}
