"use client";

import { useState } from "react";
import ExportMenu from "@/components/ExportMenu";
// Pure helpers, no server runtime — safe in a client component.
import { displayOcc } from "@/lib/occupancy";
import {
  Bar,
  Card,
  Kpi,
  Label,
  Notice,
  SectionTitle,
  StatusDot,
} from "@/components/ui";
import { buildMatrix, exportFilename, type ExportColumn } from "@/lib/export";

export type Daily = { date: string; occupancy: number };
export type Live = {
  roomsOccupied: number;
  capacity: number;
  inHouse: number;
  guestsInHouse: number;
  arrivals: string;
  arrivalsConfirmed: number;
  departures: string;
  departuresConfirmed: number;
  stayovers: number;
  roomsBlocked: number;
  outOfService: number;
  percentageBlocked: number;
  bookings: number;
  cancellations: number;
} | null;

export type OccProperty = {
  code: string;
  name: string;
  county: string;
  id: string;
  configured: boolean;
  capacity: number; // live room count (weight for the portfolio average)
  adjustment: number; // capacityAdjustment, e.g. -20 renovation
  adjustmentNote?: string;
  excludeDefault: boolean; // default-off in the average (e.g. JN)
  /** Occupied ÷ inventory over the range, as a percentage, from the banked
   *  snapshot store — the same derivation `/report` uses. NOT Data Insights.
   *  See lib/occupancy.ts for why. */
  rawOcc: number | null;
  /** Room revenue ÷ occupied nights over the range. Same source as rawOcc, so
   *  a page can never mix a snapshot occupancy with a Data Insights rate. */
  adr?: number | null;
  /** Room revenue ÷ inventory room-days over the range. */
  revpar?: number | null;
  /** The raw sums behind rawOcc/adr/revpar, so any consumer can aggregate a
   *  PORTFOLIO figure correctly (Σrev ÷ Σnights) instead of averaging
   *  per-property averages — which silently over-weighted small properties. */
  occupiedNights?: number;
  inventoryNights?: number;
  roomRev?: number;
  daily: Daily[];
  live: Live;
  error?: string | null;
};

function pct(n: number) {
  return `${n.toFixed(1)}%`;
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <Kpi label={label} value={value} sub={sub} />;
}

// The displayed occupancy. Single definition in lib/occupancy.ts — this used
// to be re-implemented here, in ops-insights and in ops-pdf-occupancy, and the
// three drifted (KE read 83.0% on /ops against 73.7% on /report).
const effOcc = displayOcc;

function DailyBars({ daily }: { daily: Daily[] }) {
  if (!daily.length) return null;
  const max = Math.max(100, ...daily.map((d) => d.occupancy));
  return (
    <div className="mt-3.5">
      <div className="flex h-24 items-end gap-[3px]">
        {daily.map((d) => (
          <div
            key={d.date}
            title={`${d.date}: ${pct(d.occupancy)}`}
            className="flex-1 rounded-t-[3px] bg-navy"
            style={{ height: `${Math.max(2, (d.occupancy / max) * 100)}%` }}
          />
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-txt3">
        <span>{daily[0].date}</span>
        {daily.length > 1 && <span>{daily[daily.length - 1].date}</span>}
      </div>
    </div>
  );
}

function Detail({ p }: { p: OccProperty }) {
  if (!p.configured) {
    return (
      <Notice>
        Awaiting key — <code className="text-xs">CLOUDBEDS_API_KEY_{p.code}</code>
      </Notice>
    );
  }
  if (p.error) {
    return (
      <Notice tone="warn">
        <p className="font-semibold">Data Insights error</p>
        <p className="mt-1">{p.error}</p>
      </Notice>
    );
  }

  const occ = effOcc(p);
  return (
    <>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-xs text-txt3">
          {p.county} County · ID {p.id}
        </span>
        {p.adjustment !== 0 && p.adjustmentNote && (
          <span className="text-xs text-warn">
            Capacity {p.adjustment} ({p.adjustmentNote})
          </span>
        )}
      </div>

      <Card as="section" className="px-5 py-5">
        <Label>Occupancy · range average</Label>
        <div className="mt-2 flex flex-wrap items-end gap-x-3">
          <span className="text-[44px] font-semibold leading-none tracking-[-.03em] text-txt">
            {occ !== null ? pct(occ) : "—"}
          </span>
          <span className="pb-1 text-[12.5px] text-txt2">
            {p.daily.length} day{p.daily.length === 1 ? "" : "s"}
            {p.adjustment !== 0 ? " · adjusted capacity" : ""}
          </span>
        </div>
        <DailyBars daily={p.daily} />
      </Card>

      {p.live && (
        <section className="mt-4">
          <Label className="mb-2.5">Today · live snapshot</Label>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3">
            <StatTile label="Rooms Occupied" value={String(p.live.roomsOccupied)} sub={`of ${p.live.capacity} total`} />
            <StatTile label="In-House" value={String(p.live.inHouse)} sub={`${p.live.guestsInHouse} guests`} />
            <StatTile label="Arrivals" value={String(p.live.arrivals)} sub={`${p.live.arrivalsConfirmed} confirmed`} />
            <StatTile label="Departures" value={String(p.live.departures)} sub={`${p.live.departuresConfirmed} confirmed`} />
            <StatTile label="Stayovers" value={String(p.live.stayovers)} />
            <StatTile
              label="Rooms Blocked"
              value={String(p.live.roomsBlocked)}
              sub={`${p.live.outOfService} OOO · ${pct(p.live.percentageBlocked)}`}
            />
            <StatTile label="Bookings (today)" value={String(p.live.bookings)} />
            <StatTile label="Cancellations" value={String(p.live.cancellations)} />
          </div>
        </section>
      )}
    </>
  );
}

// Daily occupancy series for the selected property (single-property table).
const DAILY_COLS: ExportColumn<Daily>[] = [
  { header: "Date", value: (d) => d.date },
  { header: "Occupancy %", value: (d) => d.occupancy.toFixed(1) },
];

export default function OccupancyView({
  properties,
  exportDate,
}: {
  properties: OccProperty[];
  exportDate: string; // YYYY-MM-DD, for export filenames
}) {
  const [included, setIncluded] = useState<Record<string, boolean>>(() => {
    const o: Record<string, boolean> = {};
    for (const p of properties) o[p.code] = p.rawOcc !== null && !p.excludeDefault;
    return o;
  });
  const [activeCode, setActiveCode] = useState(() => {
    const r = properties.find((p) => p.rawOcc !== null);
    return r?.code ?? properties[0]?.code ?? "";
  });
  const toggle = (c: string) => setIncluded((s) => ({ ...s, [c]: !s[c] }));

  // Capacity-weighted portfolio occupancy over included properties.
  let num = 0;
  let den = 0;
  let cnt = 0;
  for (const p of properties) {
    if (!included[p.code]) continue;
    const occ = effOcc(p);
    if (occ === null || p.capacity <= 0) continue;
    const eff = Math.max(0, p.capacity + p.adjustment);
    num += occ * eff;
    den += eff;
    cnt += 1;
  }
  const portfolioOcc = den > 0 ? num / den : null;
  const reporting = properties.filter((p) => p.rawOcc !== null).length;

  const ranked = [...properties].sort((a, b) => (effOcc(b) ?? -1) - (effOcc(a) ?? -1));
  const current = properties.find((p) => p.code === activeCode);

  // All-property occupancy summary (reflects current include-in-average toggles).
  const occSummaryMatrix = buildMatrix<OccProperty>(
    [
      { header: "Property", value: (p) => p.name },
      { header: "County", value: (p) => p.county },
      { header: "ID", value: (p) => p.id },
      { header: "Occupancy %", value: (p) => { const o = effOcc(p); return o === null ? "" : o.toFixed(1); } },
      { header: "In average", value: (p) => (included[p.code] ? "Yes" : "No") },
    ],
    ranked,
  );
  const dailyMatrix = buildMatrix(DAILY_COLS, current?.daily ?? []);

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Headline: portfolio occupancy for the selected range */}
      <Card
        as="section"
        className="scroll-mt-24 px-5 py-5 lg:scroll-mt-28"
        id="portfolio"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <Label>Portfolio occupancy</Label>
          <span className="text-[11.5px] text-txt3">
            {cnt} of {reporting} in average
          </span>
        </div>
        {portfolioOcc !== null ? (
          <>
            <div className="mt-2.5 text-[52px] font-semibold leading-[.9] tracking-[-.03em] text-txt">
              {pct(portfolioOcc)}
            </div>
            <div className="mt-3.5">
              <Bar pct={portfolioOcc} tone="bg-accent" height={8} />
              <div className="mt-2 flex justify-between text-[11.5px] text-txt2">
                <span>Capacity-weighted across included properties</span>
                <span>{reporting} reporting</span>
              </div>
            </div>
          </>
        ) : (
          <p className="mt-2 text-[12.5px] text-txt3">
            No properties selected / no data for range.
          </p>
        )}
      </Card>

      {/* Occupancy by property with include-in-average toggles */}
      <section id="by-property" className="scroll-mt-24 lg:scroll-mt-28">
        <SectionTitle
          title="Property occupancy"
          sub="Select a property for its detail below · toggle whether it counts toward the average"
        >
          <ExportMenu
            filename={exportFilename("Occupancy", null, exportDate)}
            title="Occupancy by property"
            matrix={occSummaryMatrix}
          />
        </SectionTitle>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(268px,1fr))] gap-3">
          {ranked.map((p) => {
            const occ = effOcc(p);
            const isIn = !!included[p.code];
            const isActive = p.code === activeCode;
            return (
              <button
                key={p.code}
                type="button"
                onClick={() => setActiveCode(p.code)}
                className={
                  "block w-full rounded-[10px] border bg-surface px-4 py-3.5 text-left shadow-card transition-colors " +
                  (isActive ? "border-accent " : "border-line hover:border-accent ") +
                  (isIn ? "" : "opacity-60")
                }
              >
                <div className="mb-3 flex items-center gap-2">
                  <StatusDot occ={occ} />
                  <span className="truncate text-[13px] font-semibold tracking-[-.01em] text-txt">
                    {p.name}
                  </span>
                  <span className="ml-auto shrink-0 text-[11px] text-txt3">
                    {p.capacity} rms
                  </span>
                </div>
                <div className="flex items-end gap-2">
                  <div className="text-[28px] font-semibold leading-none tracking-[-.03em] text-txt">
                    {occ !== null ? pct(occ) : "—"}
                  </div>
                  {occ !== null && (
                    // Not a delta chip: this toggles whether the property counts
                    // toward the portfolio average, so it stays a control.
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggle(p.code);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          e.stopPropagation();
                          toggle(p.code);
                        }
                      }}
                      title={isIn ? "In average — click to exclude" : "Excluded — click to include"}
                      className={
                        "mb-0.5 cursor-pointer rounded-[5px] px-[7px] py-0.5 text-[11px] font-semibold " +
                        (isIn ? "bg-accent/10 text-accent" : "bg-surface2 text-txt2")
                      }
                    >
                      {isIn ? "✓ in avg" : "+ avg"}
                    </span>
                  )}
                </div>
                <div className="mt-3">
                  <Bar pct={occ} />
                </div>
                <div className="mt-2.5 flex justify-between text-[11.5px] text-txt2">
                  <span>{p.county} County · {p.id}</span>
                  {p.adjustment !== 0 ? (
                    <span className="text-warn">{p.adjustment} cap. adj.</span>
                  ) : (
                    <span className="text-txt3">{p.daily.length} days</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Per-property detail */}
      <section id="detail" className="scroll-mt-24 lg:scroll-mt-28">
        <SectionTitle title="Property detail" sub={current ? current.name : undefined}>
          {current && current.daily.length > 0 && (
            <ExportMenu
              filename={exportFilename("OccupancyDaily", current.id, exportDate)}
              title={`Daily occupancy — ${current.name}`}
              matrix={dailyMatrix}
            />
          )}
        </SectionTitle>
        <div
          role="tablist"
          className="flex gap-0.5 overflow-x-auto rounded-t-[10px] border border-b-0 border-line bg-surface2 px-1 pt-1"
        >
          {properties.map((p) => {
            const isActive = p.code === activeCode;
            // Data state, not occupancy: reporting / configured-but-silent / no key.
            const dot = p.rawOcc !== null ? "bg-pos" : p.configured ? "bg-warn" : "bg-lineStrong";
            return (
              <button
                key={p.code}
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveCode(p.code)}
                className={
                  "flex shrink-0 items-center gap-2 rounded-t-[7px] px-3.5 py-2 text-[12.5px] font-semibold transition-colors " +
                  (isActive
                    ? "bg-surface text-txt shadow-seg"
                    : "text-txt2 hover:text-txt")
                }
              >
                <span className={"h-1.5 w-1.5 rounded-full " + dot} />
                {p.name}
              </button>
            );
          })}
        </div>
        <div className="rounded-b-[10px] border border-t-0 border-line bg-surface p-4 shadow-card sm:p-5">
          {current && <Detail p={current} />}
        </div>
      </section>
    </div>
  );
}
