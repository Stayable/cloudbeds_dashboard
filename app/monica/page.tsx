import OccupancyView from "@/components/OccupancyView";
import PeriodControls from "@/components/PeriodControls";
import ControlBar, { ControlLabel } from "@/components/ControlBar";
import { PageHead } from "@/components/ui";
import CrystalRevenue from "@/components/CrystalRevenue";
import CrystalReservations from "@/components/CrystalReservations";
import FinanceSection from "@/components/FinanceSection";
import EvictionsSection from "@/components/EvictionsSection";
import ChangePin from "@/components/ChangePin";
import SectionNav, { type NavItem } from "@/components/SectionNav";
import { dayCount, resolveRange } from "@/lib/dates";
import { getOccupancyRollup } from "@/lib/db";
import { getPortfolio, getPortfolioReservations, getPortfolioFinance } from "@/lib/cloudbeds";
import { getEvictions } from "@/lib/smartsheet";
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
  { id: "evictions", label: "Evictions", n: 6 },
];

// Section header. The step number ties back to the numbered rail on the left.
function SectionHeading({ n, title, sub }: { n: number; title: string; sub: string }) {
  return (
    <div className="mb-3.5 flex items-start gap-2.5 border-b border-line pb-3">
      <span className="mt-1 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[4px] bg-surface3 text-[10px] font-semibold text-txt3">
        {n}
      </span>
      <div>
        <h2 className="text-[19px] font-semibold tracking-[-.02em] text-txt">{title}</h2>
        <p className="mt-[3px] text-[12.5px] text-txt3">{sub}</p>
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

  const [portfolio, rollup, reservations, finance, evictions] = await Promise.all([
    getPortfolio(),
    getOccupancyRollup(start, end),
    getPortfolioReservations(start, end),
    getPortfolioFinance(start, end),
    getEvictions(),
  ]);

  const properties = buildOccProperties(portfolio, rollup);
  const days = dayCount(start, end);
  const revenue = buildRevenueSummary(portfolio, rollup, days);
  const reservationViews = buildReservationViews(reservations);
  const financeViews = buildFinanceViews(finance);
  const rangeLabel = start === end ? start : `${start} → ${end}`;

  return (
    <>
      <ControlBar note={`${rangeLabel} · ${days} day${days === 1 ? "" : "s"} · Eastern`}>
        <ControlLabel>Period</ControlLabel>
        <PeriodControls preset={preset} start={start} end={end} />
      </ControlBar>

      <main className="mx-auto max-w-[1560px] animate-fadeup px-4 pb-16 pt-5 sm:px-6">
      <PageHead
        eyebrow="Stayable · Revenue Management"
        title={<>Monica&apos;s View</>}
        sub={<>Tailored to the metrics you selected — occupancy, rate, and revenue.</>}
      />

      <div className="mt-4 lg:flex lg:items-start lg:gap-[18px]">
        <SectionNav items={NAV} />

        <div className="min-w-0 flex-1">
          <section id="live" className="mb-8 scroll-mt-32 lg:scroll-mt-28">
            <SectionHeading n={1} title="Live now" sub="Today's snapshot · Eastern · per property below" />
            <p className="text-xs text-txt2">
              Live counts (rooms occupied, sellable capacity, out-of-service, blocked) are in
              the &ldquo;Today (live snapshot)&rdquo; cards within Property detail below.
            </p>
          </section>

          <section id="occupancy" className="mb-10 scroll-mt-32 lg:scroll-mt-28">
            <SectionHeading
              n={2}
              title="Occupancy"
              sub={`${rangeLabel} · ${days} day${days === 1 ? "" : "s"} · Eastern`}
            />
            <OccupancyView properties={properties} exportDate={end} />
          </section>

          <section id="revenue" className="mb-10 scroll-mt-32 lg:scroll-mt-28">
            <SectionHeading n={3} title="Revenue & rate" sub={`${rangeLabel} · ADR / RevPAR live, revenue est.`} />
            <CrystalRevenue summary={revenue} exportDate={end} />
          </section>

          <section id="reservations" className="mb-10 scroll-mt-32 lg:scroll-mt-28">
            <SectionHeading n={4} title="Reservations & pace" sub={`${rangeLabel} · aggregates only · no guest detail`} />
            <CrystalReservations views={reservationViews} rangeLabel={rangeLabel} exportDate={end} />
          </section>

          <section id="finance" className="mb-10 scroll-mt-32 lg:scroll-mt-28">
            <SectionHeading n={5} title="Finance" sub={`${rangeLabel} · net & transaction mix · aggregates only`} />
            <FinanceSection views={financeViews} rangeLabel={rangeLabel} exportDate={end} />
          </section>

          <section id="evictions" className="mb-10 scroll-mt-32 lg:scroll-mt-28">
            <SectionHeading n={6} title="Evictions" sub="Live from Smartsheet · counts only · no case detail" />
            <EvictionsSection
              configured={evictions.configured}
              error={evictions.error}
              views={evictions.views}
              asOf={end}
            />
          </section>

          <p className="mb-6 text-xs text-txt3">
            Aggregated metrics only · no guest PII · read-only · cached up to 10 min. Only
            properties with a configured Cloudbeds key report (Davenport today).
          </p>

          <ChangePin />
        </div>
      </div>
      </main>
    </>
  );
}
