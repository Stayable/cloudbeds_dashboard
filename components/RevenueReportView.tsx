"use client";

import { Fragment, useState } from "react";
import { isCountDependentRow, METHODOLOGY } from "@/lib/revenue-report";
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
  items: (RailItem & {
    roomRevYtd: number | null;
    adr: number | null;
    revpar: number | null;
    spark: { day: string; pOcc: number }[];
  })[];
  onSelect: (code: string) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 shadow-sm">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="bg-ink text-xs font-semibold uppercase tracking-wide text-white">
            <th className="px-4 py-2.5 text-left">Property</th>
            <th className="px-4 py-2.5 text-right">% Occ (yest)</th>
            <th className="px-4 py-2.5 text-center">Occ trend (30d)</th>
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
              <td className="px-4 py-2.5 text-center">
                <Sparkline points={p.spark} />
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
      {(actual.spark?.length ?? 0) >= 2 && (
        <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-widest text-slate-500">Occupancy trend</p>
            <p className="text-xs text-slate-400">
              last {actual.spark!.length} captured days · {fmtPct(actual.spark![0].pOcc)} →{" "}
              {fmtPct(actual.spark!.at(-1)!.pOcc)}
            </p>
          </div>
          <div className="ml-auto">
            <Sparkline points={actual.spark!} width={220} height={40} />
          </div>
        </div>
      )}

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

/** Inline SVG sparkline of trailing daily occupancy. Deliberately unlabelled —
 *  it conveys shape, not values; the tables carry the numbers. Renders nothing
 *  below 2 points so a single banked day doesn't imply a trend. */
function Sparkline({
  points,
  width = 110,
  height = 26,
}: {
  points: { day: string; pOcc: number }[];
  width?: number;
  height?: number;
}) {
  if (points.length < 2) return <span className="text-xs text-slate-300">—</span>;
  const vals = points.map((p) => p.pOcc);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const span = hi - lo || 1;
  const pad = 2;
  const dx = (width - pad * 2) / (points.length - 1);
  const y = (v: number) => pad + (height - pad * 2) * (1 - (v - lo) / span);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${(pad + i * dx).toFixed(1)},${y(p.pOcc).toFixed(1)}`).join(" ");
  const last = points.at(-1)!;
  const first = points[0]!;
  const rising = last.pOcc >= first.pOcc;
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="overflow-visible align-middle"
      role="img"
      aria-label={`Occupancy trend over the last ${points.length} captured days, ${fmtPct(first.pOcc)} to ${fmtPct(last.pOcc)}`}
    >
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"
        className={rising ? "text-emerald-500" : "text-red-400"} />
      <circle cx={(pad + (points.length - 1) * dx).toFixed(1)} cy={y(last.pOcc).toFixed(1)} r="1.8"
        className={rising ? "fill-emerald-600" : "fill-red-500"} />
    </svg>
  );
}

/** Is the store's latest capture the day this report is for? If not, say so
 *  loudly — a stale cron otherwise reads as a genuinely quiet day. */
function FreshnessStamp({ report }: { report: RevenueReport }) {
  const f = report.freshness;
  if (!f || !f.latestCapturedDate) return null;
  const current = f.latestCapturedDate >= report.asOf;
  const banked = f.lastBankedAt ? f.lastBankedAt.slice(0, 16).replace("T", " ") + " UTC" : "unknown";
  return (
    <div
      className={
        "mb-5 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-4 py-2.5 text-xs " +
        (current
          ? "border-slate-200 bg-slate-50 text-slate-600"
          : "border-amber-300 bg-amber-50 text-amber-900")
      }
    >
      <span className="flex items-center gap-1.5 font-semibold">
        <span className={"inline-block h-2 w-2 rounded-full " + (current ? "bg-emerald-500" : "bg-amber-500")} />
        {current ? "Data current" : "Data may be stale"}
      </span>
      <span>
        Last captured day <span className="font-medium">{f.latestCapturedDate}</span> ({f.propertiesOnLatest} of{" "}
        {f.propertiesExpected} properties)
      </span>
      <span className="text-slate-400">·</span>
      <span>Snapshot last written {banked}</span>
      {!current && (
        <span className="font-medium">
          — this report is for {report.asOf}; the daily capture has not landed yet.
        </span>
      )}
    </div>
  );
}

/** Monica-confirmed methodology, collapsed by default. Same wording as the
 *  Excel/PDF exports and the Teams card (lib/revenue-report METHODOLOGY). */
function MethodologyFooter() {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-6 rounded-lg border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span>
          <span className="text-sm font-semibold text-slate-800">Methodology &amp; sources</span>
          <span className="ml-2 text-xs text-slate-500">
            Confirmed by Monica Oco (Revenue Management) · 2026-07-24, rate plans re-confirmed 07/27
          </span>
        </span>
        <span className="shrink-0 text-xs font-semibold text-slate-500">{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <div className="grid gap-4 border-t border-slate-100 px-4 py-4 text-xs text-slate-600 sm:grid-cols-2">
          {METHODOLOGY.map((sec) => (
            <div key={sec.heading}>
              <p className="mb-1 font-semibold text-slate-700">{sec.heading}</p>
              <ul className="list-disc space-y-1 pl-4">
                {sec.points.map((pt) => (
                  <li key={pt}>{pt}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
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

// --- Year-over-year revenue (Rob's ask: MTD revenue vs last year) -----------
// Last-year figures come from the 2025 revenue backfill (report_daily_snapshot
// LY range). JN is EXCLUDED (not operated Apr'25–Mar'26 — not year-comparable;
// may revisit). DP is INCLUDED but flagged (opened Jun'25). Portfolio totals sum
// only properties that have a last-year figure, so the % is apples-to-apples.
const YOY_EXCLUDE = new Set<string>(["JN"]);
const YOY_FLAG: Record<string, string> = { DP: "opened Jun ’25" };

function deltaPct(ty: number | null, ly: number | null): number | null {
  if (ty == null || ly == null || ly === 0) return null;
  return (ty - ly) / ly;
}
function DeltaBadge({ ty, ly }: { ty: number | null; ly: number | null }) {
  const p = deltaPct(ty, ly);
  if (p == null) return <span className="text-xs text-slate-400">—</span>;
  const up = p >= 0;
  return (
    <span className={"text-xs font-semibold " + (up ? "text-emerald-600" : "text-red-600")}>
      {up ? "▲" : "▼"} {(Math.abs(p) * 100).toFixed(1)}%
    </span>
  );
}

function YoyCard({ label, ty, ly, highlight }: { label: string; ty: number; ly: number; highlight?: boolean }) {
  return (
    <div
      className={
        "rounded-xl border bg-white px-4 py-3 shadow-sm transition-colors " +
        (highlight ? "border-accent ring-1 ring-accent/30" : "border-slate-200")
      }
    >
      <div className="flex items-baseline justify-between">
        <p className="text-[11px] font-medium uppercase tracking-widest text-slate-500">{label}</p>
        <DeltaBadge ty={ty} ly={ly} />
      </div>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{fmtCompactCurrency(ty)}</p>
      <p className="mt-0.5 text-xs text-slate-400">
        last year {fmtCompactCurrency(ly)}
      </p>
    </div>
  );
}

type YoyPeriod = "mtd" | "ytd";
type YoyItem = {
  code: string;
  name: string;
  mtdTY: number | null;
  mtdLY: number | null;
  ytdTY: number | null;
  ytdLY: number | null;
  flag: string | null;
};

function YoyChart({ items, period }: { items: YoyItem[]; period: YoyPeriod }) {
  const ty = (x: YoyItem) => (period === "mtd" ? x.mtdTY : x.ytdTY);
  const ly = (x: YoyItem) => (period === "mtd" ? x.mtdLY : x.ytdLY);
  const max = Math.max(1, ...items.flatMap((x) => [ty(x) ?? 0, ly(x) ?? 0]));
  const H = 130;
  return (
    <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="mb-3 text-xs text-slate-500">
        {period === "mtd" ? "Month-to-date" : "Year-to-date"} room revenue — this year vs last year
      </p>
      <div className="flex items-end gap-5" style={{ minHeight: H + 40 }}>
        {items.map((x) => (
          <div key={x.code} className="flex shrink-0 flex-col items-center gap-1">
            <DeltaBadge ty={ty(x)} ly={ly(x)} />
            <div className="flex items-end gap-1" style={{ height: H }}>
              <div
                title={`This year ${fmtCompactCurrency(ty(x))}`}
                className="w-5 rounded-t bg-ink"
                style={{ height: `${((ty(x) ?? 0) / max) * H}px` }}
              />
              <div
                title={`Last year ${fmtCompactCurrency(ly(x))}`}
                className="w-5 rounded-t bg-skyLight"
                style={{ height: `${((ly(x) ?? 0) / max) * H}px` }}
              />
            </div>
            <span className="text-[10px] font-medium text-slate-600">{x.code}</span>
            {x.flag && <span className="text-[9px] text-slate-400">{x.flag}</span>}
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-4 text-xs text-slate-500">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-ink" /> This year
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-skyLight" /> Last year
        </span>
      </div>
    </div>
  );
}

function YoyRevenue({ props }: { props: PropertyActual[] }) {
  const [show, setShow] = useState(true);
  const [period, setPeriod] = useState<YoyPeriod>("mtd");
  const items: YoyItem[] = props
    .filter((p) => !YOY_EXCLUDE.has(p.code))
    .map((p) => ({
      code: p.code,
      name: p.name,
      mtdTY: p.mtd.actual.roomRev,
      mtdLY: p.mtd.lastYear?.roomRev ?? null,
      ytdTY: p.ytd.actual.roomRev,
      ytdLY: p.ytd.lastYear?.roomRev ?? null,
      flag: YOY_FLAG[p.code] ?? null,
    }));

  // Portfolio totals: sum only properties that HAVE a last-year figure.
  const roll = (tyKey: "mtd" | "ytd") => {
    let ty = 0,
      ly = 0;
    for (const p of props) {
      if (YOY_EXCLUDE.has(p.code)) continue;
      const block = p[tyKey];
      const lyVal = block.lastYear?.roomRev ?? null;
      if (lyVal == null) continue;
      ty += block.actual.roomRev ?? 0;
      ly += lyVal;
    }
    return { ty, ly };
  };
  const mtd = roll("mtd");
  const ytd = roll("ytd");
  const hasLY = mtd.ly > 0 || ytd.ly > 0;

  if (!hasLY) return null; // no last-year data banked yet

  return (
    <div className="mb-6">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">Revenue vs. Last Year</h3>
        <div className="flex items-center gap-2">
          <div className="inline-flex gap-1 rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm">
            {(["mtd", "ytd"] as YoyPeriod[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setPeriod(k)}
                className={
                  "rounded-md px-2.5 py-1 text-xs font-semibold transition-colors " +
                  (period === k ? "bg-ink text-white" : "text-slate-600 hover:bg-slate-100")
                }
              >
                {k.toUpperCase()}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50"
          >
            {show ? "Hide chart" : "Show chart"}
          </button>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <YoyCard label="MTD Room Revenue" ty={mtd.ty} ly={mtd.ly} highlight={period === "mtd"} />
        <YoyCard label="YTD Room Revenue" ty={ytd.ty} ly={ytd.ly} highlight={period === "ytd"} />
      </div>
      <p className="mt-2 text-xs text-slate-400">
        Room revenue, this year vs last year. Excludes Jacksonville North (not operated last year).
        Davenport opened Jun&nbsp;&rsquo;25 (partial last-year comparison).
      </p>
      {show && <YoyChart items={items} period={period} />}
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
    spark: p.spark ?? [],
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
    <>
      <FreshnessStamp report={report} />
      <div className="lg:flex lg:gap-6">
        <Rail items={railItems} selected={selected} onSelect={setSelected} />
        <div className="min-w-0 flex-1">
          {selected === "all" || !current ? (
            <>
              <PortfolioSummary props={report.actual} />
              <YoyRevenue props={report.actual} />
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
          <MethodologyFooter />
        </div>
      </div>
    </>
  );
}
