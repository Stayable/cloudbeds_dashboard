import PropertyTabs from "@/components/PropertyTabs";
import { getPortfolio } from "@/lib/cloudbeds";

// Render per-request so runtime env vars (CLOUDBEDS_API_KEY_*) are always read
// live — upstream Cloudbeds calls are still cached 10 min (Next data cache).
export const dynamic = "force-dynamic";

function pct(n: number) {
  return `${n.toFixed(1)}%`;
}

export default async function DashboardPage() {
  const portfolio = await getPortfolio();

  // Aggregate across properties that returned live data, excluding any flagged
  // out of the aggregate (e.g. Jacksonville North — no bookings).
  const live = portfolio.flatMap((p) =>
    p.result?.ok && !p.property.excludeFromAggregate ? [p.result.data] : [],
  );
  const totalCapacity = live.reduce((s, d) => s + d.capacity, 0);
  const totalOccupied = live.reduce((s, d) => s + d.roomsOccupied, 0);
  const totalInHouse = live.reduce((s, d) => s + d.inHouse, 0);
  const totalArrivals = live.reduce((s, d) => s + Number(d.arrivals || 0), 0);
  const totalDepartures = live.reduce((s, d) => s + Number(d.departures || 0), 0);
  const totalBlocked = live.reduce((s, d) => s + d.roomsBlocked, 0);
  const portfolioOcc = totalCapacity > 0 ? (totalOccupied / totalCapacity) * 100 : null;

  const configuredCount = portfolio.filter((p) => p.configured).length;
  const excludedNames = portfolio
    .filter((p) => p.property.excludeFromAggregate)
    .map((p) => p.property.name);

  // Rank properties by current occupancy (reporting first, highest first),
  // excluding any flagged out of the aggregate (e.g. JN).
  const occRanked = portfolio
    .filter((p) => !p.property.excludeFromAggregate)
    .sort((a, b) => {
    const ao = a.result?.ok ? a.result.data.percentageOccupied : -1;
    const bo = b.result?.ok ? b.result.data.percentageOccupied : -1;
    return bo - ao;
  });

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      {/* Header */}
      <header className="mb-6 rounded-xl bg-ink px-5 py-4 text-white shadow-sm sm:mb-8 sm:px-6 sm:py-5">
        <p className="text-xs font-medium uppercase tracking-widest text-white/60">
          Stayable · Portfolio Operating Dashboard
        </p>
        <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h1 className="text-2xl font-semibold sm:text-3xl">All Properties</h1>
          <span className="text-sm text-white/70">
            {live.length} of {configuredCount} reporting · {portfolio.length} total
          </span>
        </div>
      </header>

      {/* Portfolio aggregate occupancy */}
      {portfolioOcc !== null && (
        <section className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Portfolio Occupancy
          </p>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-4">
            <span className="text-4xl font-semibold text-slate-900 sm:text-5xl">
              {pct(portfolioOcc)}
            </span>
            <span className="text-sm text-slate-500">
              {totalOccupied} of {totalCapacity} rooms occupied
            </span>
          </div>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-accent"
              style={{ width: `${Math.min(100, portfolioOcc)}%` }}
            />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-slate-500">In-house</span>
              <span className="font-medium text-slate-900">{totalInHouse}</span>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-slate-500">Arrivals</span>
              <span className="font-medium text-slate-900">{totalArrivals}</span>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-slate-500">Departures</span>
              <span className="font-medium text-slate-900">{totalDepartures}</span>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-slate-500">Blocked</span>
              <span className="font-medium text-slate-900">{totalBlocked}</span>
            </div>
          </div>
        </section>
      )}

      {/* Current occupancy by property — quick glance, ranked */}
      <section className="mb-6 sm:mb-8">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
          Current occupancy by property
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {occRanked.map((pd) => {
            const occ = pd.result?.ok ? pd.result.data.percentageOccupied : null;
            return (
              <div
                key={pd.property.code}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm"
              >
                <p className="truncate text-xs text-slate-500">{pd.property.name}</p>
                <p className="text-lg font-semibold text-slate-900">
                  {occ !== null ? pct(occ) : "—"}
                </p>
              </div>
            );
          })}
        </div>
        {excludedNames.length > 0 && (
          <p className="mt-2 text-xs text-slate-400">
            {excludedNames.join(", ")} excluded from the average (no bookings) —
            still viewable in the tabs below.
          </p>
        )}
      </section>

      {/* Individual property data — clickable tabs */}
      <section>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
          Property detail
        </p>
        <PropertyTabs portfolio={portfolio} />
      </section>

      <p className="mt-6 text-xs text-slate-400">
        Aggregated metrics only · no guest PII · read-only · cached up to 10 min.
        ADR · RevPAR · revenue via Data Insights (next).
      </p>
    </main>
  );
}
