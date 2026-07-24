"use client";

import { Fragment, useState } from "react";
import { isCountDependentRow } from "@/lib/revenue-report";
import type {
  RevenueReport,
  PropertyActual,
  PropertyOnTheBooks,
  PeriodBlock,
  DerivedRow,
} from "@/lib/revenue-report";

// Interactive report explorer. All property/period data is fetched server-side
// and passed in as `report`; this component only decides what to SHOW:
//   • a left property nav rail (All Properties + each property),
//   • "All Properties" → a compact, clickable leaderboard (no giant tables),
//   • a single property → KPI tiles + an Actual / On-the-Books toggle that
//     reveals the full detailed table for that one property.
// The detailed tables (ActualTable / OnTheBooksTable) mirror the .xlsx export
// row-for-row (lib/report-xlsx.ts), so the page and the download still agree.

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
/** Compact currency for KPI tiles / leaderboard: $1.03M, $694k, $412. */
function fmtCompactCurrency(n: number | null): string {
  if (n == null) return "—";
  const abs = Math.abs(n);
  let s: string;
  if (abs >= 1_000_000) s = `$${(abs / 1_000_000).toFixed(2)}M`;
  else if (abs >= 1_000) s = `$${(abs / 1_000).toFixed(0)}k`;
  else s = `$${abs.toFixed(0)}`;
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
/** "—" placeholder for a count-dependent cell blanked by a partial block. */
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
    <div className="overflow-x-auto rounded-xl border border-slate-200 shadow-sm">
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
    <div className="overflow-x-auto rounded-xl border border-slate-200 shadow-sm">
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

// --- New navigation-driven shell --------------------------------------------

/** Occupancy status color for the rail dot / bar (from yesterday % occupied). */
function occDot(pOcc: number | null): string {
  if (pOcc == null) return "bg-slate-300";
  if (pOcc >= 0.85) return "bg-emerald-500";
  if (pOcc >= 0.6) return "bg-amber-500";
  return "bg-red-500";
}

type RailItem = { code: string; name: string; occ: number | null };

function Rail({
  items,
  selected,
  onSelect,
}: {
  items: RailItem[];
  selected: string;
  onSelect: (code: string) => void;
}) {
  const base =
    "flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors whitespace-nowrap";
  const on = "bg-ink text-white";
  const off = "text-slate-600 hover:bg-slate-100";
  return (
    <nav
      aria-label="Property navigation"
      className="mb-4 flex gap-1.5 overflow-x-auto pb-2 lg:mb-0 lg:w-56 lg:shrink-0 lg:flex-col lg:overflow-visible lg:pb-0"
    >
      <button
        type="button"
        onClick={() => onSelect("all")}
        className={`${base} font-semibold ${selected === "all" ? on : off}`}
      >
        All Properties
      </button>
      {items.map((p) => (
        <button
          key={p.code}
          type="button"
          onClick={() => onSelect(p.code)}
          className={`${base} lg:justify-between ${selected === p.code ? on : off}`}
        >
          <span className="flex items-center gap-2">
            <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${occDot(p.occ)}`} />
            {p.name}
          </span>
          <span className={selected === p.code ? "text-white/70" : "text-slate-400"}>
            {p.occ == null ? "—" : fmtPct(p.occ)}
          </span>
        </button>
      ))}
    </nav>
  );
}

function Leaderboard({
  items,
  onSelect,
}: {
  items: (RailItem & { roomRevYtd: number | null; adr: number | null; revpar: number | null })[];
  onSelect: (code: string) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 shadow-sm">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="bg-ink text-xs font-semibold uppercase tracking-wide text-white">
            <th className="px-4 py-2.5 text-left">Property</th>
            <th className="px-4 py-2.5 text-right">% Occ (yest)</th>
            <th className="px-4 py-2.5 text-right">Room Rev (YTD)</th>
            <th className="px-4 py-2.5 text-right">ADR (yest)</th>
            <th className="px-4 py-2.5 text-right">RevPAR (yest)</th>
          </tr>
        </thead>
        <tbody>
          {items.map((p) => (
            <tr
              key={p.code}
              onClick={() => onSelect(p.code)}
              className="cursor-pointer border-t border-slate-100 transition-colors hover:bg-slate-50"
            >
              <td className="px-4 py-2.5">
                <span className="flex items-center gap-2 font-medium text-slate-800">
                  <span className={`inline-block h-2 w-2 rounded-full ${occDot(p.occ)}`} />
                  {p.name}
                </span>
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                {p.occ == null ? "—" : fmtPct(p.occ)}
              </td>
              <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-slate-900">
                {fmtCompactCurrency(p.roomRevYtd)}
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                {fmtCompactCurrency(p.adr)}
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                {fmtCompactCurrency(p.revpar)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function KpiTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <p className="text-[11px] font-medium uppercase tracking-widest text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}
    </div>
  );
}

/** Portfolio roll-up for the "All Properties" overview. Occupancy / ADR / RevPAR
 *  / OOO come from YESTERDAY (a real, complete day — not the partial MTD/YTD
 *  count accumulation); Room Revenue is the exact YTD total. */
function portfolioSummary(props: PropertyActual[]) {
  let occ = 0,
    inv = 0,
    revYest = 0,
    ooo = 0,
    revYtd = 0,
    reporting = 0;
  for (const p of props) {
    const y = p.yesterday.actual;
    if (y.pOcc != null) reporting += 1;
    if (y.occupied != null) occ += y.occupied;
    if (y.inventory != null) inv += y.inventory;
    if (y.roomRev != null) revYest += y.roomRev;
    if (y.ooo != null) ooo += y.ooo;
    if (p.ytd.actual.roomRev != null) revYtd += p.ytd.actual.roomRev;
  }
  return {
    pOcc: inv > 0 ? occ / inv : null,
    adr: occ > 0 ? revYest / occ : null,
    revpar: inv > 0 ? revYest / inv : null,
    ooo,
    revYtd,
    reporting,
    total: props.length,
  };
}

function PortfolioSummary({ props }: { props: PropertyActual[] }) {
  const s = portfolioSummary(props);
  return (
    <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <div className="rounded-xl bg-ink px-4 py-3 text-white shadow-sm">
        <p className="text-[11px] font-medium uppercase tracking-widest text-white/60">Portfolio Occ</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{s.pOcc == null ? "—" : fmtPct(s.pOcc)}</p>
        <p className="mt-0.5 text-xs text-white/50">
          {s.reporting} of {s.total} · yesterday
        </p>
      </div>
      <KpiTile label="Room Rev" value={fmtCompactCurrency(s.revYtd)} sub="year-to-date" />
      <KpiTile label="ADR" value={fmtCompactCurrency(s.adr)} sub="yesterday" />
      <KpiTile label="RevPAR" value={fmtCompactCurrency(s.revpar)} sub="yesterday" />
      <KpiTile label="Rooms OOO" value={s.ooo.toLocaleString()} sub="yesterday" />
    </div>
  );
}

function PropertyDetail({
  actual,
  onTheBooks,
  view,
  onView,
}: {
  actual: PropertyActual;
  onTheBooks: PropertyOnTheBooks | undefined;
  view: "actual" | "onTheBooks";
  onView: (v: "actual" | "onTheBooks") => void;
}) {
  const y = actual.yesterday.actual;
  const ytd = actual.ytd.actual;
  const seg = "rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors";
  const segOn = "bg-ink text-white";
  const segOff = "text-slate-600 hover:bg-slate-100";

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiTile label="% Occupied" value={y.pOcc == null ? "—" : fmtPct(y.pOcc)} sub="yesterday" />
        <KpiTile label="Room Revenue" value={fmtCompactCurrency(ytd.roomRev)} sub="year-to-date" />
        <KpiTile label="ADR" value={fmtCompactCurrency(y.adrCombined)} sub="yesterday" />
        <KpiTile label="RevPAR" value={fmtCompactCurrency(y.revpar)} sub="yesterday" />
      </div>

      <div className="inline-flex gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
        <button type="button" onClick={() => onView("actual")} className={`${seg} ${view === "actual" ? segOn : segOff}`}>
          Actual
        </button>
        <button
          type="button"
          onClick={() => onView("onTheBooks")}
          className={`${seg} ${view === "onTheBooks" ? segOn : segOff}`}
        >
          On-the-Books
        </button>
      </div>

      {view === "actual" ? (
        <ActualTable property={actual} />
      ) : onTheBooks ? (
        <OnTheBooksTable property={onTheBooks} />
      ) : (
        <p className="rounded-lg bg-slate-50 px-4 py-8 text-center text-sm text-slate-400">
          No on-the-books data for this property.
        </p>
      )}
    </div>
  );
}

function Legend() {
  return (
    <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
      <p className="mb-1 font-semibold text-slate-600">Availability legend</p>
      <p>
        <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-red-200 align-middle" /> % Available ≤ 15% ·{" "}
        <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-orange-200 align-middle" /> ≤ 20% ·{" "}
        <span className="font-semibold text-purple-700">% Available ≥ 40%</span>
      </p>
    </div>
  );
}

export default function RevenueReportView({ report }: { report: RevenueReport }) {
  const [selected, setSelected] = useState<string>("all");
  const [view, setView] = useState<"actual" | "onTheBooks">("actual");

  const railItems: RailItem[] = report.actual.map((p) => ({
    code: p.code,
    name: p.name,
    occ: p.yesterday.actual.pOcc,
  }));

  const leaderboardItems = report.actual.map((p) => ({
    code: p.code,
    name: p.name,
    occ: p.yesterday.actual.pOcc,
    roomRevYtd: p.ytd.actual.roomRev,
    adr: p.yesterday.actual.adrCombined,
    revpar: p.yesterday.actual.revpar,
  }));

  const current = report.actual.find((p) => p.code === selected);
  const currentOtb = report.onTheBooks.find((p) => p.code === selected);

  if (report.actual.length === 0) {
    return (
      <p className="rounded-lg bg-slate-50 px-4 py-8 text-center text-sm text-slate-400">
        No configured properties reported.
      </p>
    );
  }

  return (
    <div className="lg:flex lg:gap-6">
      <Rail items={railItems} selected={selected} onSelect={setSelected} />
      <div className="min-w-0 flex-1">
        {selected === "all" || !current ? (
          <>
            <PortfolioSummary props={report.actual} />
            <p className="mb-3 text-xs text-slate-500">
              Click a property for its full Actual / On-the-Books detail. Occupancy, ADR and RevPAR
              shown are yesterday&apos;s; Room Revenue is year-to-date (exact).
            </p>
            <Leaderboard items={leaderboardItems} onSelect={setSelected} />
          </>
        ) : (
          <PropertyDetail actual={current} onTheBooks={currentOtb} view={view} onView={setView} />
        )}
        <Legend />
      </div>
    </div>
  );
}
