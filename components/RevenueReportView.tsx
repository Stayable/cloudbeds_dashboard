import { Fragment } from "react";
import { isCountDependentRow } from "@/lib/revenue-report";
import type {
  RevenueReport,
  PropertyActual,
  PropertyOnTheBooks,
  PeriodBlock,
  DerivedRow,
} from "@/lib/revenue-report";

// Presentational — no fetching, no interactivity. Mirrors the metric mapping
// in lib/report-xlsx.ts row-for-row so the /report page and the downloaded
// .xlsx always agree (task-6-brief.md).

type MetricKind = "count" | "currency" | "pct";
type MetricRow = {
  label: string;
  indent?: boolean;
  kind: MetricKind;
  key: keyof DerivedRow;
  get: (row: DerivedRow) => number | null;
  /** The KE-only "% Occupied Adjusted (less 20 rms)" row — rendered only when
   *  at least one period in the block actually carries occAdjLess20. */
  keOnly?: boolean;
};

const METRIC_ROWS: MetricRow[] = [
  { label: "Occupied", kind: "count", key: "occupied", get: (r) => r.occupied },
  { label: "Transient", indent: true, kind: "count", key: "transientNights", get: (r) => r.transientNights },
  { label: "Lease", indent: true, kind: "count", key: "leaseNights", get: (r) => r.leaseNights },
  { label: "Other blocks", kind: "count", key: "otherBlocks", get: (r) => r.otherBlocks },
  { label: "Out-of-Order", kind: "count", key: "ooo", get: (r) => r.ooo },
  { label: "Available", kind: "count", key: "available", get: (r) => r.available },
  { label: "Inventory", kind: "count", key: "inventory", get: (r) => r.inventory },
  { label: "% Occupied", kind: "pct", key: "pOcc", get: (r) => r.pOcc },
  { label: "% Out-of-Order", kind: "pct", key: "pOoo", get: (r) => r.pOoo },
  { label: "% Available", kind: "pct", key: "pAvail", get: (r) => r.pAvail },
  {
    label: "% Occupied Adjusted (less 20 rms)",
    kind: "pct",
    key: "occAdjLess20",
    get: (r) => r.occAdjLess20,
    keOnly: true,
  },
  { label: "Room Revenue", kind: "currency", key: "roomRev", get: (r) => r.roomRev },
  { label: "Transient", indent: true, kind: "currency", key: "transientRev", get: (r) => r.transientRev },
  { label: "Lease", indent: true, kind: "currency", key: "leaseRev", get: (r) => r.leaseRev },
  { label: "ADR Combined", kind: "currency", key: "adrCombined", get: (r) => r.adrCombined },
  { label: "ADR Transient", indent: true, kind: "currency", key: "adrTransient", get: (r) => r.adrTransient },
  { label: "ADR Lease", indent: true, kind: "currency", key: "adrLease", get: (r) => r.adrLease },
  { label: "RevPar", kind: "currency", key: "revpar", get: (r) => r.revpar },
];

const AVAILABILITY_LABEL = "% Available";

function fmtCount(n: number): string {
  return n.toLocaleString();
}
function fmtCurrency(n: number): string {
  const abs = Math.abs(n);
  const s = `$${abs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return n < 0 ? `(${s})` : s;
}
function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}
function fmtMetric(kind: MetricKind, n: number | null): string {
  if (n == null) return "";
  if (kind === "count") return fmtCount(n);
  if (kind === "currency") return fmtCurrency(n);
  return fmtPct(n);
}
/** "—" placeholder for a count-dependent cell blanked by a partial block
 *  (Kyle's decision, partial-counts-brief.md) — distinct from an ordinary
 *  blank (missing LY history, or a non-KE property's adjusted-occ row),
 *  which stays a plain empty cell via fmtMetric(null). */
const BLANKED = "—";

/** Availability highlighting (mirrors the xlsx conditional formatting):
 *  red bg <=15%, orange bg <=20%, purple bold text >=40%. */
function availClass(n: number | null): string {
  if (n == null) return "";
  if (n <= 0.15) return "bg-red-200 text-red-900";
  if (n <= 0.2) return "bg-orange-200 text-orange-900";
  if (n >= 0.4) return "font-semibold text-purple-700";
  return "";
}

function rowsFor(anyAdjusted: boolean): MetricRow[] {
  return METRIC_ROWS.filter((m) => !m.keOnly || anyAdjusted);
}

function metricLabelCell(metric: MetricRow) {
  return (
    <td
      className={
        "whitespace-nowrap px-3 py-1.5 " +
        (metric.indent ? "pl-7 italic text-slate-500" : "font-medium text-slate-700")
      }
    >
      {metric.label}
    </td>
  );
}

function ActualTable({ property }: { property: PropertyActual }) {
  const groups: Array<{ label: string; block: PeriodBlock }> = [
    { label: "Yesterday", block: property.yesterday },
    { label: "Month-to-date", block: property.mtd },
    { label: "Year-to-date", block: property.ytd },
  ];
  const anyAdjusted = groups.some((g) => g.block.actual.occAdjLess20 != null);
  const rows = rowsFor(anyAdjusted);

  return (
    <div className="mb-8 overflow-x-auto rounded-xl border border-slate-200 shadow-sm">
      <table className="w-full min-w-[920px] border-collapse text-sm">
        <thead>
          <tr>
            <th className="bg-ink px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-white">
              {property.name}
            </th>
            {groups.map((g) => (
              <th
                key={g.label}
                colSpan={3}
                className="border-l border-white/10 bg-slate-800 px-3 py-2 text-center text-xs font-semibold uppercase tracking-wide text-white"
              >
                {g.label}
              </th>
            ))}
          </tr>
          <tr className="bg-slate-100 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
            <th className="px-3 py-1.5 text-left">History</th>
            {groups.map((g) =>
              ["Actual", "Last Year", "Variance"].map((l) => (
                <th key={`${g.label}-${l}`} className="px-3 py-1.5 text-right">
                  {l}
                </th>
              )),
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((metric) => {
            const isAvail = metric.label === AVAILABILITY_LABEL;
            return (
              <tr key={metric.label} className="border-t border-slate-100">
                {metricLabelCell(metric)}
                {groups.map((g) => {
                  const blanked = g.block.countsPartial === true && isCountDependentRow(metric.key);
                  const actualVal = blanked ? null : metric.get(g.block.actual);
                  const lyVal = g.block.lastYear ? metric.get(g.block.lastYear) : null;
                  const varVal = actualVal == null || lyVal == null ? null : actualVal - lyVal;
                  return (
                    <Fragment key={g.label}>
                      <td
                        className={
                          "whitespace-nowrap px-3 py-1.5 text-right tabular-nums " +
                          (isAvail ? availClass(actualVal) : "")
                        }
                      >
                        {blanked ? BLANKED : fmtMetric(metric.kind, actualVal)}
                      </td>
                      <td
                        className={
                          "whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-slate-500 " +
                          (isAvail ? availClass(lyVal) : "")
                        }
                      >
                        {fmtMetric(metric.kind, lyVal)}
                      </td>
                      <td
                        className={
                          "whitespace-nowrap px-3 py-1.5 text-right tabular-nums " +
                          (isAvail ? availClass(varVal) : "")
                        }
                      >
                        {blanked ? BLANKED : fmtMetric(metric.kind, varVal)}
                      </td>
                    </Fragment>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function OnTheBooksTable({ property }: { property: PropertyOnTheBooks }) {
  const anyAdjusted = property.days.some((d) => d.row.occAdjLess20 != null);
  const rows = rowsFor(anyAdjusted);

  return (
    <div className="mb-8 overflow-x-auto rounded-xl border border-slate-200 shadow-sm">
      <table className="w-full min-w-[760px] border-collapse text-sm">
        <thead>
          <tr>
            <th className="bg-ink px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-white">
              {property.name}
            </th>
            {property.days.map((d) => (
              <th
                key={d.date}
                className="border-l border-white/10 bg-slate-800 px-3 py-2 text-center text-xs font-semibold uppercase tracking-wide text-white"
              >
                {d.date}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((metric) => {
            const isAvail = metric.label === AVAILABILITY_LABEL;
            return (
              <tr key={metric.label} className="border-t border-slate-100">
                {metricLabelCell(metric)}
                {property.days.map((d) => {
                  const val = metric.get(d.row);
                  return (
                    <td
                      key={d.date}
                      className={
                        "whitespace-nowrap px-3 py-1.5 text-right tabular-nums " +
                        (isAvail ? availClass(val) : "")
                      }
                    >
                      {fmtMetric(metric.kind, val)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function RevenueReportView({ report }: { report: RevenueReport }) {
  return (
    <div className="space-y-10">
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-500">
          Actual — Yesterday / Month-to-date / Year-to-date
        </h2>
        {report.actual.length === 0 ? (
          <p className="rounded-lg bg-slate-50 px-4 py-8 text-center text-sm text-slate-400">
            No configured properties reported.
          </p>
        ) : (
          report.actual.map((p) => <ActualTable key={p.code} property={p} />)
        )}
      </section>

      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-500">
          On-the-Books — next 7 days
        </h2>
        {report.onTheBooks.length === 0 ? (
          <p className="rounded-lg bg-slate-50 px-4 py-8 text-center text-sm text-slate-400">
            No configured properties reported.
          </p>
        ) : (
          report.onTheBooks.map((p) => <OnTheBooksTable key={p.code} property={p} />)
        )}
      </section>

      <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
        <p className="mb-1 font-semibold text-slate-600">Availability legend</p>
        <p>
          <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-red-200 align-middle" /> % Available ≤ 15% ·{" "}
          <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-orange-200 align-middle" /> ≤ 20% ·{" "}
          <span className="font-semibold text-purple-700">% Available ≥ 40%</span>
        </p>
      </div>
    </div>
  );
}
