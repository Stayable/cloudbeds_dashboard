import OccupancyView from "@/components/OccupancyView";
import PeriodControls from "@/components/PeriodControls";
import ControlBar, { ControlLabel } from "@/components/ControlBar";
import { PageHead } from "@/components/ui";
import CrystalRevenue from "@/components/CrystalRevenue";
import CrystalReservations from "@/components/CrystalReservations";
import CrystalNotes from "@/components/CrystalNotes";
import ChangePin from "@/components/ChangePin";
import SectionNav, { type NavItem } from "@/components/SectionNav";
import { dayCount, resolveRange } from "@/lib/dates";
import { getOccupancyRollup } from "@/lib/db";
import { getPortfolio, getPortfolioReservations } from "@/lib/cloudbeds";
import { buildOccProperties } from "@/lib/occupancy";
import { buildRevenueSummary } from "@/lib/revenue";
import { buildReservationViews } from "@/lib/reservations";

// Render per-request so runtime env vars are read live; upstream Cloudbeds calls
// are still cached 10 min. Gated to the crystal/exec token by middleware.
export const dynamic = "force-dynamic";

const NAV: NavItem[] = [
  { id: "live", label: "Live now", n: 1 },
  { id: "occupancy", label: "Occupancy", n: 2 },
  { id: "revenue", label: "Revenue & rate", n: 3 },
  { id: "reservations", label: "Reservations", n: 4 },
  { id: "notes", label: "Notes", n: null },
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

export default async function CrystalPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; start?: string; end?: string }>;
}) {
  const sp = await searchParams;
  const { preset, start, end } = resolveRange(sp.preset, sp.start, sp.end);

  const [portfolio, rollup, reservations] = await Promise.all([
    getPortfolio(),
    getOccupancyRollup(start, end),
    getPortfolioReservations(start, end),
  ]);

  const properties = buildOccProperties(portfolio, rollup);
  const days = dayCount(start, end);
  const revenue = buildRevenueSummary(portfolio, rollup, days);
  const reservationViews = buildReservationViews(reservations);
  const rangeLabel = start === end ? start : `${start} → ${end}`;

  return (
    <>
      <ControlBar note={`${rangeLabel} · ${days} day${days === 1 ? "" : "s"} · Eastern`}>
        <ControlLabel>Period</ControlLabel>
        <PeriodControls preset={preset} start={start} end={end} />
      </ControlBar>

      <main className="mx-auto max-w-[1560px] animate-fadeup px-4 pb-16 pt-5 sm:px-6">
      <PageHead
        eyebrow="Stayable · Operations Dashboard"
        title={<>Crystal&apos;s View</>}
        sub={<>Tailored to the metrics you selected — live operations plus period trends.</>}
      />

      <div className="mt-4 lg:flex lg:items-start lg:gap-[18px]">
        <SectionNav items={NAV} />

        <div className="min-w-0 flex-1">
          {/* Section 1 — Live now */}
          <section id="live" className="mb-8 scroll-mt-32 lg:scroll-mt-28">
            <SectionHeading n={1} title="Live now" sub="Today's snapshot · Eastern · per property below" />
            <p className="text-xs text-txt2">
              Each property&apos;s live counts (rooms occupied, in-house, guests, arrivals,
              departures, bookings, cancellations, blocked/OOO) are in the &ldquo;Today
              (live snapshot)&rdquo; cards within Property detail below.
            </p>
          </section>

          {/* Section 2 — Occupancy over the selected range (also carries the live cards) */}
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

          {/* Section 4 — Reservations & pace (aggregates only) */}
          <section id="reservations" className="mb-10 scroll-mt-32 lg:scroll-mt-28">
            <SectionHeading n={4} title="Reservations & pace" sub={`${rangeLabel} · aggregates only · no guest detail`} />
            <CrystalReservations views={reservationViews} rangeLabel={rangeLabel} exportDate={end} />
          </section>

          <p className="mb-8 text-xs text-txt3">
            Aggregated metrics only · no guest PII · read-only · cached up to 10 min. The
            &ldquo;Today (live snapshot)&rdquo; cards are always today&apos;s figures regardless
            of the selected range.
          </p>

          {/* Notes / comments — below everything */}
          <section id="notes" className="mb-6 scroll-mt-32 lg:scroll-mt-28">
            <CrystalNotes />
          </section>

          <ChangePin />
        </div>
      </div>
      </main>
    </>
  );
}
