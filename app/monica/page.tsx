import OccupancyView from "@/components/OccupancyView";
import PeriodControls from "@/components/PeriodControls";
import CrystalRevenue from "@/components/CrystalRevenue";
import CrystalReservations from "@/components/CrystalReservations";
import FinanceSection from "@/components/FinanceSection";
import SectionNav, { type NavItem } from "@/components/SectionNav";
import { dayCount, resolveRange } from "@/lib/dates";
import { getPortfolio, getPortfolioInsights, getPortfolioReservations, getPortfolioFinance } from "@/lib/cloudbeds";
import { buildOccProperties } from "@/lib/occupancy";
import { buildRevenueSummary } from "@/lib/revenue";
import { buildReservationViews } from "@/lib/reservations";
import { buildFinanceViews } from "@/lib/finance";

// Monica (Revenue Management) — tailored to her /test selections. Gated to the
// monica level (MONICA_PIN) OR exec/CEO.
export const dynamic = "force-dynamic";

const NAV: NavItem[] = [
  { id: "live", label: "Live now", n: 1 },
  { id: "occupancy", label: "Occupancy", n: 2 },
  { id: "revenue", label: "Revenue & rate", n: 3 },
  { id: "reservations", label: "Reservations", n: 4 },
  { id: "finance", label: "Finance", n: 5 },
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

export default async function MonicaPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; start?: string; end?: string }>;
}) {
  const sp = await searchParams;
  const { preset, start, end } = resolveRange(sp.preset, sp.start, sp.end);

  const [portfolio, insights, reservations, finance] = await Promise.all([
    getPortfolio(),
    getPortfolioInsights(start, end),
    getPortfolioReservations(start, end),
    getPortfolioFinance(start, end),
  ]);

  const properties = buildOccProperties(portfolio, insights);
  const days = dayCount(start, end);
  const revenue = buildRevenueSummary(portfolio, insights, days);
  const reservationViews = buildReservationViews(reservations);
  const financeViews = buildFinanceViews(finance);
  const rangeLabel = start === end ? start : `${start} → ${end}`;

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <header className="mb-6 rounded-xl bg-ink px-5 py-4 text-white shadow-sm sm:mb-8 sm:px-6 sm:py-5">
        <p className="text-xs font-medium uppercase tracking-widest text-white/60">
          Stayable · Revenue Management
        </p>
        <h1 className="mt-1 text-2xl font-semibold sm:text-3xl">Monica&apos;s View</h1>
        <p className="mt-1 text-sm text-white/70">
          Tailored to the metrics you selected — occupancy, rate, and revenue.
        </p>
      </header>

      <div className="lg:flex lg:gap-8">
        <SectionNav items={NAV} />

        <div className="min-w-0 flex-1">
          <section id="live" className="mb-8 scroll-mt-20 lg:scroll-mt-6">
            <SectionHeading n={1} title="Live now" sub="Today's snapshot · Eastern · per property below" />
            <p className="text-xs text-slate-500">
              Live counts (rooms occupied, sellable capacity, out-of-service, blocked) are in
              the &ldquo;Today (live snapshot)&rdquo; cards within Property detail below.
            </p>
          </section>

          <section id="occupancy" className="mb-10 scroll-mt-20 lg:scroll-mt-6">
            <SectionHeading
              n={2}
              title="Occupancy"
              sub={`${rangeLabel} · ${days} day${days === 1 ? "" : "s"} · Eastern`}
            />
            <div className="mb-4">
              <PeriodControls preset={preset} start={start} end={end} />
            </div>
            <OccupancyView properties={properties} />
          </section>

          <section id="revenue" className="mb-10 scroll-mt-20 lg:scroll-mt-6">
            <SectionHeading n={3} title="Revenue & rate" sub={`${rangeLabel} · ADR / RevPAR live, revenue est.`} />
            <CrystalRevenue summary={revenue} />
          </section>

          <section id="reservations" className="mb-10 scroll-mt-20 lg:scroll-mt-6">
            <SectionHeading n={4} title="Reservations & pace" sub={`${rangeLabel} · aggregates only · no guest detail`} />
            <CrystalReservations views={reservationViews} rangeLabel={rangeLabel} />
          </section>

          <section id="finance" className="mb-10 scroll-mt-20 lg:scroll-mt-6">
            <SectionHeading n={5} title="Finance" sub={`${rangeLabel} · net & transaction mix · aggregates only`} />
            <FinanceSection views={financeViews} rangeLabel={rangeLabel} />
          </section>

          <p className="text-xs text-slate-400">
            Aggregated metrics only · no guest PII · read-only · cached up to 10 min. Only
            properties with a configured Cloudbeds key report (Davenport today).
          </p>
        </div>
      </div>
    </main>
  );
}
