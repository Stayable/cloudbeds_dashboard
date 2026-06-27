import Link from "next/link";
import OccupancyView from "@/components/OccupancyView";
import PeriodControls from "@/components/PeriodControls";
import EvictionsSection from "@/components/EvictionsSection";
import ChangePin from "@/components/ChangePin";
import SectionNav, { type NavItem } from "@/components/SectionNav";
import { dayCount, resolveRange } from "@/lib/dates";
import { getPortfolio, getPortfolioInsights } from "@/lib/cloudbeds";
import { getEvictions } from "@/lib/smartsheet";
import { buildOccProperties } from "@/lib/occupancy";

// Ops Dashboard — role-based (not person-named) operational view. Gated to the
// ops level (OPS_PIN) OR exec/CEO. Occupancy + Evictions are live; Lease is a
// placeholder pending the Cloudbeds DI Reservations API access request.
export const dynamic = "force-dynamic";

const NAV: NavItem[] = [
  { id: "occupancy", label: "Occupancy", n: 1 },
  { id: "lease", label: "Lease", n: 2 },
  { id: "evictions", label: "Evictions", n: 3 },
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

export default async function OpsPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; start?: string; end?: string }>;
}) {
  const sp = await searchParams;
  const { preset, start, end } = resolveRange(sp.preset, sp.start, sp.end);

  const [portfolio, insights, evictions] = await Promise.all([
    getPortfolio(),
    getPortfolioInsights(start, end),
    getEvictions(),
  ]);

  const properties = buildOccProperties(portfolio, insights);
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
        <h1 className="mt-1 text-2xl font-semibold sm:text-3xl">Ops Dashboard</h1>
        <p className="mt-1 text-sm text-white/70">
          Operational view — occupancy, lease mix, and evictions across the portfolio.
        </p>
      </header>

      <div className="lg:flex lg:gap-8">
        <SectionNav items={NAV} />

        <div className="min-w-0 flex-1">
          <section id="occupancy" className="mb-10 scroll-mt-20 lg:scroll-mt-6">
            <SectionHeading
              n={1}
              title="Occupancy"
              sub={`${rangeLabel} · ${days} day${days === 1 ? "" : "s"} · Eastern`}
            />
            <div className="mb-4">
              <PeriodControls preset={preset} start={start} end={end} />
            </div>
            <OccupancyView properties={properties} exportDate={end} />
          </section>

          <section id="lease" className="mb-10 scroll-mt-20 lg:scroll-mt-6">
            <SectionHeading n={2} title="Lease" sub="Lease vs. transient mix · per property" />
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-center">
              <p className="text-sm font-semibold text-slate-700">Pending Cloudbeds API access</p>
              <p className="mt-1 text-xs text-slate-500">
                Lease vs. transient mix (from Data Insights Reservations) goes live once the
                API scope request is granted. No data is shown until then.
              </p>
            </div>
          </section>

          <section id="evictions" className="mb-10 scroll-mt-20 lg:scroll-mt-6">
            <SectionHeading n={3} title="Evictions" sub="Live from Smartsheet · counts only · no case detail" />
            <EvictionsSection
              configured={evictions.configured}
              error={evictions.error}
              views={evictions.views}
              asOf={end}
            />
          </section>

          <p className="mb-6 text-xs text-slate-400">
            Aggregated metrics only · no guest PII · read-only · cached up to 10 min. Only
            properties with a configured Cloudbeds key report (Davenport today).
          </p>

          <ChangePin />
        </div>
      </div>
    </main>
  );
}
