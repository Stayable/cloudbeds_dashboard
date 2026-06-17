import PortfolioView from "@/components/PortfolioView";
import { getPortfolio } from "@/lib/cloudbeds";

// Render per-request so runtime env vars (CLOUDBEDS_API_KEY_*) are always read
// live — upstream Cloudbeds calls are still cached 10 min (Next data cache).
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const portfolio = await getPortfolio();
  const configuredCount = portfolio.filter((p) => p.configured).length;
  const reportingCount = portfolio.filter((p) => p.result?.ok).length;

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <header className="mb-6 rounded-xl bg-ink px-5 py-4 text-white shadow-sm sm:mb-8 sm:px-6 sm:py-5">
        <p className="text-xs font-medium uppercase tracking-widest text-white/60">
          Stayable · Portfolio Operating Dashboard
        </p>
        <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h1 className="text-2xl font-semibold sm:text-3xl">All Properties</h1>
          <span className="text-sm text-white/70">
            {reportingCount} of {configuredCount} reporting · {portfolio.length} total
          </span>
        </div>
      </header>

      <PortfolioView portfolio={portfolio} />

      <p className="mt-6 text-xs text-slate-400">
        Aggregated metrics only · no guest PII · read-only · cached up to 10 min.
        Showing today&apos;s snapshot · daily/weekly/monthly + ADR/RevPAR/revenue
        (Data Insights) coming next.
      </p>
    </main>
  );
}
