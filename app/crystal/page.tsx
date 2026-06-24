import Link from "next/link";
import OccupancyView from "@/components/OccupancyView";
import PeriodControls from "@/components/PeriodControls";
import CrystalRevenue from "@/components/CrystalRevenue";
import CrystalNotes from "@/components/CrystalNotes";
import { dayCount, resolveRange } from "@/lib/dates";
import { getPortfolio, getPortfolioInsights } from "@/lib/cloudbeds";
import { buildOccProperties } from "@/lib/occupancy";
import { buildRevenueSummary } from "@/lib/revenue";

// Render per-request so runtime env vars are read live; upstream Cloudbeds calls
// are still cached 10 min. Gated to the crystal/exec token by middleware.
export const dynamic = "force-dynamic";

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

  const [portfolio, insights] = await Promise.all([
    getPortfolio(),
    getPortfolioInsights(start, end),
  ]);

  const properties = buildOccProperties(portfolio, insights);
  const days = dayCount(start, end);
  const revenue = buildRevenueSummary(portfolio, insights, days);
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

      {/* Section 1 — Live now */}
      <section className="mb-8">
        <SectionHeading n={1} title="Live now" sub="Today's snapshot · Eastern · per property below" />
        <p className="text-xs text-slate-500">
          Each property&apos;s live counts (rooms occupied, in-house, guests, arrivals,
          departures, bookings, cancellations, blocked/OOO) are in the &ldquo;Today
          (live snapshot)&rdquo; cards within Property detail below.
        </p>
      </section>

      {/* Section 2 — Occupancy over the selected range (also carries the live cards) */}
      <section className="mb-10">
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
      <section className="mb-10">
        <SectionHeading n={3} title="Revenue & rate" sub={`${rangeLabel} · ADR / RevPAR live, revenue est.`} />
        <CrystalRevenue summary={revenue} />
      </section>

      {/* Section 4 — Reservations & pace (aggregates only) */}
      <section className="mb-10">
        <SectionHeading n={4} title="Reservations & pace" sub="Aggregates only · no guest detail" />
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-600">
          <p className="font-medium text-slate-700">In progress — pending live data verification.</p>
          <p className="mt-1">
            These reservation metrics you selected are aggregate-only and need a one-time
            probe against the Cloudbeds reservations dataset before they go live (column
            names and which currency totals the API will actually sum):
          </p>
          <ul className="mt-2 grid gap-1 sm:grid-cols-2">
            {[
              "Reservation status mix",
              "Rate-plan mix",
              "Room type / room-type category",
              "Room nights · rooms per reservation",
              "Reservation grand total (Σ)",
              "Paid amount (Σ) · balance due (Σ)",
              "Room guest count",
            ].map((m) => (
              <li key={m} className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
                {m}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-400">
            We won&apos;t show a number here until it&apos;s verified against the live API —
            no placeholder figures.
          </p>
        </div>
      </section>

      {/* Notes / comments */}
      <CrystalNotes />

      <p className="mt-8 text-xs text-slate-400">
        Aggregated metrics only · no guest PII · read-only · cached up to 10 min. The
        &ldquo;Today (live snapshot)&rdquo; cards are always today&apos;s figures regardless
        of the selected range.
      </p>
    </main>
  );
}
