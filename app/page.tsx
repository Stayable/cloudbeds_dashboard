import { PILOT_PROPERTY } from "@/config/properties";
import { getDashboard, getHotels } from "@/lib/cloudbeds";

// Render per-request so the runtime env var (CLOUDBEDS_API_KEY) is always read
// live — the upstream Cloudbeds call is still cached 10 min in lib/cloudbeds.ts
// (Next data cache), so this does not increase API load.
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const property = PILOT_PROPERTY;
  // Don't pass a hardcoded propertyID — let the single-property key resolve its
  // own property. getHotels reveals the key's real property ID for verification.
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
      </header>

      {/* Metric grid — populated once we confirm the live field shapes. */}
      <section className="mb-6 grid grid-cols-2 gap-3 sm:mb-8 sm:grid-cols-4 sm:gap-4">
        {["Occupancy", "Rooms Sold", "Arrivals", "Departures"].map((label) => (
          <div
            key={label}
            className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
          >
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              {label}
            </p>
            <p className="mt-2 text-2xl font-semibold text-slate-400">—</p>
          </div>
        ))}
      </section>

      {/* Key access — reveals the real property ID(s) this key can reach. */}
      <section className="mb-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">
            Properties this key can access (getHotels)
          </h2>
          <span
            className={
              "rounded-full px-2.5 py-0.5 text-xs font-medium " +
              (hotels.ok
                ? "bg-emerald-50 text-emerald-700"
                : "bg-amber-50 text-amber-700")
            }
          >
            {hotels.ok ? "ok" : "error"}
          </span>
        </div>
        <pre className="max-h-72 overflow-auto rounded-lg bg-slate-900 p-4 text-xs leading-relaxed text-slate-100">
          {JSON.stringify(hotels.ok ? hotels.data : hotels, null, 2)}
        </pre>
        <p className="mt-2 text-xs text-slate-400">
          Config has Davenport as ID {property.id} — confirm it matches the
          property ID returned here.
        </p>
      </section>

      {/* Live response diagnostic — lets us map real fields before typing the UI. */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">
            Cloudbeds live response (getDashboard)
          </h2>
          <span
            className={
              "rounded-full px-2.5 py-0.5 text-xs font-medium " +
              (result.ok
                ? "bg-emerald-50 text-emerald-700"
                : "bg-amber-50 text-amber-700")
            }
          >
            {result.ok ? "connected" : "not connected"}
          </span>
        </div>

        {result.ok ? (
          <pre className="max-h-[28rem] overflow-auto rounded-lg bg-slate-900 p-4 text-xs leading-relaxed text-slate-100">
            {JSON.stringify(result.data, null, 2)}
          </pre>
        ) : (
          <div className="rounded-lg bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-medium">
              {result.status ? `HTTP ${result.status}` : "Not reachable"}
            </p>
            <p className="mt-1">{result.error}</p>
            {"body" in result && result.body != null && (
              <pre className="mt-3 max-h-64 overflow-auto rounded bg-amber-100/60 p-3 text-xs">
                {JSON.stringify(result.body, null, 2)}
              </pre>
            )}
          </div>
        )}

        <p className="mt-3 text-xs text-slate-400">
          Aggregated metrics only · no guest PII · read-only · cached up to 10 min.
        </p>
      </section>
    </main>
  );
}
