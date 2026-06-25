import OccupancyView from "@/components/OccupancyView";
import PeriodControls from "@/components/PeriodControls";
import CrystalRevenue from "@/components/CrystalRevenue";
import CrystalReservations from "@/components/CrystalReservations";
import FinanceSection from "@/components/FinanceSection";
import ExecFeedback from "@/components/ExecFeedback";
import ChangePin from "@/components/ChangePin";
import SectionNav, { type NavItem } from "@/components/SectionNav";
import { dayCount, resolveRange } from "@/lib/dates";
import { getPortfolio, getPortfolioInsights, getPortfolioReservations, getPortfolioFinance } from "@/lib/cloudbeds";
import { buildOccProperties } from "@/lib/occupancy";
import { buildRevenueSummary } from "@/lib/revenue";
import { buildReservationViews } from "@/lib/reservations";
import { buildFinanceViews } from "@/lib/finance";

// Rob's CEO view — tailored to his /test selections. Exec-gated (middleware:
// requiredLevel("/rob") => exec; Rob unlocks with the existing EXEC_PIN).
export const dynamic = "force-dynamic";

const NAV: NavItem[] = [
  { id: "live", label: "Live now", n: 1 },
  { id: "occupancy", label: "Occupancy", n: 2 },
  { id: "revenue", label: "Revenue & rate", n: 3 },
  { id: "reservations", label: "Reservations", n: 4 },
  { id: "finance", label: "Finance", n: 5 },
  { id: "notes", label: "Notes", n: null },
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

export default async function RobPage({
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
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-medium uppercase tracking-widest text-white/60">
            Stayable · CEO Dashboard
          </p>
        </div>
        <h1 className="mt-1 text-2xl font-semibold sm:text-3xl">Rob&apos;s View</h1>
        <p className="mt-1 text-sm text-white/70">
          Tailored to the metrics you selected — live ops, occupancy, revenue, and
          reservation financials.
        </p>
      </header>

      <div className="lg:flex lg:gap-8">
        <SectionNav items={NAV} />

        <div className="min-w-0 flex-1">
          {/* Section 1 — Live now */}
          <section id="live" className="mb-8 scroll-mt-20 lg:scroll-mt-6">
            <SectionHeading n={1} title="Live now" sub="Today's snapshot · Eastern · per property below" />
            <p className="text-xs text-slate-500">
              Each property&apos;s live counts (rooms occupied, in-house, arrivals,
              departures, stayovers, bookings, cancellations, blocked/OOO) are in the
              &ldquo;Today (live snapshot)&rdquo; cards within Property detail below.
            </p>
          </section>

          {/* Section 2 — Occupancy */}
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

          {/* Section 3 — Revenue & rate */}
          <section id="revenue" className="mb-10 scroll-mt-20 lg:scroll-mt-6">
            <SectionHeading n={3} title="Revenue & rate" sub={`${rangeLabel} · ADR / RevPAR live, revenue est.`} />
            <CrystalRevenue summary={revenue} />
          </section>

          {/* Section 4 — Reservations & pace (with financials) */}
          <section id="reservations" className="mb-10 scroll-mt-20 lg:scroll-mt-6">
            <SectionHeading n={4} title="Reservations & pace" sub={`${rangeLabel} · aggregates only · no guest detail`} />
            <CrystalReservations views={reservationViews} rangeLabel={rangeLabel} showFinancials />
          </section>

          {/* Section 5 — Finance */}
          <section id="finance" className="mb-10 scroll-mt-20 lg:scroll-mt-6">
            <SectionHeading n={5} title="Finance" sub={`${rangeLabel} · charges, payments, net · aggregates only`} />
            <FinanceSection views={financeViews} rangeLabel={rangeLabel} />
          </section>

          {/* Honest note on what's not shown */}
          <div className="mb-10 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-600">
            <p className="font-medium text-slate-700">A couple of your selections still aren&apos;t shown:</p>
            <ul className="mt-2 space-y-1">
              <li>
                <span className="font-medium">Housekeeping</span> (room condition/status,
                front-desk status, housekeeper, DND, count-by-status) — excluded by policy:
                the dashboard never enables the Housekeeping API scope.
              </li>
              <li>
                <span className="font-medium">A few reservation/segment fields</span>
                (booking window, cancellation/no-show fees, commission %, reservation source,
                market segment) — not exposed as aggregatable columns we&apos;ve verified.
              </li>
            </ul>
            <p className="mt-2 text-xs text-slate-400">No placeholder numbers — these are listed, not faked.</p>
          </div>

          <p className="mb-8 text-xs text-slate-400">
            Aggregated metrics only · no guest PII · read-only · cached up to 10 min. Only
            properties with a configured Cloudbeds key report (Davenport today). The
            &ldquo;Today (live snapshot)&rdquo; cards are always today&apos;s figures regardless
            of the selected range.
          </p>

          {/* Notes / feedback (posts as Rob's exec feedback) — below everything */}
          <section id="notes" className="mb-6 scroll-mt-20 lg:scroll-mt-6">
            <ExecFeedback />
          </section>

          <ChangePin />
        </div>
      </div>
    </main>
  );
}
