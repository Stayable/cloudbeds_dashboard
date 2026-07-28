import OccupancyView from "@/components/OccupancyView";
import PeriodControls from "@/components/PeriodControls";
import ControlBar, { ControlLabel } from "@/components/ControlBar";
import { PageHead, chromeButton } from "@/components/ui";
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

// Section header for each operations block. The step number ties back to the
// numbered rail on the left.
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
    <>
      <ControlBar note={`${rangeLabel} · ${days} day${days === 1 ? "" : "s"} · Eastern`}>
        <ControlLabel>Period</ControlLabel>
        <PeriodControls preset={preset} start={start} end={end} />
      </ControlBar>

      <main className="mx-auto max-w-[1560px] animate-fadeup px-4 pb-16 pt-5 sm:px-6">
        <PageHead
          eyebrow="Stayable · Operations"
          title="Operations Dashboard"
          sub="OOO rooms, leasing, occupancy, evictions, reviews, and EliseAI insights across the portfolio."
        >
          <a href="/ops/occupancy.pdf" className={chromeButton}>
            Occupancy PDF
          </a>
          <a href="/ops/ooo.pdf" className={chromeButton}>
            OOO PDF
          </a>
          <a href="/ops/leasing.pdf" className={chromeButton}>
            Leasing PDF
          </a>
          <a href="/ops/reviews.pdf" className={chromeButton}>
            Reviews PDF
          </a>
        </PageHead>

      <div className="mt-4 lg:flex lg:gap-[18px] lg:items-start">
        <SectionNav items={NAV} title="Operations" />

        <div className="min-w-0 flex-1">
          <section id="oos" className="mb-9 scroll-mt-32 lg:scroll-mt-28">
            <SectionHeading n={1} title="OOO rooms" sub="Live · pick a property → reasons, then rooms" />
            <BeaOosExplorer properties={oosProps} asOf={asOf} />
          </section>

          <section id="leasing" className="mb-9 scroll-mt-32 lg:scroll-mt-28">
            <SectionHeading
              n={2}
              title="Leasing"
              sub={`Funnel + pipeline · EliseAI · ${rangeLabel} · Eastern`}
            />
            <LeasingSection
              configured={eliseReady}
              views={leasingViews}
              from={start}
              to={end}
              asOf={end}
            />
          </section>

          <section id="occupancy" className="mb-9 scroll-mt-32 lg:scroll-mt-28">
            <SectionHeading
              n={3}
              title="Occupancy"
              sub={`${rangeLabel} · ${days} day${days === 1 ? "" : "s"} · Eastern`}
            />
            <OccupancyView properties={properties} exportDate={end} />
          </section>

          <section id="evictions" className="mb-9 scroll-mt-32 lg:scroll-mt-28">
            <SectionHeading n={4} title="Evictions" sub="Live from Smartsheet · counts only · no case detail" />
            <EvictionsSection
              configured={evictions.configured}
              error={evictions.error}
              views={evictions.views}
              asOf={end}
            />
          </section>

          <section id="reviews" className="mb-9 scroll-mt-32 lg:scroll-mt-28">
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

          <section id="leasing-insights" className="mb-9 scroll-mt-32 lg:scroll-mt-28">
            <SectionHeading
              n={6}
              title="Leasing insights"
              sub={`Lead source · channel · AI-booked · cancellations · EliseAI · ${rangeLabel}`}
            />
            <EliseInsightsSection section="leasing" views={insightViews} from={start} to={end} asOf={end} />
          </section>

          <section id="voice" className="mb-9 scroll-mt-32 lg:scroll-mt-28">
            <SectionHeading
              n={7}
              title="Voice AI"
              sub={`Call volume · who answered · after hours · transfers · ${rangeLabel}`}
            />
            <EliseInsightsSection section="voice" views={insightViews} from={start} to={end} asOf={end} />
          </section>

          <section id="ai-performance" className="mb-9 scroll-mt-32 lg:scroll-mt-28">
            <SectionHeading
              n={8}
              title="AI performance"
              sub={`AI→human handoffs and task resolution · ${rangeLabel}`}
            />
            <EliseInsightsSection section="ai" views={insightViews} from={start} to={end} asOf={end} />
          </section>

          <p className="mb-6 text-xs text-txt3">
            Aggregated metrics only · no guest PII · read-only · cached up to 10 min. Only
            properties with a configured Cloudbeds key report. Elise-sourced sections (2, 6–8) are
            aggregated inside Snowflake and synced nightly — no lead or resident PII reaches this app.
          </p>

          <ChangePin />
        </div>
      </div>
      </main>
    </>
  );
}
