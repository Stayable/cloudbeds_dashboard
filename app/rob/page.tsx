import OccupancyView from "@/components/OccupancyView";
import PeriodControls from "@/components/PeriodControls";
import ControlBar, { ControlLabel } from "@/components/ControlBar";
import { PageHead, chromeButton, surfaceButton } from "@/components/ui";
import CrystalRevenue from "@/components/CrystalRevenue";
import CrystalReservations from "@/components/CrystalReservations";
import FinanceSection from "@/components/FinanceSection";
import ExecFeedback from "@/components/ExecFeedback";
import ChangePin from "@/components/ChangePin";
import SectionNav, { type NavItem } from "@/components/SectionNav";
import ContractorSchedule from "@/components/ContractorSchedule";
import { getContractorSchedule } from "@/lib/contractor-schedule";
import { dayCount, resolveRange } from "@/lib/dates";
import { getOccupancyRollup } from "@/lib/db";
import { getPortfolio, getPortfolioReservations, getPortfolioFinance } from "@/lib/cloudbeds";
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
  { id: "contractors", label: "Contractors", n: 6 },
  { id: "notes", label: "Notes", n: null },
];

// External systems Rob wants one click away from this dashboard. Not part of this
// app — plain outbound links, opened in a new tab so his view is never replaced.
const EXTERNAL_LINKS: { label: string; href: string }[] = [
  { label: "Checklist", href: "https://ops.rentstayable.com" },
  { label: "Rewards", href: "https://rewards.rentstayable.com" },
  { label: "Invest", href: "https://invest.rise8companies.com/" },
  { label: "Lock", href: "https://lock.rentstayable.com" },
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

export default async function RobPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; start?: string; end?: string }>;
}) {
  const sp = await searchParams;
  const { preset, start, end } = resolveRange(sp.preset, sp.start, sp.end);

  const [portfolio, rollup, reservations, finance, schedule] = await Promise.all([
    getPortfolio(),
    getOccupancyRollup(start, end),
    getPortfolioReservations(start, end),
    getPortfolioFinance(start, end),
    getContractorSchedule(),
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
        eyebrow="Stayable · CEO Dashboard"
        title={<>Rob&apos;s View</>}
        sub={<>Tailored to the metrics you selected — live ops, occupancy, revenue, and
          reservation financials.</>}
      >
        {EXTERNAL_LINKS.map((l) => (
          <a
            key={l.href}
            href={l.href}
            target="_blank"
            rel="noopener noreferrer"
            className={chromeButton}
          >
            {l.label}
            <span aria-hidden className="ml-1.5 text-[10px] opacity-60">↗</span>
          </a>
        ))}
      </PageHead>

      <div className="mt-4 lg:flex lg:items-start lg:gap-[18px]">
        <SectionNav items={NAV} />

        <div className="min-w-0 flex-1">
          {/* Section 1 — Live now */}
          <section id="live" className="mb-8 scroll-mt-32 lg:scroll-mt-28">
            <SectionHeading n={1} title="Live now" sub="Today's snapshot · Eastern · per property below" />
            <p className="text-xs text-txt2">
              Each property&apos;s live counts (rooms occupied, in-house, arrivals,
              departures, stayovers, bookings, cancellations, blocked/OOO) are in the
              &ldquo;Today (live snapshot)&rdquo; cards within Property detail below.
            </p>
          </section>

          {/* Section 2 — Occupancy */}
          <section id="occupancy" className="mb-10 scroll-mt-32 lg:scroll-mt-28">
            <SectionHeading
              n={2}
              title="Occupancy"
              sub={`${rangeLabel} · ${days} day${days === 1 ? "" : "s"} · Eastern`}
            />
            <OccupancyView properties={properties} exportDate={end} />
          </section>

          {/* Section 3 — Revenue & rate */}
          <section id="revenue" className="mb-10 scroll-mt-32 lg:scroll-mt-28">
            <SectionHeading n={3} title="Revenue & rate" sub={`${rangeLabel} · ADR / RevPAR live, revenue est.`} />
            <CrystalRevenue summary={revenue} exportDate={end} />
          </section>

          {/* Section 4 — Reservations & pace (with financials) */}
          <section id="reservations" className="mb-10 scroll-mt-32 lg:scroll-mt-28">
            <SectionHeading n={4} title="Reservations & pace" sub={`${rangeLabel} · aggregates only · no guest detail`} />
            <CrystalReservations views={reservationViews} rangeLabel={rangeLabel} showFinancials exportDate={end} />
          </section>

          {/* Section 5 — Finance */}
          <section id="finance" className="mb-10 scroll-mt-32 lg:scroll-mt-28">
            <SectionHeading n={5} title="Finance" sub={`${rangeLabel} · charges, payments, net · aggregates only`} />
            <FinanceSection views={financeViews} rangeLabel={rangeLabel} exportDate={end} />
          </section>

          {/* §6 Contractor schedule — Smartsheet, one tab per weekday, opens on
              today (Eastern). Independent of the page's date-range controls:
              this is the crew's current week, not a period metric. */}
          <section id="contractors" className="mb-10 scroll-mt-32 lg:scroll-mt-28">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <SectionHeading
                n={6}
                title="Contractor schedule"
                sub={
                  schedule.ok
                    ? `${schedule.data.sheetName} · ${schedule.data.totalRows} assignments · opens on today (ET)`
                    : "Weekly crew plan from Smartsheet"
                }
              />
              {schedule.ok && schedule.data.permalink && (
                <a
                  href={schedule.data.permalink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={surfaceButton}
                >
                  Open in Smartsheet ↗
                </a>
              )}
            </div>
            {schedule.ok ? (
              <ContractorSchedule schedule={schedule.data} />
            ) : (
              <p className="rounded-lg bg-warnbg px-4 py-3 text-sm text-warn">
                Couldn&apos;t load the contractor schedule: {schedule.error}
              </p>
            )}
          </section>

          {/* Honest note on what's not shown */}
          <div className="mb-10 rounded-[10px] border border-dashed border-lineStrong bg-surface2 p-5 text-sm text-txt2">
            <p className="font-medium text-txt">A couple of your selections still aren&apos;t shown:</p>
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
            <p className="mt-2 text-xs text-txt3">No placeholder numbers — these are listed, not faked.</p>
          </div>

          <p className="mb-8 text-xs text-txt3">
            Aggregated metrics only · no guest PII · read-only · cached up to 10 min. Only
            properties with a configured Cloudbeds key report (Davenport today). The
            &ldquo;Today (live snapshot)&rdquo; cards are always today&apos;s figures regardless
            of the selected range.
          </p>

          {/* Notes / feedback (posts as Rob's exec feedback) — below everything */}
          <section id="notes" className="mb-6 scroll-mt-32 lg:scroll-mt-28">
            <ExecFeedback />
          </section>

          <ChangePin />
        </div>
      </div>
      </main>
    </>
  );
}
