"use client";

import { Fragment, useState } from "react";
import {
  Bar,
  Card,
  DeltaChip,
  FreshnessStrip,
  Kpi,
  KpiNavy,
  Label,
  Notice,
  PointChip,
  Rail as RailShell,
  SegTrack,
  StatusDot,
  TableScroll,
  occColor,
  railRowClass,
  segButton,
  surfaceButton,
  thClass,
} from "@/components/ui";
import {
  fmtDayHeader,
  isCountDependentRow,
  METHODOLOGY,
  periodBlockFor,
  periodHeaderLabels,
  portfolioRollup,
} from "@/lib/revenue-report";
import type {
  RevenueReport,
  PropertyActual,
  PropertyOnTheBooks,
  PeriodBlock,
  DerivedRow,
  OverviewPeriod,
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
 *  scarce ≤15% and ≤20% get a filled cell, plentiful ≥40% is called out in the
 *  accent. Three tiers only — the legend below the table names each one. */
function availClass(n: number | null): string {
  if (n == null) return "";
  if (n <= 0.15) return "bg-negbg font-semibold text-neg";
  if (n <= 0.2) return "bg-warnbg font-semibold text-warn";
  if (n >= 0.4) return "font-semibold text-accent";
  return "";
}

function rowsFor(anyAdjusted: boolean): MetricRow[] {
  return METRIC_ROWS.filter((m) => !m.keOnly || anyAdjusted);
}

function metricLabelCell(metric: MetricRow) {
  return (
    <td
      className={
        "sticky left-0 z-[1] whitespace-nowrap bg-surface px-4 py-2 text-[12.5px] " +
        (metric.indent ? "pl-8 text-txt3" : "font-semibold text-txt2")
      }
    >
      {metric.label}
    </td>
  );
}

/** Value cell shared by both detail tables. */
const CELL = "whitespace-nowrap px-4 py-2 text-right text-[12.5px] font-semibold text-txt";
const CELL_LY = "whitespace-nowrap px-4 py-2 text-right text-[12.5px] text-txt3";

function ActualTable({ property, asOf }: { property: PropertyActual; asOf: string }) {
  // Same date wording the PDF and Excel exports print under each period
  // heading. The web table used to be the ONLY surface that named a period
  // without saying what it covered — a reader could not tell whether
  // "Year-to-date" meant through today or through yesterday.
  const dates = periodHeaderLabels(asOf);
  const groups: Array<{
    label: string;
    block: PeriodBlock;
    dates: { current: string; lastYear: string };
  }> = [
    { label: "Yesterday", block: property.yesterday, dates: dates.yesterday },
    { label: "Month-to-date", block: property.mtd, dates: dates.mtd },
    { label: "Year-to-date", block: property.ytd, dates: dates.ytd },
  ];
  const anyAdjusted = groups.some((g) => g.block.actual.occAdjLess20 != null);
  const rows = rowsFor(anyAdjusted);

  return (
    <div className="overflow-x-auto rounded-[10px] border border-line bg-surface shadow-card">
      <table className="w-full min-w-[920px] border-collapse">
        <thead>
          <tr>
            <th className="sticky left-0 z-[3] bg-chrome px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[.07em] text-white">
              {property.name}
            </th>
            {groups.map((g) => (
              <th
                key={g.label}
                colSpan={3}
                className="border-l border-white/10 bg-navy2 px-4 py-2.5 text-center text-[11px] font-semibold uppercase tracking-[.07em] text-white"
              >
                {g.label}
                <div className="mt-1 text-[10px] font-normal normal-case tracking-normal text-white/60">
                  {g.dates.current}
                </div>
              </th>
            ))}
          </tr>
          <tr>
            <th className={thClass("left", true)}>History</th>
            {groups.map((g) =>
              ["Actual", "Last Year", "Variance"].map((l) => (
                <th key={`${g.label}-${l}`} className={thClass("right")}>
                  {l}
                  {/* The last-year column is the one that genuinely needs its
                      own date: it is a DIFFERENT year from the heading above. */}
                  {l === "Last Year" && (
                    <div className="mt-0.5 text-[10px] font-normal normal-case tracking-normal text-txt3">
                      {g.dates.lastYear}
                    </div>
                  )}
                </th>
              )),
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((metric) => {
            const isAvail = metric.label === AVAILABILITY_LABEL;
            return (
              <tr key={metric.label} className="border-t border-line">
                {metricLabelCell(metric)}
                {groups.map((g) => {
                  const blanked = g.block.countsPartial === true && isCountDependentRow(metric.key);
                  const actualVal = blanked ? null : metric.get(g.block.actual);
                  const lyVal = g.block.lastYear ? metric.get(g.block.lastYear) : null;
                  const varVal = actualVal == null || lyVal == null ? null : actualVal - lyVal;
                  return (
                    <Fragment key={g.label}>
                      <td className={CELL + (isAvail ? " " + availClass(actualVal) : "")}>
                        {blanked ? BLANKED : fmtMetric(metric.kind, actualVal)}
                      </td>
                      <td className={CELL_LY + (isAvail ? " " + availClass(lyVal) : "")}>
                        {fmtMetric(metric.kind, lyVal)}
                      </td>
                      <td className={CELL + (isAvail ? " " + availClass(varVal) : "")}>
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
    <div className="overflow-x-auto rounded-[10px] border border-line bg-surface shadow-card">
      <table className="w-full min-w-[760px] border-collapse">
        <thead>
          <tr>
            <th className="sticky left-0 z-[3] bg-chrome px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[.07em] text-white">
              {property.name}
            </th>
            {property.days.map((d) => (
              <th
                key={d.date}
                className="border-l border-white/10 bg-navy2 px-4 py-2.5 text-center text-[11px] font-semibold uppercase tracking-[.07em] text-white"
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
              <tr key={metric.label} className="border-t border-line">
                {metricLabelCell(metric)}
                {property.days.map((d) => {
                  const val = metric.get(d.row);
                  return (
                    <td
                      key={d.date}
                      className={CELL + (isAvail ? " " + availClass(val) : "")}
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

// `pOcc` here is a FRACTION (0–1); the shared occColor/StatusDot helpers take a
// percentage, so scale before handing it over.
const asPct = (pOcc: number | null) => (pOcc == null ? null : pOcc * 100);

type RailItem = { code: string; name: string; occ: number | null };

type PeriodLabels = { short: string; range: string; ytdRange: string };

/** Wording for the selected overview period. The MTD range comes from
 *  `periodHeaderLabels` — the same function the detail tables and the Excel/PDF
 *  exports use — so the toggle and the tables can never name different windows. */
function periodLabels(asOf: string, period: OverviewPeriod): PeriodLabels {
  const l = periodHeaderLabels(asOf);
  // ytdRange is carried on BOTH periods: Room revenue falls back to year-to-date
  // in Yesterday mode, so that tile needs the YTD window either way.
  return period === "mtd"
    ? { short: "Month to date", range: l.mtd.current, ytdRange: l.ytd.current }
    : { short: "Yesterday", range: fmtDayHeader(asOf), ytdRange: l.ytd.current };
}

/** MTD sums out-of-order ROOM-NIGHTS across the month; Yesterday is a count of
 *  rooms on one day. Same field, different unit — so the tile is relabelled
 *  rather than left to imply 217 rooms are out of order right now. */
function oooLabel(period: OverviewPeriod): string {
  return period === "mtd" ? "Out-of-order room-nights" : "Rooms out of order";
}

/** Reporting-window switch for the whole overview. Only Yesterday and MTD — see
 *  `OverviewPeriod` for why YTD is deliberately not offered here. */
function PeriodToggle({
  period,
  onPeriod,
  labels,
}: {
  period: OverviewPeriod;
  onPeriod: (p: OverviewPeriod) => void;
  labels: PeriodLabels;
}) {
  return (
    <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3">
      <div className="text-[11.5px] text-txt3">
        Showing <span className="font-semibold text-txt2">{labels.short}</span> · {labels.range}
      </div>
      <SegTrack>
        <button
          type="button"
          onClick={() => onPeriod("yesterday")}
          className={segButton(period === "yesterday")}
        >
          Yesterday
        </button>
        <button
          type="button"
          onClick={() => onPeriod("mtd")}
          className={segButton(period === "mtd")}
        >
          Month to date
        </button>
      </SegTrack>
    </div>
  );
}

/** Shown when a period's count snapshots do not cover its whole range. Names
 *  exactly which figures are blank, because Room revenue and RevPAR beside them
 *  ARE trustworthy — they come from the exact revenue backfill and the stored
 *  inventory, not from accumulating counts. */
function PartialCountsNotice() {
  return (
    <p className="mb-3.5 text-[11.5px] leading-relaxed text-warn">
      Occupancy, ADR and out-of-order are blank for this period: daily counts do not yet cover its
      full range. Room revenue and RevPAR are unaffected.
    </p>
  );
}

/** Property navigation. Each row carries its own occupancy figure and bar, so
 *  the rail doubles as an at-a-glance ranking while you're deep in one property. */
function Rail({
  items,
  selected,
  onSelect,
  portfolioOcc,
}: {
  items: RailItem[];
  selected: string;
  onSelect: (code: string) => void;
  portfolioOcc: number | null;
}) {
  const row = (
    key: string,
    label: string,
    occ: number | null,
    active: boolean,
    dotTone: string,
    barTone: string,
    first = false,
  ) => (
    <button
      key={key}
      type="button"
      onClick={() => onSelect(key)}
      className={railRowClass(active) + (first ? " lg:border-b lg:border-b-line" : "")}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${dotTone}`} />
        <span className="truncate text-[12.5px] font-semibold tracking-[-.01em]">{label}</span>
        <span className="ml-auto shrink-0 pl-2 text-[12px] font-semibold text-txt2">
          {occ == null ? "—" : fmtPct(occ)}
        </span>
      </span>
      <span className="mt-[7px] hidden lg:block">
        <Bar pct={asPct(occ)} tone={barTone} height={4} />
      </span>
    </button>
  );

  return (
    <RailShell title="Properties">
      {row(
        "all",
        "All properties",
        portfolioOcc,
        selected === "all",
        "bg-accent",
        "bg-accent",
        true,
      )}
      {items.map((p) =>
        row(
          p.code,
          p.name,
          p.occ,
          selected === p.code,
          occColor(asPct(p.occ)),
          occColor(asPct(p.occ)),
        ),
      )}
    </RailShell>
  );
}

function Leaderboard({
  items,
  onSelect,
  period,
  labels,
}: {
  items: (RailItem & {
    roomRev: number | null;
    adr: number | null;
    revpar: number | null;
    spark: { day: string; pOcc: number }[];
  })[];
  onSelect: (code: string) => void;
  period: OverviewPeriod;
  labels: PeriodLabels;
}) {
  const mtd = period === "mtd";
  // Occupancy / ADR / RevPAR follow the toggle; Room Rev falls back to YTD in
  // Yesterday mode, matching the portfolio tile above.
  const tag = mtd ? "MTD" : "yest";
  const revTag = mtd ? "MTD" : "YTD";
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
        <div>
          <div className="text-[13.5px] font-semibold tracking-[-.01em] text-txt">
            Property leaderboard
          </div>
          <div className="mt-0.5 text-[11.5px] text-txt3">
            Select a property for its full Actual / On-the-Books detail
          </div>
        </div>
        {/* This table mixes two windows, so both are named. Without it the
            YTD revenue column reads as if it shared the toggle's period. */}
        <div className="text-[11.5px] leading-relaxed text-txt3 sm:text-right">
          Occupancy, ADR and RevPAR · {labels.range}
          <br />
          Room revenue ·{" "}
          {mtd ? `month to date, ${labels.range}` : `year to date, ${labels.ytdRange}`}
        </div>
      </div>
      <TableScroll>
        <table className="w-full min-w-[720px] border-collapse">
          <thead>
            <tr>
              <th className={thClass("left")}>Property</th>
              <th className={thClass("left")}>% Occ ({tag})</th>
              <th className={thClass("right")}>Room Rev ({revTag})</th>
              <th className={thClass("right")}>ADR ({tag})</th>
              <th className={thClass("right")}>RevPAR ({tag})</th>
              <th className={thClass("left")}>Occ trend (30d)</th>
              <th className={thClass("right")}></th>
            </tr>
          </thead>
          <tbody>
            {items.map((p) => (
              <tr
                key={p.code}
                onClick={() => onSelect(p.code)}
                className="cursor-pointer border-t border-line transition-colors hover:bg-surface2"
              >
                <td className="whitespace-nowrap px-4 py-2.5">
                  <span className="flex items-center gap-2 text-[12.5px] font-semibold text-txt">
                    <StatusDot occ={asPct(p.occ)} />
                    {p.name}
                  </span>
                </td>
                <td className="min-w-[136px] px-4 py-2.5">
                  <span className="flex items-center gap-2.5">
                    <span className="min-w-[56px] flex-1">
                      <Bar pct={asPct(p.occ)} />
                    </span>
                    <span className="w-[46px] text-right text-[12.5px] font-semibold text-txt">
                      {p.occ == null ? "—" : fmtPct(p.occ)}
                    </span>
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right text-[12.5px] font-semibold text-txt">
                  {fmtCompactCurrency(p.roomRev)}
                </td>
                <td className="px-4 py-2.5 text-right text-[12.5px] text-txt">
                  {fmtCompactCurrency(p.adr)}
                </td>
                <td className="px-4 py-2.5 text-right text-[12.5px] text-txt">
                  {fmtCompactCurrency(p.revpar)}
                </td>
                <td className="w-[132px] px-4 py-2">
                  <Sparkline points={p.spark} width={120} height={30} />
                </td>
                <td className="px-4 py-2.5 text-right text-sm text-txt3">›</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
    </Card>
  );
}

function KpiTile({
  label,
  value,
  sub,
  chip,
}: {
  label: string;
  value: string;
  sub?: string;
  chip?: React.ReactNode;
}) {
  return <Kpi label={label} value={value} sub={sub} chip={chip} />;
}

/** Total YTD room revenue across the portfolio. Deliberately NOT part of
 *  `portfolioRollup`: year-to-date is not an overview period (its counts are
 *  partial for as long as the snapshot store starts after Jan 1), and this is
 *  the one YTD figure the overview still surfaces. */
function ytdRoomRev(props: PropertyActual[]): number {
  return props.reduce((total, p) => total + p.ytd.actual.roomRev, 0);
}

function PortfolioSummary({
  props,
  period,
  labels,
}: {
  props: PropertyActual[];
  period: OverviewPeriod;
  labels: PeriodLabels;
}) {
  const s = portfolioRollup(props, period);
  const mtd = period === "mtd";
  // No delta chips here on purpose: the dedicated "Revenue vs. Last Year" card
  // directly below is the like-for-like comparison (it excludes properties that
  // weren't operated last year). A second, differently-scoped delta up here
  // would read as a contradiction.
  return (
    <>
      <div className="mb-3.5 grid grid-cols-[repeat(auto-fit,minmax(168px,1fr))] gap-3">
        <KpiNavy
          label="Portfolio occupancy"
          value={s.pOcc == null ? BLANKED : fmtPct(s.pOcc)}
          sub={`${s.reporting} of ${s.total} reporting · ${labels.short.toLowerCase()}`}
        />
        {/* Room revenue is the one tile that does not follow the toggle in
            Yesterday mode: a single day's revenue is not a useful headline, so
            Yesterday keeps the YTD total it has always shown. */}
        <KpiTile
          label="Room revenue"
          value={fmtCompactCurrency(mtd ? s.roomRev : ytdRoomRev(props))}
          sub={mtd ? `Month to date · ${labels.range}` : `Year to date · ${labels.ytdRange}`}
        />
        <KpiTile label="ADR" value={fmtCompactCurrency(s.adr)} sub={`${labels.short}, combined`} />
        <KpiTile label="RevPAR" value={fmtCompactCurrency(s.revpar)} sub={labels.short} />
        <KpiTile
          label={oooLabel(period)}
          value={s.ooo == null ? BLANKED : s.ooo.toLocaleString()}
          sub={labels.short}
        />
      </div>
      {s.countsPartial && <PartialCountsNotice />}
    </>
  );
}

function PropertyDetail({
  actual,
  onTheBooks,
  view,
  onView,
  period,
  labels,
  asOf,
}: {
  actual: PropertyActual;
  onTheBooks: PropertyOnTheBooks | undefined;
  view: "actual" | "onTheBooks";
  onView: (v: "actual" | "onTheBooks") => void;
  period: OverviewPeriod;
  labels: PeriodLabels;
  asOf: string;
}) {
  const block = periodBlockFor(actual, period);
  const y = block.actual;
  const yLY = block.lastYear;
  const ytd = actual.ytd.actual;
  const mtd = period === "mtd";
  // Count-dependent tiles are undermined when this block's count snapshots do
  // not cover its whole range; RevPAR and Room revenue never are. Same rule the
  // detail table below applies cell by cell, via isCountDependentRow.
  const partial = block.countsPartial === true;

  return (
    <div className="space-y-3.5">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(168px,1fr))] gap-3">
        <KpiTile
          label="% Occupied"
          value={partial ? BLANKED : fmtPct(y.pOcc)}
          sub={labels.short}
          // Occupancy is already a percentage, so the movement is in points.
          chip={
            !partial && yLY?.pOcc != null ? (
              <PointChipPct current={y.pOcc} prior={yLY.pOcc} />
            ) : undefined
          }
        />
        {/* Yesterday keeps the YTD total it has always shown — one day's
            revenue is not a useful headline. MTD shows the month. */}
        <KpiTile
          label="Room revenue"
          value={fmtCompactCurrency(mtd ? y.roomRev : ytd.roomRev)}
          sub={
            mtd
              ? yLY?.roomRev != null
                ? `LY ${fmtCompactCurrency(yLY.roomRev)}`
                : "Month to date"
              : actual.ytd.lastYear?.roomRev != null
                ? `LY ${fmtCompactCurrency(actual.ytd.lastYear.roomRev)}`
                : `Year to date · ${labels.ytdRange}`
          }
          chip={
            mtd ? (
              <DeltaChip current={y.roomRev} prior={yLY?.roomRev ?? null} />
            ) : (
              <DeltaChip current={ytd.roomRev} prior={actual.ytd.lastYear?.roomRev ?? null} />
            )
          }
        />
        <KpiTile
          label="ADR"
          value={partial ? BLANKED : fmtCompactCurrency(y.adrCombined)}
          sub={`${labels.short}, combined`}
          chip={
            partial ? undefined : (
              <DeltaChip current={y.adrCombined} prior={yLY?.adrCombined ?? null} />
            )
          }
        />
        <KpiTile
          label="RevPAR"
          value={fmtCompactCurrency(y.revpar)}
          sub={labels.short}
          chip={<DeltaChip current={y.revpar} prior={yLY?.revpar ?? null} />}
        />
        <KpiTile
          label={mtd ? "Out-of-order room-nights" : "Out of order"}
          value={partial ? BLANKED : y.ooo.toLocaleString()}
          sub={labels.short}
          // Fewer OOO rooms is better, hence inverse.
          chip={
            partial ? undefined : <DeltaChip current={y.ooo} prior={yLY?.ooo ?? null} inverse />
          }
        />
      </div>
      {partial && <PartialCountsNotice />}

      {(actual.spark?.length ?? 0) >= 2 && (
        <Card className="px-5 py-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
            <div className="text-[13px] font-semibold text-txt">
              Occupancy · trailing captured days
            </div>
            <div className="text-[11.5px] text-txt3">
              {actual.spark!.length} days · {fmtPct(actual.spark![0].pOcc)} →{" "}
              {fmtPct(actual.spark!.at(-1)!.pOcc)}
            </div>
          </div>
          <Sparkline points={actual.spark!} width={600} height={90} fill />
          <div className="mt-1.5 flex justify-between text-[11px] text-txt3">
            <span>{actual.spark![0].day}</span>
            <span>{actual.spark!.at(-1)!.day}</span>
          </div>
        </Card>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-[15px] font-semibold tracking-[-.01em] text-txt">Detailed metrics</div>
        <SegTrack>
          <button type="button" onClick={() => onView("actual")} className={segButton(view === "actual")}>
            Actual
          </button>
          <button
            type="button"
            onClick={() => onView("onTheBooks")}
            className={segButton(view === "onTheBooks")}
          >
            On the books
          </button>
        </SegTrack>
      </div>

      {view === "actual" ? (
        <ActualTable property={actual} asOf={asOf} />
      ) : onTheBooks ? (
        <OnTheBooksTable property={onTheBooks} />
      ) : (
        <Notice>No on-the-books data for this property.</Notice>
      )}
    </div>
  );
}

/** Point-movement chip for two FRACTIONS (0–1) that represent percentages. */
function PointChipPct({ current, prior }: { current: number; prior: number }) {
  return <PointChip delta={(current - prior) * 100} />;
}

/** Inline SVG sparkline of trailing daily occupancy. Deliberately unlabelled —
 *  it conveys shape, not values; the tables carry the numbers. Renders nothing
 *  below 2 points so a single banked day doesn't imply a trend. */
function Sparkline({
  points,
  width = 110,
  height = 26,
  fill = false,
}: {
  points: { day: string; pOcc: number }[];
  width?: number;
  height?: number;
  /** Stretch to the container width and shade the area under the line. */
  fill?: boolean;
}) {
  if (points.length < 2) return <span className="text-xs text-txt3">—</span>;
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
  // `fill` closes the path along the baseline for the large single-property
  // chart; the in-table sparklines stay as bare strokes.
  const area = `M${pad},${height} L${path.slice(1)} L${(pad + (points.length - 1) * dx).toFixed(1)},${height} Z`;
  return (
    <svg
      width={fill ? undefined : width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio={fill ? "none" : undefined}
      className={fill ? "block w-full" : "overflow-visible align-middle"}
      role="img"
      aria-label={`Occupancy trend over the last ${points.length} captured days, ${fmtPct(first.pOcc)} to ${fmtPct(last.pOcc)}`}
    >
      {fill && (
        <path
          d={area}
          stroke="none"
          className={rising ? "fill-pos/10" : "fill-neg/10"}
        />
      )}
      <path d={path} fill="none" stroke="currentColor" strokeWidth={fill ? 1.8 : 1.5} strokeLinejoin="round"
        className={rising ? "text-pos" : "text-neg"} />
      {!fill && (
        <circle cx={(pad + (points.length - 1) * dx).toFixed(1)} cy={y(last.pOcc).toFixed(1)} r="1.8"
          className={rising ? "fill-pos" : "fill-neg"} />
      )}
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
    <div className="mb-3.5 overflow-hidden rounded-[10px] border-t border-line">
      <FreshnessStrip
        current={current}
        title={current ? "Data current" : "Data may be stale"}
        detail={
          <>
            Last captured day <span className="font-semibold">{f.latestCapturedDate}</span> ·{" "}
            {f.propertiesOnLatest} of {f.propertiesExpected} properties reported
            {!current && (
              <> — this report is for {report.asOf}; the daily capture has not landed yet.</>
            )}
          </>
        }
        trailing={`Store written ${banked}`}
      />
      <ProvenanceStrip report={report} />
    </div>
  );
}

/** Preliminary-vs-final and manual-override provenance.
 *
 *  The room-revenue ledger keeps posting for days after a stay: re-querying one
 *  Davenport day moved its transient revenue +48% and another -1.7%. So a figure
 *  for a recent day is a flash, not a close. This says which days are settled and
 *  where a number is a manual override rather than Cloudbeds-sourced — the report
 *  should never present the two as the same thing. */
function ProvenanceStrip({ report }: { report: RevenueReport }) {
  const overrides = report.oooOverrideNotes ?? [];
  if (!report.finalThrough && overrides.length === 0) return null;
  return (
    <div className="border-t border-line bg-surface2 px-5 py-2.5 text-[11.5px] leading-relaxed text-txt2">
      {report.finalThrough ? (
        <>
          <span className="font-semibold">Final through {report.finalThrough}</span> · later days are
          preliminary and restated nightly as the ledger settles.
        </>
      ) : (
        <span className="font-semibold">All figures preliminary</span>
      )}
      {overrides.length > 0 && (
        <div className="mt-1 text-warn">
          <span className="font-semibold">Manual out-of-order override:</span> {overrides.join("; ")}
        </div>
      )}
    </div>
  );
}

/** Monica-confirmed methodology, collapsed by default. Same wording as the
 *  Excel/PDF exports and the Teams card (lib/revenue-report METHODOLOGY). */
function MethodologyFooter() {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3.5 overflow-hidden rounded-[10px] border border-line bg-surface">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-5 py-3.5 text-left text-txt2 transition-colors hover:text-txt"
      >
        <span
          className="inline-block text-[15px] text-txt3 transition-transform"
          style={{ transform: open ? "rotate(90deg)" : "none" }}
        >
          ›
        </span>
        <span className="text-[12.5px] font-semibold">Methodology &amp; sources</span>
        <span className="ml-auto hidden text-[11px] text-txt3 sm:block">
          Confirmed by Monica Oco (Revenue Management) · 2026-07-24, rate plans re-confirmed 07/27
        </span>
      </button>
      {open && (
        <div className="grid gap-x-8 border-t border-line px-5 pb-5 pt-1 sm:grid-cols-2">
          {METHODOLOGY.map((sec) => (
            <div key={sec.heading} className="border-b border-line py-3 last:border-b-0">
              <p className="mb-1 text-[11.5px] font-semibold text-txt2">{sec.heading}</p>
              <ul className="list-disc space-y-1 pl-4 text-xs leading-relaxed text-txt3">
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

/** Names the three conditional-format tiers used in the % Available row. */
function Legend() {
  return (
    <div className="mt-3.5 flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-[10px] border border-line bg-surface px-5 py-3 text-[11px] text-txt3">
      <span className="font-semibold text-txt2">% Available</span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-2.5 w-2.5 rounded-[3px] bg-negbg ring-1 ring-inset ring-neg/40" />
        ≤ 15% — scarce
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-2.5 w-2.5 rounded-[3px] bg-warnbg ring-1 ring-inset ring-warn/40" />
        ≤ 20% — tight
      </span>
      <span className="flex items-center gap-1.5">
        <span className="font-semibold text-accent">≥ 40%</span> — plentiful
      </span>
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

/** Compact delta used inside the chart, above each property's bar pair. */
function DeltaBadge({ ty, ly }: { ty: number | null; ly: number | null }) {
  return <DeltaChip current={ty} prior={ly} className="!px-1.5 !text-[10.5px]" />;
}

/** One of the two revenue panes inside the "Revenue vs. last year" card. The
 *  selected period is the one the chart below is drawn for. */
function YoyPane({
  label,
  ty,
  ly,
  first,
  selected,
}: {
  label: string;
  ty: number;
  ly: number;
  first?: boolean;
  selected?: boolean;
}) {
  return (
    <div
      className={
        "border-b border-line px-5 py-4 " +
        (first ? "sm:border-r sm:border-r-line " : "") +
        (selected ? "bg-accent/[.04]" : "")
      }
    >
      <Label>{label}</Label>
      <div className="mt-2.5 flex items-end gap-2.5">
        <div className="text-[30px] font-semibold leading-none tracking-[-.03em] text-txt">
          {fmtCompactCurrency(ty)}
        </div>
        <div className="mb-1">
          <DeltaChip current={ty} prior={ly} />
        </div>
      </div>
      <div className="mt-2 text-xs text-txt3">
        Last year {fmtCompactCurrency(ly)} · Δ {fmtCompactCurrency(ty - ly)}
      </div>
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
  const H = 186;
  return (
    <div className="overflow-x-auto px-5 pb-4 pt-5">
      <div className="mb-4 flex gap-5">
        <span className="flex items-center gap-1.5 text-[11.5px] text-txt2">
          <span className="inline-block h-[11px] w-[11px] rounded-[2px] bg-navy" /> This year
        </span>
        <span className="flex items-center gap-1.5 text-[11.5px] text-txt2">
          <span className="inline-block h-[11px] w-[11px] rounded-[2px] bg-sky" /> Last year
        </span>
      </div>
      <div className="flex min-w-[720px] items-end gap-4">
        {items.map((x) => (
          <div key={x.code} className="flex min-w-[64px] flex-1 flex-col items-center">
            <DeltaBadge ty={ty(x)} ly={ly(x)} />
            <div className="mt-2 flex w-full items-end justify-center gap-[5px]" style={{ height: H }}>
              <div
                title={`This year ${fmtCompactCurrency(ty(x))}`}
                className="w-[22px] rounded-t-[3px] bg-navy"
                style={{ height: `${Math.max(2, ((ty(x) ?? 0) / max) * H)}px` }}
              />
              <div
                title={`Last year ${fmtCompactCurrency(ly(x))}`}
                className="w-[22px] rounded-t-[3px] bg-sky"
                style={{ height: `${Math.max(2, ((ly(x) ?? 0) / max) * H)}px` }}
              />
            </div>
            <span className="mt-2.5 text-[11px] font-semibold text-txt2">{x.code}</span>
            <span className="mt-[3px] text-[10.5px] text-txt3">{fmtCompactCurrency(ty(x))}</span>
            {x.flag && (
              <span className="mt-1 rounded-[4px] bg-warnbg px-1.5 py-px text-[10px] text-warn">
                {x.flag}
              </span>
            )}
          </div>
        ))}
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
    <Card className="mb-3.5 overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3.5">
        <div>
          <div className="text-[13.5px] font-semibold tracking-[-.01em] text-txt">
            Revenue vs. last year
          </div>
          <div className="mt-0.5 text-[11.5px] text-txt3">Room revenue, all sources</div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <SegTrack>
            {(["mtd", "ytd"] as YoyPeriod[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setPeriod(k)}
                className={segButton(period === k)}
              >
                {k.toUpperCase()}
              </button>
            ))}
          </SegTrack>
          <button type="button" onClick={() => setShow((v) => !v)} className={surfaceButton}>
            {show ? "Hide chart" : "Show chart"}
          </button>
        </div>
      </div>

      <div className="grid sm:grid-cols-2">
        <YoyPane label="Month to date" ty={mtd.ty} ly={mtd.ly} first selected={period === "mtd"} />
        <YoyPane label="Year to date" ty={ytd.ty} ly={ytd.ly} selected={period === "ytd"} />
      </div>

      {show && <YoyChart items={items} period={period} />}

      <p className="border-t border-line px-5 py-3 text-[11px] leading-relaxed text-txt3">
        Excludes Jacksonville North (not operated last year). Davenport opened
        Jun&nbsp;&rsquo;25 — its last-year comparison is partial.
      </p>
    </Card>
  );
}

export default function RevenueReportView({ report }: { report: RevenueReport }) {
  const [selected, setSelected] = useState<string>("all");
  const [view, setView] = useState<"actual" | "onTheBooks">("actual");
  // Defaults to Yesterday: a complete, live-fetched day, and the figure every
  // existing reader of this page is used to seeing on load.
  const [period, setPeriod] = useState<OverviewPeriod>("yesterday");

  const labels = periodLabels(report.asOf, period);

  const railItems: RailItem[] = report.actual.map((p) => {
    const block = periodBlockFor(p, period);
    return {
      code: p.code,
      name: p.name,
      occ: block.countsPartial === true ? null : block.actual.pOcc,
    };
  });

  const leaderboardItems = report.actual.map((p) => {
    const block = periodBlockFor(p, period);
    const partial = block.countsPartial === true;
    return {
      code: p.code,
      name: p.name,
      occ: partial ? null : block.actual.pOcc,
      roomRev: period === "mtd" ? block.actual.roomRev : p.ytd.actual.roomRev,
      adr: partial ? null : block.actual.adrCombined,
      // RevPAR is revenue over inventory — never undermined by partial counts.
      revpar: block.actual.revpar,
      spark: p.spark ?? [],
    };
  });

  const current = report.actual.find((p) => p.code === selected);
  const currentOtb = report.onTheBooks.find((p) => p.code === selected);

  if (report.actual.length === 0) {
    return <Notice>No configured properties reported.</Notice>;
  }

  // Portfolio occupancy for the rail's "All properties" row — the same roll-up
  // the summary tiles use, for the same period, so the two never disagree.
  const portfolioOcc = portfolioRollup(report.actual, period).pOcc;

  return (
    <div className="lg:flex lg:gap-[18px] lg:items-start">
      <Rail
        items={railItems}
        selected={selected}
        onSelect={setSelected}
        portfolioOcc={portfolioOcc}
      />
      <div className="min-w-0 flex-1">
        <FreshnessStamp report={report} />
        <PeriodToggle period={period} onPeriod={setPeriod} labels={labels} />
        {selected === "all" || !current ? (
          <>
            <PortfolioSummary props={report.actual} period={period} labels={labels} />
            <YoyRevenue props={report.actual} />
            <Leaderboard
              items={leaderboardItems}
              onSelect={setSelected}
              period={period}
              labels={labels}
            />
          </>
        ) : (
          <PropertyDetail
            actual={current}
            onTheBooks={currentOtb}
            view={view}
            onView={setView}
            period={period}
            labels={labels}
            asOf={report.asOf}
          />
        )}
        <Legend />
        <MethodologyFooter />
      </div>
    </div>
  );
}
