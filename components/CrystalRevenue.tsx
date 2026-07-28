// Presentational revenue & rate section for /crystal. Server component (no
// client state). ADR/RevPAR are real; revenue is a labeled estimate.
import type { RevenueSummary, RevenueRow } from "@/lib/revenue";
import ExportMenu from "@/components/ExportMenu";
import { buildMatrix, exportFilename, type ExportColumn } from "@/lib/export";

const REVENUE_COLS: ExportColumn<RevenueRow>[] = [
  { header: "Property", value: (r) => r.name },
  { header: "County", value: (r) => r.county },
  { header: "ADR", value: (r) => (r.adr == null ? "" : r.adr.toFixed(2)) },
  { header: "RevPAR", value: (r) => (r.revpar == null ? "" : r.revpar.toFixed(2)) },
  { header: "Room revenue (est.)", value: (r) => (r.roomRevenueEst == null ? "" : Math.round(r.roomRevenueEst)) },
];

function money(n: number | null) {
  return n === null
    ? "—"
    : `$${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}
function money2(n: number | null) {
  return n === null
    ? "—"
    : `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function CrystalRevenue({
  summary,
  exportDate,
}: {
  summary: RevenueSummary;
  exportDate: string; // YYYY-MM-DD, for export filenames
}) {
  const ranked = [...summary.rows].sort((a, b) => (b.revpar ?? -1) - (a.revpar ?? -1));
  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <ExportMenu
          filename={exportFilename("RevenueRate", null, exportDate)}
          title="Revenue & rate — All properties"
          matrix={buildMatrix(REVENUE_COLS, ranked)}
        />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
        <div className="rounded-[10px] border border-line bg-surface p-4 shadow-card">
          <p className="text-[10.5px] font-semibold uppercase tracking-[.08em] text-txt3">ADR (portfolio)</p>
          <p className="mt-2 text-2xl font-semibold text-txt sm:text-3xl">{money2(summary.portfolioAdr)}</p>
        </div>
        <div className="rounded-[10px] border border-line bg-surface p-4 shadow-card">
          <p className="text-[10.5px] font-semibold uppercase tracking-[.08em] text-txt3">RevPAR (portfolio)</p>
          <p className="mt-2 text-2xl font-semibold text-txt sm:text-3xl">{money2(summary.portfolioRevpar)}</p>
        </div>
        <div className="col-span-2 rounded-[10px] border border-line bg-surface p-4 shadow-card sm:col-span-1">
          <p className="text-[10.5px] font-semibold uppercase tracking-[.08em] text-txt3">
            Total room revenue <span className="text-warn">· est.</span>
          </p>
          <p className="mt-2 text-2xl font-semibold text-txt sm:text-3xl">{money(summary.totalRoomRevenueEst)}</p>
          <p className="mt-1 text-[11px] text-txt3">RevPAR × capacity × {summary.days}d</p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-[10px] border border-line bg-surface shadow-card">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="bg-chrome text-left text-[10px] font-semibold uppercase tracking-[.07em] text-white/70">
              <th className="px-4 py-3 font-semibold">Property</th>
              <th className="px-4 py-3 font-semibold">ADR</th>
              <th className="px-4 py-3 font-semibold">RevPAR</th>
              <th className="px-4 py-3 font-semibold">Room revenue (est.)</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((r) => (
              <tr key={r.code} className="border-t border-line">
                <td className="px-4 py-3 font-medium text-txt">
                  {r.name} <span className="text-xs text-txt3">· {r.county}</span>
                </td>
                <td className="px-4 py-3 text-txt">{money2(r.adr)}</td>
                <td className="px-4 py-3 text-txt">{money2(r.revpar)}</td>
                <td className="px-4 py-3 text-txt">{money(r.roomRevenueEst)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-txt3">
        ADR and RevPAR are live from Cloudbeds Data Insights. Revenue is an estimate
        (RevPAR × available room-nights) — Cloudbeds&apos; aggregate API does not expose
        summable revenue totals. Room rate ≈ ADR.
      </p>
    </div>
  );
}
