import Link from "next/link";
import OccupancyView from "@/components/OccupancyView";
import PeriodControls from "@/components/PeriodControls";
import EvictionsSection from "@/components/EvictionsSection";
import BeaOosExplorer, { type BeaProperty } from "@/components/BeaOosExplorer";
import ReviewsSection from "@/components/ReviewsSection";
import LeasingSection from "@/components/LeasingSection";
import EliseInsightsSection from "@/components/EliseInsightsSection";
import ChangePin from "@/components/ChangePin";
import SectionNav, { type NavItem } from "@/components/SectionNav";
import { dayCount, resolveRange, easternToday, shiftYmd } from "@/lib/dates";
import { getPortfolio, getPortfolioInsights, getPortfolioOoo } from "@/lib/cloudbeds";
import { PROPERTIES } from "@/config/properties";
import { getEvictions, getOneStarReviews } from "@/lib/smartsheet";
import { buildOccProperties } from "@/lib/occupancy";
import { buildReviewsView } from "@/lib/reviews";
import { buildLeasingViews } from "@/lib/leasing";
import { buildInsightViews } from "@/lib/elise-insights";
import { getSetting, getEliseFunnel, getElisePipeline, eliseFunnelConfigured, getEliseMetrics } from "@/lib/db";

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
  { id: "leasing-insights", label: "Leasing insights", n: 6 },
  { id: "voice", label: "Voice AI", n: 7 },
  { id: "ai-performance", label: "AI performance", n: 8 },
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
  const asOf = easternToday();

  const [
    portfolio,
    insights,
    ooo,
    evictions,
    reviewsPayload,
    savedWindow,
    eliseFunnel,
    elisePipeline,
    eliseReady,
    eliseMetrics,
  ] = await Promise.all([
    getPortfolio(),
    getPortfolioInsights(start, end),
    getPortfolioOoo(asOf),
    getEvictions(),
    getOneStarReviews(),
    getSetting("ops_reviews_window"),
    getEliseFunnel(start, end),
    getElisePipeline(),
    eliseFunnelConfigured(),
    getEliseMetrics(start, end),
  ]);

  const properties = buildOccProperties(portfolio, insights);
  const leasingViews = buildLeasingViews(eliseFunnel, elisePipeline);
  const insightViews = buildInsightViews(
    eliseMetrics,
    (code) => PROPERTIES.find((p) => p.code === code)?.name ?? code,
  );

  // 1-star reviews: locked date window from Neon (shared); default to the last
  // 30 days (Eastern) until a window is explicitly saved.
  let reviewWindow = { from: shiftYmd(asOf, -29), to: asOf };
  let windowSaved = false;
  if (savedWindow) {
    try {
      const parsed = JSON.parse(savedWindow) as { from?: string; to?: string };
      if (parsed.from && parsed.to) {
        reviewWindow = { from: parsed.from, to: parsed.to };
        windowSaved = true;
      }
    } catch {
      /* fall back to the default window */
    }
  }
  const reviewsView = buildReviewsView(reviewsPayload.reviews, reviewWindow.from, reviewWindow.to);

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
          OOO rooms, leasing, occupancy, evictions, reviews, and EliseAI insights across the portfolio.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-widest text-white/60">Export:</span>
          <a
            href="/ops/occupancy.pdf"
            className="rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/20"
          >
            Occupancy PDF
          </a>
          <a
            href="/ops/ooo.pdf"
            className="rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/20"
          >
            OOO PDF
          </a>
          <a
            href="/ops/leasing.pdf"
            className="rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/20"
          >
            Leasing PDF
          </a>
          <a
            href="/ops/reviews.pdf"
            className="rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/20"
          >
            Reviews PDF
          </a>
        </div>
      </header>

      <div className="lg:flex lg:gap-8">
        <SectionNav items={NAV} />

        <div className="min-w-0 flex-1">
          <section id="oos" className="mb-10 scroll-mt-20 lg:scroll-mt-6">
            <SectionHeading n={1} title="OOO rooms" sub="Live · pick a property → reasons, then rooms" />
            <BeaOosExplorer properties={oosProps} asOf={asOf} />
          </section>

          <section id="leasing" className="mb-10 scroll-mt-20 lg:scroll-mt-6">
            <SectionHeading
              n={2}
              title="Leasing"
              sub={`Funnel + pipeline · EliseAI · ${rangeLabel} · Eastern`}
            />
            <div className="mb-4">
              <PeriodControls preset={preset} start={start} end={end} />
            </div>
            <LeasingSection
              configured={eliseReady}
              views={leasingViews}
              from={start}
              to={end}
              asOf={end}
            />
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
            <SectionHeading
              n={5}
              title="1-Star Reviews"
              sub="Live from Smartsheet · count + per-property detail · lockable date window"
            />
            <ReviewsSection
              configured={reviewsPayload.configured}
              error={reviewsPayload.error}
              view={reviewsView}
              saved={windowSaved}
            />
          </section>

          <section id="leasing-insights" className="mb-10 scroll-mt-20 lg:scroll-mt-6">
            <SectionHeading
              n={6}
              title="Leasing insights"
              sub={`Lead source · channel · AI-booked · cancellations · EliseAI · ${rangeLabel}`}
            />
            <div className="mb-4">
              <PeriodControls preset={preset} start={start} end={end} />
            </div>
            <EliseInsightsSection section="leasing" views={insightViews} from={start} to={end} asOf={end} />
          </section>

          <section id="voice" className="mb-10 scroll-mt-20 lg:scroll-mt-6">
            <SectionHeading
              n={7}
              title="Voice AI"
              sub={`Call volume · who answered · after hours · transfers · ${rangeLabel}`}
            />
            <div className="mb-4">
              <PeriodControls preset={preset} start={start} end={end} />
            </div>
            <EliseInsightsSection section="voice" views={insightViews} from={start} to={end} asOf={end} />
          </section>

          <section id="ai-performance" className="mb-10 scroll-mt-20 lg:scroll-mt-6">
            <SectionHeading
              n={8}
              title="AI performance"
              sub={`AI→human handoffs and task resolution · ${rangeLabel}`}
            />
            <div className="mb-4">
              <PeriodControls preset={preset} start={start} end={end} />
            </div>
            <EliseInsightsSection section="ai" views={insightViews} from={start} to={end} asOf={end} />
          </section>

          <p className="mb-6 text-xs text-slate-400">
            Aggregated metrics only · no guest PII · read-only · cached up to 10 min. Only
            properties with a configured Cloudbeds key report. Elise-sourced sections (2, 6–8) are
            aggregated inside Snowflake and synced nightly — no lead or resident PII reaches this app.
          </p>

          <ChangePin />
        </div>
      </div>
    </main>
  );
}
