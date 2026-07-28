import RevenueReportView from "@/components/RevenueReportView";
import { PageHead, chromeButton } from "@/components/ui";
import { buildRevenueReport } from "@/lib/cloudbeds";

// Occupancy & Revenue Report — gated automatically by middleware at the
// `base` level (requiredLevel("/report") falls through to the default "base"
// case; see lib/auth.ts). Do not add per-page auth logic here.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function ReportPage() {
  const report = await buildRevenueReport();

  return (
    <main className="mx-auto max-w-[1560px] animate-fadeup px-4 pb-16 pt-5 sm:px-6">
      <PageHead
        eyebrow="Stayable · Occupancy & Revenue"
        title="Occupancy & Revenue Report"
        sub={`As of ${report.asOf} · generated ${report.generatedEastern}`}
      >
        <a href="/report/latest.xlsx" className={chromeButton}>
          Excel
        </a>
        <a href="/report/latest.pdf" className={chromeButton}>
          PDF
        </a>
      </PageHead>

      {/* Sourcing caveat — joined to the header so it's read before any figure
          below it. */}
      <div className="rounded-b-[10px] border-x border-b border-warn/40 bg-warnbg px-5 py-3 text-[11.5px] leading-relaxed text-warn">
        <p>{report.sourceNote}</p>
        {report.trackingSince && (
          <p className="mt-1">
            MTD/YTD accumulate from daily snapshots starting {report.trackingSince}.
          </p>
        )}
      </div>

      <div className="mt-4">
        <RevenueReportView report={report} />
      </div>

      <p className="mt-6 text-[11.5px] leading-relaxed text-txt3">
        Aggregated metrics only · no guest PII · read-only. Only configured properties report.
      </p>
    </main>
  );
}
