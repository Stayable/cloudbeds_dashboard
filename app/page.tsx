import PeriodControls from "@/components/PeriodControls";
import PortfolioView from "@/components/PortfolioView";
import { dayCount, resolveRange } from "@/lib/dates";
import { getPortfolio, getPortfolioInsights, type OccupancyRow } from "@/lib/cloudbeds";

// Render per-request so runtime env vars (CLOUDBEDS_API_KEY_*) are always read
// live — upstream Cloudbeds calls are still cached 10 min (Next data cache).
export const dynamic = "force-dynamic";

function pct(n: number) {
  return `${n.toFixed(1)}%`;
}
function rate(n: number) {
  return `$${n.toFixed(2)}`;
}
function money(n: number) {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function summarize(rows: OccupancyRow[], capacity: number) {
  if (!rows.length) return null;
  const n = rows.length;
  const occ = rows.reduce((s, r) => s + r.occupancy, 0) / n;
  const adr = rows.reduce((s, r) => s + r.adr, 0) / n;
  const revpar = rows.reduce((s, r) => s + r.revpar, 0) / n;
  // Est. room revenue = Σ daily (RevPAR × available rooms). RevPAR is revenue
  // per available room by definition, so this is exact for current inventory.
  const estRevenue = rows.reduce((s, r) => s + r.revpar * capacity, 0);
  return { occ, adr, revpar, estRevenue, days: n };
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; start?: string; end?: string }>;
}) {
  const sp = await searchParams;
  const { preset, start, end } = resolveRange(sp.preset, sp.start, sp.end);

  const [portfolio, insights] = await Promise.all([
    getPortfolio(),
    getPortfolioInsights(start, end),
  ]);

  const configuredCount = portfolio.filter((p) => p.configured).length;
  const reportingCount = portfolio.filter((p) => p.result?.ok).length;

  // Capacity per property code, from the live snapshot, for revenue estimation.
  const capByCode = new Map<string, number>();
  for (const pd of portfolio) {
    capByCode.set(pd.property.code, pd.result?.ok ? pd.result.data.capacity : 0);
  }

  // Per-property period summaries.
  const periodRows = insights.map((pi) => {
    const rows = pi.result?.ok ? pi.result.data : [];
    const cap = capByCode.get(pi.property.code) ?? 0;
    return { property: pi.property, configured: pi.configured, summary: summarize(rows, cap) };
  });

  // Portfolio period aggregate (capacity-weighted occupancy, total est. revenue).
  let wOccNum = 0;
  let capSum = 0;
  let totalRevenue = 0;
  for (const r of periodRows) {
    if (!r.summary) continue;
    const cap = capByCode.get(r.property.code) ?? 0;
    wOccNum += r.summary.occ * cap;
    capSum += cap;
    totalRevenue += r.summary.estRevenue;
  }
  const portfolioOcc = capSum > 0 ? wOccNum / capSum : null;
  const days = dayCount(start, end);
  const rangeLabel = start === end ? start : `${start} → ${end}`;

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <header className="mb-6 rounded-xl bg-ink px-5 py-4 text-white shadow-sm sm:mb-8 sm:px-6 sm:py-5">
        <p className="text-xs font-medium uppercase tracking-widest text-white/60">
          Stayable · Portfolio Operating Dashboard
        </p>
        <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h1 className="text-2xl font-semibold sm:text-3xl">All Properties</h1>
          <span className="text-sm text-white/70">
            {reportingCount} of {configuredCount} reporting · {portfolio.length} total
          </span>
        </div>
      </header>

      {/* Period performance (Data Insights) */}
      <section className="mb-8">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Period performance</h2>
            <p className="text-xs text-slate-500">
              {rangeLabel} · {days} day{days === 1 ? "" : "s"} · Eastern
            </p>
          </div>
        </div>

        <div className="mb-4">
          <PeriodControls preset={preset} start={start} end={end} />
        </div>

        {/* Portfolio period summary */}
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Avg Occupancy</p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">
              {portfolioOcc !== null ? pct(portfolioOcc) : "—"}
            </p>
            <p className="mt-1 text-xs text-slate-500">portfolio, capacity-weighted</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Est. Room Revenue</p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">{money(totalRevenue)}</p>
            <p className="mt-1 text-xs text-slate-500">RevPAR × rooms (est.)</p>
          </div>
          <div className="col-span-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Range</p>
            <p className="mt-2 text-sm font-medium text-slate-900">{rangeLabel}</p>
            <p className="mt-1 text-xs text-slate-500">
              ADR = avg rate per sold room · RevPAR = revenue per available room
            </p>
          </div>
        </div>

        {/* Per-property period table */}
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[34rem] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3 font-medium">Property</th>
                <th className="px-4 py-3 text-right font-medium">Avg Occ</th>
                <th className="px-4 py-3 text-right font-medium" title="Average Daily Rate — avg revenue per sold room">
                  ADR
                </th>
                <th className="px-4 py-3 text-right font-medium" title="Revenue Per Available Room — ADR × occupancy">
                  RevPAR
                </th>
                <th className="px-4 py-3 text-right font-medium" title="Estimated room revenue = RevPAR × available rooms">
                  Est. Revenue
                </th>
              </tr>
            </thead>
            <tbody>
              {periodRows.map(({ property, configured, summary }) => (
                <tr key={property.code} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-3">
                    <span className="font-medium text-slate-900">{property.name}</span>
                    <span className="ml-1 text-xs text-slate-400">{property.code}</span>
                  </td>
                  {summary ? (
                    <>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-900">{pct(summary.occ)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-900">{rate(summary.adr)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-900">{rate(summary.revpar)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-900">{money(summary.estRevenue)}</td>
                    </>
                  ) : (
                    <td className="px-4 py-3 text-right text-slate-400" colSpan={4}>
                      {configured ? "no data for range" : "no key"}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-slate-400">
          Period occupancy/ADR/RevPAR are daily averages from Cloudbeds Data
          Insights. Revenue is estimated (RevPAR × current room count) and does not
          apply manual capacity adjustments (e.g. Kissimmee East renovation).
        </p>
      </section>

      {/* Today's operational snapshot (live) */}
      <section>
        <h2 className="mb-2 text-lg font-semibold text-slate-900">Today&apos;s snapshot</h2>
        <PortfolioView portfolio={portfolio} />
      </section>

      <p className="mt-6 text-xs text-slate-400">
        Aggregated metrics only · no guest PII · read-only · cached up to 10 min.
      </p>
    </main>
  );
}
