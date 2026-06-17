import OccupancyView, { type OccProperty } from "@/components/OccupancyView";
import PeriodControls from "@/components/PeriodControls";
import { dayCount, resolveRange } from "@/lib/dates";
import { getPortfolio, getPortfolioInsights } from "@/lib/cloudbeds";

// Render per-request so runtime env vars (CLOUDBEDS_API_KEY_*) are always read
// live — upstream Cloudbeds calls are still cached 10 min (Next data cache).
export const dynamic = "force-dynamic";

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

  const insByCode = new Map(insights.map((i) => [i.property.code, i]));

  const properties: OccProperty[] = portfolio.map((pd) => {
    const ins = insByCode.get(pd.property.code);
    const rows = ins?.result?.ok ? ins.result.data : [];
    const rawOcc = rows.length ? rows.reduce((s, r) => s + r.occupancy, 0) / rows.length : null;
    const d = pd.result?.ok ? pd.result.data : null;
    const live = d
      ? {
          roomsOccupied: d.roomsOccupied,
          capacity: d.capacity,
          inHouse: d.inHouse,
          guestsInHouse: d.guestsInHouse,
          arrivals: d.arrivals,
          arrivalsConfirmed: d.arrivalsConfirmed,
          departures: d.departures,
          departuresConfirmed: d.departuresConfirmed,
          stayovers: d.stayovers,
          roomsBlocked: d.roomsBlocked,
          outOfService: d.roomBlocks.out_of_service,
          percentageBlocked: d.percentageBlocked,
          bookings: d.bookings,
          cancellations: d.cancellations,
        }
      : null;
    return {
      code: pd.property.code,
      name: pd.property.name,
      county: pd.property.county,
      id: pd.property.id,
      configured: pd.configured,
      capacity: pd.result?.ok ? pd.result.data.capacity : 0,
      adjustment: pd.property.capacityAdjustment ?? 0,
      adjustmentNote: pd.property.adjustmentNote,
      excludeDefault: !!pd.property.excludeFromAggregate,
      rawOcc,
      daily: rows.map((r) => ({ date: r.date, occupancy: r.occupancy })),
      live,
      error: ins?.result && !ins.result.ok ? ins.result.error : null,
    };
  });

  const reportingCount = properties.filter((p) => p.rawOcc !== null).length;
  const configuredCount = properties.filter((p) => p.configured).length;
  const days = dayCount(start, end);
  const rangeLabel = start === end ? start : `${start} → ${end}`;

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <header className="mb-6 rounded-xl bg-ink px-5 py-4 text-white shadow-sm sm:mb-8 sm:px-6 sm:py-5">
        <p className="text-xs font-medium uppercase tracking-widest text-white/60">
          Stayable · Portfolio Occupancy Dashboard
        </p>
        <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h1 className="text-2xl font-semibold sm:text-3xl">All Properties</h1>
          <span className="text-sm text-white/70">
            {reportingCount} of {configuredCount} reporting · {properties.length} total
          </span>
        </div>
      </header>

      {/* Date range — drives the occupancy snapshot below */}
      <section className="mb-6">
        <div className="mb-3">
          <h2 className="text-lg font-semibold text-slate-900">Occupancy</h2>
          <p className="text-xs text-slate-500">
            {rangeLabel} · {days} day{days === 1 ? "" : "s"} · Eastern
          </p>
        </div>
        <PeriodControls preset={preset} start={start} end={end} />
      </section>

      <OccupancyView properties={properties} />

      <p className="mt-6 text-xs text-slate-400">
        Occupancy is the daily average over the selected range (Cloudbeds Data
        Insights). Aggregated metrics only · no guest PII · read-only · cached up
        to 10 min. Note: each property&apos;s &ldquo;Today (live snapshot)&rdquo;
        cards are always today&apos;s figures regardless of the selected range —
        flagged for later if we want range-aware operational metrics.
      </p>
    </main>
  );
}
