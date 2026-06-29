import OccupancyView from "@/components/OccupancyView";
import PeriodControls from "@/components/PeriodControls";
import PersonalViewEntry from "@/components/PersonalViewEntry";
import { dayCount, resolveRange } from "@/lib/dates";
import { getPortfolio, getPortfolioInsights } from "@/lib/cloudbeds";
import { buildOccProperties } from "@/lib/occupancy";
import SectionNav, { type NavItem } from "@/components/SectionNav";

const NAV: NavItem[] = [
  { id: "portfolio", label: "Portfolio", n: 1 },
  { id: "by-property", label: "By property", n: 2 },
  { id: "detail", label: "Detail", n: 3 },
];

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

  const properties = buildOccProperties(portfolio, insights);

  const reportingCount = properties.filter((p) => p.rawOcc !== null).length;
  const configuredCount = properties.filter((p) => p.configured).length;
  const days = dayCount(start, end);
  const rangeLabel = start === end ? start : `${start} → ${end}`;

  // Today's arrivals across the portfolio — live snapshot (getDashboard), always
  // today's figures regardless of the selected occupancy range. `arrivals` comes
  // back as a STRING per property; sum only the properties that answered.
  const arrivalsToday = portfolio.reduce(
    (acc, pd) => {
      if (!pd.result?.ok) return acc;
      const n = parseInt(pd.result.data.arrivals, 10);
      return {
        total: acc.total + (Number.isFinite(n) ? n : 0),
        confirmed: acc.confirmed + (pd.result.data.arrivalsConfirmed || 0),
        props: acc.props + 1,
      };
    },
    { total: 0, confirmed: 0, props: 0 },
  );

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <header className="mb-6 rounded-xl bg-ink px-5 py-4 text-white shadow-sm sm:mb-8 sm:px-6 sm:py-5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-medium uppercase tracking-widest text-white/60">
            Stayable · Portfolio Occupancy Dashboard
          </p>
          <PersonalViewEntry />
        </div>
        <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h1 className="text-2xl font-semibold sm:text-3xl">All Properties</h1>
          <span className="text-sm text-white/70">
            {reportingCount} of {configuredCount} reporting · {properties.length} total
          </span>
        </div>
      </header>

      {/* Arrivals today — portfolio-wide live snapshot, pinned on top */}
      <section className="mb-6">
        <div className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm sm:px-6 sm:py-5">
          <div>
            <p className="text-xs font-medium uppercase tracking-widest text-slate-500">
              Arrivals today
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {arrivalsToday.confirmed} confirmed · {arrivalsToday.props} of{" "}
              {configuredCount} properties reporting · Eastern
            </p>
          </div>
          <span className="text-4xl font-semibold text-slate-900 sm:text-5xl">
            {arrivalsToday.total}
          </span>
        </div>
      </section>

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

      <div className="lg:flex lg:gap-8">
        <SectionNav items={NAV} />
        <div className="min-w-0 flex-1">
          <OccupancyView properties={properties} exportDate={end} />
        </div>
      </div>

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
