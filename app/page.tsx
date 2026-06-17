import { type PropertyDashboard, getPortfolio } from "@/lib/cloudbeds";

// Render per-request so runtime env vars (CLOUDBEDS_API_KEY_*) are always read
// live — upstream Cloudbeds calls are still cached 10 min (Next data cache).
export const dynamic = "force-dynamic";

function pct(n: number) {
  return `${n.toFixed(1)}%`;
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-900">{value}</span>
    </div>
  );
}

function PropertyCard({ pd }: { pd: PropertyDashboard }) {
  const { property, configured, result } = pd;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold text-slate-900">{property.name}</h3>
        <span className="text-xs text-slate-400">
          {property.code} · ID {property.id}
        </span>
      </div>
      <p className="text-xs text-slate-400">{property.county} County</p>

      {!configured ? (
        <p className="mt-4 rounded-lg bg-slate-50 px-3 py-4 text-center text-sm text-slate-400">
          Awaiting key
          <br />
          <code className="text-xs">CLOUDBEDS_API_KEY_{property.code}</code>
        </p>
      ) : result && result.ok ? (
        (() => {
          const d = result.data;
          return (
            <>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="text-3xl font-semibold text-slate-900">
                  {pct(d.percentageOccupied)}
                </span>
                <span className="text-xs text-slate-500">
                  {d.roomsOccupied}/{d.capacity} rooms
                </span>
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-accent"
                  style={{ width: `${Math.min(100, d.percentageOccupied)}%` }}
                />
              </div>
              <div className="mt-4 space-y-1.5">
                <StatRow label="In-house (guests)" value={`${d.inHouse} (${d.guestsInHouse})`} />
                <StatRow label="Arrivals / Departures" value={`${d.arrivals} / ${d.departures}`} />
                <StatRow label="Stayovers" value={String(d.stayovers)} />
                <StatRow
                  label="Blocked / OOO"
                  value={`${d.roomsBlocked} / ${d.roomBlocks.out_of_service}`}
                />
              </div>
            </>
          );
        })()
      ) : (
        <div className="mt-4 rounded-lg bg-amber-50 px-3 py-3 text-xs text-amber-900">
          <p className="font-medium">
            {result && result.status ? `HTTP ${result.status}` : "Error"}
          </p>
          <p className="mt-0.5">{result ? result.error : "Unknown error"}</p>
        </div>
      )}
    </div>
  );
}

export default async function DashboardPage() {
  const portfolio = await getPortfolio();

  // Aggregate across properties that returned live data.
  const live = portfolio.flatMap((p) => (p.result?.ok ? [p.result.data] : []));
  const totalCapacity = live.reduce((s, d) => s + d.capacity, 0);
  const totalOccupied = live.reduce((s, d) => s + d.roomsOccupied, 0);
  const totalInHouse = live.reduce((s, d) => s + d.inHouse, 0);
  const totalArrivals = live.reduce((s, d) => s + Number(d.arrivals || 0), 0);
  const totalDepartures = live.reduce((s, d) => s + Number(d.departures || 0), 0);
  const totalBlocked = live.reduce((s, d) => s + d.roomsBlocked, 0);
  const portfolioOcc = totalCapacity > 0 ? (totalOccupied / totalCapacity) * 100 : null;

  const configuredCount = portfolio.filter((p) => p.configured).length;

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

      {/* Portfolio summary */}
      {portfolioOcc !== null && (
        <section className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:mb-8 sm:p-6">
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
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatRow label="In-house" value={String(totalInHouse)} />
            <StatRow label="Arrivals" value={String(totalArrivals)} />
            <StatRow label="Departures" value={String(totalDepartures)} />
            <StatRow label="Blocked" value={String(totalBlocked)} />
          </div>
        </section>
      )}

      {/* Per-property grid */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {portfolio.map((pd) => (
          <PropertyCard key={pd.property.code} pd={pd} />
        ))}
      </section>

      <p className="mt-6 text-xs text-slate-400">
        Aggregated metrics only · no guest PII · read-only · cached up to 10 min.
        ADR · RevPAR · revenue via Data Insights (next).
      </p>
    </main>
  );
}
