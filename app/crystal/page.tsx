import Link from "next/link";
import OccupancyView from "@/components/OccupancyView";
import PeriodControls from "@/components/PeriodControls";
import CrystalRevenue from "@/components/CrystalRevenue";
import CrystalReservations from "@/components/CrystalReservations";
import CrystalNotes from "@/components/CrystalNotes";
import { dayCount, resolveRange } from "@/lib/dates";
import { getPortfolio, getPortfolioInsights, getPortfolioReservations } from "@/lib/cloudbeds";
import { buildOccProperties } from "@/lib/occupancy";
import { buildRevenueSummary } from "@/lib/revenue";
import { buildReservationViews } from "@/lib/reservations";

// Render per-request so runtime env vars are read live; upstream Cloudbeds calls
// are still cached 10 min. Gated to the crystal/exec token by middleware.
export const dynamic = "force-dynamic";

const NAV = [
  { id: "live", label: "Live now", n: 1 },
  { id: "occupancy", label: "Occupancy", n: 2 },
  { id: "revenue", label: "Revenue & rate", n: 3 },
  { id: "reservations", label: "Reservations", n: 4 },
  { id: "notes", label: "Notes", n: null as number | null },
];

function SectionNav() {
  return (
    <nav className="mb-6 lg:mb-0 lg:w-44 lg:shrink-0">
      <div className="sticky top-4 z-10 -mx-4 bg-slate-50/95 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6 lg:top-6 lg:mx-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
        <p className="mb-2 hidden text-xs font-medium uppercase tracking-wide text-slate-400 lg:block">
          On this page
        </p>
        <ul className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:gap-1 lg:overflow-visible lg:pb-0">
          {NAV.map((item) => (
            <li key={item.id} className="shrink-0">
              <a
                href={`#${item.id}`}
                className="flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
              >
                {item.n !== null && (
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ink text-[10px] font-semibold text-white">
                    {item.n}
                  </span>
                )}
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}

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

export default async function CrystalPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; start?: string; end?: string }>;
}) {
  const sp = await searchParams;
  const { preset, start, end } = resolveRange(sp.preset, sp.start, sp.end);

  const [portfolio, insights, reservations] = await Promise.all([
    getPortfolio(),
    getPortfolioInsights(start, end),
    getPortfolioReservations(start, end),
  ]);

  const properties = buildOccProperties(portfolio, insights);
  const days = dayCount(start, end);
  const revenue = buildRevenueSummary(portfolio, insights, days);
  const reservationViews = buildReservationViews(reservations);
  const rangeLabel = start === end ? start : `${start} → ${end}`;

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <header className="mb-6 rounded-xl bg-ink px-5 py-4 text-white shadow-sm sm:mb-8 sm:px-6 sm:py-5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-medium uppercase tracking-widest text-white/60">
            Stayable · Operations Dashboard
          </p>
          <Link
            href="/"
            className="shrink-0 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/20"
          >
            ← Dashboard
          </Link>
        </div>
        <h1 className="mt-1 text-2xl font-semibold sm:text-3xl">Crystal&apos;s View</h1>
        <p className="mt-1 text-sm text-white/70">
          Tailored to the metrics you selected — live operations plus period trends.
        </p>
      </header>

      <div className="lg:flex lg:gap-8">
        <SectionNav />

        <div className="min-w-0 flex-1">
          {/* Section 1 — Live now */}
          <section id="live" className="mb-8 scroll-mt-20 lg:scroll-mt-6">
            <SectionHeading n={1} title="Live now" sub="Today's snapshot · Eastern · per property below" />
            <p className="text-xs text-slate-500">
              Each property&apos;s live counts (rooms occupied, in-house, guests, arrivals,
              departures, bookings, cancellations, blocked/OOO) are in the &ldquo;Today
              (live snapshot)&rdquo; cards within Property detail below.
            </p>
          </section>

          {/* Section 2 — Occupancy over the selected range (also carries the live cards) */}
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

          {/* Section 4 — Reservations & pace (aggregates only) */}
          <section id="reservations" className="mb-10 scroll-mt-20 lg:scroll-mt-6">
            <SectionHeading n={4} title="Reservations & pace" sub={`${rangeLabel} · aggregates only · no guest detail`} />
            <CrystalReservations views={reservationViews} rangeLabel={rangeLabel} />
          </section>

          {/* Notes / comments */}
          <section id="notes" className="scroll-mt-20 lg:scroll-mt-6">
            <CrystalNotes />
          </section>

          <p className="mt-8 text-xs text-slate-400">
            Aggregated metrics only · no guest PII · read-only · cached up to 10 min. The
            &ldquo;Today (live snapshot)&rdquo; cards are always today&apos;s figures regardless
            of the selected range.
          </p>
        </div>
      </div>
    </main>
  );
}
