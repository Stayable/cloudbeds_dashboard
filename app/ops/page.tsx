import Link from "next/link";
import OccupancyView from "@/components/OccupancyView";
import PeriodControls from "@/components/PeriodControls";
import EvictionsSection from "@/components/EvictionsSection";
import BeaOosExplorer, { type BeaProperty } from "@/components/BeaOosExplorer";
import ChangePin from "@/components/ChangePin";
import SectionNav, { type NavItem } from "@/components/SectionNav";
import { dayCount, resolveRange, easternToday } from "@/lib/dates";
import { getPortfolio, getPortfolioInsights, getPortfolioOoo } from "@/lib/cloudbeds";
import { getEvictions } from "@/lib/smartsheet";
import { buildOccProperties } from "@/lib/occupancy";

// Operations Dashboard — role-based (not person-named) operational view. Gated to
// the ops level (PIN in Neon dashboard_pins) OR exec/CEO. Sections: OOO rooms
// (live, from Bea's explorer), Leasing (pending Elise API), Occupancy (live),
// Evictions (live, Smartsheet), 1-Star Reviews (build in progress).
export const dynamic = "force-dynamic";

const NAV: NavItem[] = [
  { id: "oos", label: "OOO rooms", n: 1 },
  { id: "leasing", label: "Leasing", n: 2 },
  { id: "occupancy", label: "Occupancy", n: 3 },
  { id: "evictions", label: "Evictions", n: 4 },
  { id: "reviews", label: "1-Star Reviews", n: 5 },
];

function SectionHeading({ n, title, sub }: { n: number; title: string; sub: string }) {
  return (
    <div className="mb-3 flex items-baseline gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-semibold text-white">
        {n}
      </span>
      <div>
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        <p className="text-xs text-slate-500">{sub}</p>
      </div>
    </div>
  );
}

/** Dashed-border "coming soon" placeholder used by Leasing and 1-Star Reviews. */
function Placeholder({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-center">
      <p className="text-sm font-semibold text-slate-700">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-xs text-slate-500">{children}</p>
    </div>
  );
}

export default async function OpsPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; start?: string; end?: string }>;
}) {
  const sp = await searchParams;
  const { preset, start, end } = resolveRange(sp.preset, sp.start, sp.end);
  const asOf = easternToday();

  const [portfolio, insights, ooo, evictions] = await Promise.all([
    getPortfolio(),
    getPortfolioInsights(start, end),
    getPortfolioOoo(asOf),
    getEvictions(),
  ]);

  const properties = buildOccProperties(portfolio, insights);

  // Out-of-service rooms per property (same mapping as Bea's view).
  const oooByCode = new Map(ooo.map((o) => [o.property.code, o]));
  const oosProps: BeaProperty[] = portfolio.map((pd) => {
    const o = oooByCode.get(pd.property.code);
    return {
      id: pd.property.id,
      code: pd.property.code,
      name: pd.property.name,
      county: pd.property.county,
      configured: pd.configured,
      rooms: o?.result?.ok ? o.result.data : null,
      error: o?.result && !o.result.ok ? o.result.error : null,
    };
  });

  const days = dayCount(start, end);
  const rangeLabel = start === end ? start : `${start} → ${end}`;

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <header className="mb-6 rounded-xl bg-ink px-5 py-4 text-white shadow-sm sm:mb-8 sm:px-6 sm:py-5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-medium uppercase tracking-widest text-white/60">
            Stayable · Operations
          </p>
          <Link
            href="/"
            className="shrink-0 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/20"
          >
            ← Dashboard
          </Link>
        </div>
        <h1 className="mt-1 text-2xl font-semibold sm:text-3xl">Operations Dashboard</h1>
        <p className="mt-1 text-sm text-white/70">
          OOO rooms, leasing, occupancy, evictions, and reviews across the portfolio.
        </p>
      </header>

      <div className="lg:flex lg:gap-8">
        <SectionNav items={NAV} />

        <div className="min-w-0 flex-1">
          <section id="oos" className="mb-10 scroll-mt-20 lg:scroll-mt-6">
            <SectionHeading n={1} title="OOO rooms" sub="Live · pick a property → reasons, then rooms" />
            <BeaOosExplorer properties={oosProps} asOf={asOf} />
          </section>

          <section id="leasing" className="mb-10 scroll-mt-20 lg:scroll-mt-6">
            <SectionHeading n={2} title="Leasing" sub="Prospects & lease activity · pending vendor API" />
            <Placeholder title="Requesting leasing (read) API from Elise">
              Prospects and lease activity will appear here once EliseAI grants read-only API
              access. Request submitted — no data is shown until the scope is approved.
            </Placeholder>
          </section>

          <section id="occupancy" className="mb-10 scroll-mt-20 lg:scroll-mt-6">
            <SectionHeading
              n={3}
              title="Occupancy"
              sub={`${rangeLabel} · ${days} day${days === 1 ? "" : "s"} · Eastern`}
            />
            <div className="mb-4">
              <PeriodControls preset={preset} start={start} end={end} />
            </div>
            <OccupancyView properties={properties} exportDate={end} />
          </section>

          <section id="evictions" className="mb-10 scroll-mt-20 lg:scroll-mt-6">
            <SectionHeading n={4} title="Evictions" sub="Live from Smartsheet · counts only · no case detail" />
            <EvictionsSection
              configured={evictions.configured}
              error={evictions.error}
              views={evictions.views}
              asOf={end}
            />
          </section>

          <section id="reviews" className="mb-10 scroll-mt-20 lg:scroll-mt-6">
            <SectionHeading n={5} title="1-Star Reviews" sub="Low-rating reviews across properties" />
            <Placeholder title="Ongoing build">
              1-star review tracking is in development. This section will surface recent
              low-rating guest reviews per property once the source is wired.
            </Placeholder>
          </section>

          <p className="mb-6 text-xs text-slate-400">
            Aggregated metrics only · no guest PII · read-only · cached up to 10 min. Only
            properties with a configured Cloudbeds key report.
          </p>

          <ChangePin />
        </div>
      </div>
    </main>
  );
}
