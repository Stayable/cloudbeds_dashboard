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
  // back as a STRING per property. COUNTS ONLY — no guest-level data is fetched
  // or shown (CLAUDE.md §5 rule 2: no guest PII on the public page, ever).
  const arrivalRows = portfolio
    .filter((pd) => pd.result?.ok)
    .map((pd) => {
      const d = pd.result!.ok ? pd.result!.data : null;
      const n = parseInt(d!.arrivals, 10);
      return {
        code: pd.property.code,
        name: pd.property.name,
        county: pd.property.county,
        id: pd.property.id,
        arrivals: Number.isFinite(n) ? n : 0,
        confirmed: d!.arrivalsConfirmed || 0,
      };
    })
    .sort((a, b) => b.arrivals - a.arrivals || a.name.localeCompare(b.name));

  const arrivalsToday = {
    total: arrivalRows.reduce((s, r) => s + r.arrivals, 0),
    confirmed: arrivalRows.reduce((s, r) => s + r.confirmed, 0),
    props: arrivalRows.length,
  };

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

      {/* Arrivals today — portfolio-wide live snapshot, pinned on top. Collapsed
          accordion (native <details>); expands to per-property counts. Counts
          only — no guest PII (CLAUDE.md §5 rule 2). */}
      <section className="mb-6">
        <details className="group rounded-xl border border-slate-200 bg-white shadow-sm">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 sm:px-6 sm:py-5 [&::-webkit-details-marker]:hidden">
            <div>
              <p className="text-xs font-medium uppercase tracking-widest text-slate-500">
                Arrivals today
              </p>
              <p className="mt-1 text-xs text-slate-400">
                {arrivalsToday.confirmed} confirmed · {arrivalsToday.props} of{" "}
                {configuredCount} properties reporting · Eastern
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-4xl font-semibold text-slate-900 sm:text-5xl">
                {arrivalsToday.total}
              </span>
              <svg
                className="h-5 w-5 shrink-0 text-slate-400 transition-transform duration-200 group-open:rotate-180"
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
          </summary>
          <div className="border-t border-slate-100 px-5 py-2 sm:px-6">
            {arrivalRows.length === 0 ? (
              <p className="py-3 text-sm text-slate-400">No properties reporting.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {arrivalRows.map((r) => (
                  <li key={r.code} className="flex items-center justify-between gap-3 py-2.5">
                    <span className="min-w-0 truncate text-sm font-medium text-slate-800">
                      {r.name}
                      <span className="ml-2 text-xs font-normal text-slate-400">
                        {r.county} · {r.id}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm tabular-nums text-slate-700">
                      <span className="font-semibold text-slate-900">{r.arrivals}</span>
                      <span className="ml-1 text-xs text-slate-400">
                        arriving · {r.confirmed} confirmed
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="py-2 text-[11px] text-slate-400">
              Counts only — arriving reservations per property. No guest details.
            </p>
          </div>
        </details>
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
