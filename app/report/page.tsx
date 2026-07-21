import Link from "next/link";
import RevenueReportView from "@/components/RevenueReportView";
import { buildRevenueReport } from "@/lib/cloudbeds";

// Occupancy & Revenue Report — gated automatically by middleware at the
// `base` level (requiredLevel("/report") falls through to the default "base"
// case; see lib/auth.ts). Do not add per-page auth logic here.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function ReportPage() {
  const report = await buildRevenueReport();

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <header className="mb-6 rounded-xl bg-ink px-5 py-4 text-white shadow-sm sm:mb-8 sm:px-6 sm:py-5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-medium uppercase tracking-widest text-white/60">
            Stayable · Occupancy &amp; Revenue
          </p>
          <Link
            href="/"
            className="shrink-0 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/20"
          >
            ← Dashboard
          </Link>
        </div>
        <h1 className="mt-1 text-2xl font-semibold sm:text-3xl">Occupancy &amp; Revenue Report</h1>
        <p className="mt-1 text-sm text-white/70">
          As of {report.asOf} · Generated {report.generatedEastern}
        </p>
      </header>

      <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
        <p>{report.sourceNote}</p>
        {report.trackingSince && (
          <p className="mt-1">
            MTD/YTD accumulate from daily snapshots starting {report.trackingSince}.
          </p>
        )}
      </div>

      <div className="mb-8 flex flex-wrap gap-3">
        <a
          href="/report/latest.xlsx"
          className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
        >
          Download Excel (.xlsx)
        </a>
        <a
          href="/report/latest.pdf"
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
        >
          Download PDF
        </a>
      </div>

      <RevenueReportView report={report} />

      <p className="mt-8 text-xs text-slate-400">
        Aggregated metrics only · no guest PII · read-only. Only configured properties report.
      </p>
    </main>
  );
}
