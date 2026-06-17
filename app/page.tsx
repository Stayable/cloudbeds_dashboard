import { PILOT_PROPERTY } from "@/config/properties";
import { type DashboardData, getDashboard, getHotels } from "@/lib/cloudbeds";

// Render per-request so the runtime env var (CLOUDBEDS_API_KEY) is always read
// live — the upstream Cloudbeds call is still cached 10 min in lib/cloudbeds.ts
// (Next data cache), so this does not increase API load.
export const dynamic = "force-dynamic";

function Metric({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold text-slate-900 sm:text-3xl">
        {value}
      </p>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

function DashboardView({ d }: { d: DashboardData }) {
  return (
    <>
      {/* Occupancy hero */}
      <section className="mb-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:mb-6 sm:p-6">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
          Occupancy
        </p>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-4">
          <span className="text-4xl font-semibold text-slate-900 sm:text-5xl">
            {d.percentageOccupied.toFixed(1)}%
          </span>
          <span className="text-sm text-slate-500">
            {d.roomsOccupied} of {d.capacity} rooms occupied
          </span>
        </div>
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-accent"
            style={{ width: `${Math.min(100, d.percentageOccupied)}%` }}
          />
        </div>
      </section>

      {/* Metric grid */}
      <section className="mb-6 grid grid-cols-2 gap-3 sm:mb-8 sm:grid-cols-4 sm:gap-4">
        <Metric label="Rooms Occupied" value={String(d.roomsOccupied)} sub={`of ${d.capacity} total`} />
        <Metric label="In-House" value={String(d.inHouse)} sub={`${d.guestsInHouse} guests`} />
        <Metric label="Arrivals" value={String(d.arrivals)} sub={`${d.arrivalsConfirmed} confirmed`} />
        <Metric label="Departures" value={String(d.departures)} sub={`${d.departuresConfirmed} confirmed`} />
        <Metric label="Stayovers" value={String(d.stayovers)} />
        <Metric
          label="Rooms Blocked"
          value={String(d.roomsBlocked)}
          sub={`${d.roomBlocks.out_of_service} out of service · ${d.percentageBlocked.toFixed(1)}%`}
        />
        <Metric label="Bookings (today)" value={String(d.bookings)} />
        <Metric label="Cancellations" value={String(d.cancellations)} />
      </section>

      <p className="mb-6 text-xs text-slate-400">
        ADR · RevPAR · revenue not in this endpoint — sourced from Data Insights
        (next). Aggregated metrics only · no guest PII · read-only.
      </p>
    </>
  );
}

export default async function DashboardPage() {
  const property = PILOT_PROPERTY;
  // Single-property key resolves its own property; getHotels confirms the ID.
  const [hotels, result] = await Promise.all([getHotels(), getDashboard()]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
      {/* Header */}
      <header className="mb-6 rounded-xl bg-ink px-5 py-4 text-white shadow-sm sm:mb-8 sm:px-6 sm:py-5">
        <p className="text-xs font-medium uppercase tracking-widest text-white/60">
          Stayable · Operating Dashboard
        </p>
        <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h1 className="text-2xl font-semibold sm:text-3xl">{property.name}</h1>
          <span className="text-sm text-white/70">
            Property ID {property.id} · {property.county} County
          </span>
        </div>
        {result.ok && (
          <p className="mt-2 text-xs text-white/50">
            As of {result.data.property_now} ({result.data.timezone}) · cached up
            to 10 min
          </p>
        )}
      </header>

      {result.ok ? (
        <DashboardView d={result.data} />
      ) : (
        <section className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
          <p className="font-medium">
            {result.status ? `HTTP ${result.status}` : "Not connected"} —
            dashboard data unavailable
          </p>
          <p className="mt-1">{result.error}</p>
          {result.body != null && (
            <pre className="mt-3 max-h-64 overflow-auto rounded bg-amber-100/60 p-3 text-xs">
              {JSON.stringify(result.body, null, 2)}
            </pre>
          )}
        </section>
      )}

      {/* Diagnostics — collapsed by default. */}
      <details className="rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
        <summary className="cursor-pointer font-medium text-slate-700">
          Raw API responses (diagnostics)
        </summary>
        <div className="mt-3 space-y-4">
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              getHotels {hotels.ok ? "ok" : "error"}
            </p>
            <pre className="max-h-72 overflow-auto rounded-lg bg-slate-900 p-4 text-xs leading-relaxed text-slate-100">
              {JSON.stringify(hotels.ok ? hotels.data : hotels, null, 2)}
            </pre>
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              getDashboard {result.ok ? "ok" : "error"}
            </p>
            <pre className="max-h-72 overflow-auto rounded-lg bg-slate-900 p-4 text-xs leading-relaxed text-slate-100">
              {JSON.stringify(result.ok ? result.data : result, null, 2)}
            </pre>
          </div>
        </div>
      </details>
    </main>
  );
}
