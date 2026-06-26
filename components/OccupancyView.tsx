"use client";

import { useState } from "react";
import ExportMenu from "@/components/ExportMenu";
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
  rawOcc: number | null; // avg occupancy over the range, vs full capacity
  daily: Daily[];
  live: Live;
  error?: string | null;
};

function pct(n: number) {
  return `${n.toFixed(1)}%`;
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-900 sm:text-3xl">{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

// Re-base occupancy onto effective (post-adjustment) capacity:
// occ = sold/cap, so occ_adj = occ × cap/(cap+adj).
function effOcc(p: OccProperty): number | null {
  if (p.rawOcc === null) return null;
  const eff = p.capacity + p.adjustment;
  if (p.adjustment !== 0 && p.capacity > 0 && eff > 0) return p.rawOcc * (p.capacity / eff);
  return p.rawOcc;
}

function DailyBars({ daily }: { daily: Daily[] }) {
  if (!daily.length) return null;
  const max = Math.max(100, ...daily.map((d) => d.occupancy));
  return (
    <div className="mt-3">
      <div className="flex h-24 items-end gap-0.5">
        {daily.map((d) => (
          <div
            key={d.date}
            title={`${d.date}: ${pct(d.occupancy)}`}
            className="flex-1 rounded-t bg-accent/70"
            style={{ height: `${Math.max(2, (d.occupancy / max) * 100)}%` }}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-slate-400">
        <span>{daily[0].date}</span>
        {daily.length > 1 && <span>{daily[daily.length - 1].date}</span>}
      </div>
    </div>
  );
}

function Detail({ p }: { p: OccProperty }) {
  if (!p.configured) {
    return (
      <p className="rounded-lg bg-slate-50 px-4 py-8 text-center text-sm text-slate-400">
        Awaiting key — <code className="text-xs">CLOUDBEDS_API_KEY_{p.code}</code>
      </p>
    );
  }
  if (p.error) {
    return (
      <div className="rounded-lg bg-amber-50 px-4 py-4 text-sm text-amber-900">
        <p className="font-medium">Data Insights error</p>
        <p className="mt-1">{p.error}</p>
      </div>
    );
  }

  const occ = effOcc(p);
  return (
    <>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-xs text-slate-400">
          {p.county} County · ID {p.id}
        </span>
        {p.adjustment !== 0 && p.adjustmentNote && (
          <span className="text-xs text-amber-700">
            Capacity {p.adjustment} ({p.adjustmentNote})
          </span>
        )}
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
          Occupancy (range avg)
        </p>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-4">
          <span className="text-4xl font-semibold text-slate-900 sm:text-5xl">
            {occ !== null ? pct(occ) : "—"}
          </span>
          <span className="text-sm text-slate-500">
            {p.daily.length} day{p.daily.length === 1 ? "" : "s"}
            {p.adjustment !== 0 ? " · adj." : ""}
          </span>
        </div>
        <DailyBars daily={p.daily} />
      </section>

      {p.live && (
        <section className="mt-5">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
            Today (live snapshot)
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
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
      <section id="portfolio" className="scroll-mt-20 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6 lg:scroll-mt-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Portfolio Occupancy
          </p>
          <span className="text-xs text-slate-400">{cnt} of {reporting} in average</span>
        </div>
        {portfolioOcc !== null ? (
          <>
            <span className="mt-1 block text-5xl font-semibold text-slate-900 sm:text-6xl">
              {pct(portfolioOcc)}
            </span>
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-accent"
                style={{ width: `${Math.min(100, portfolioOcc)}%` }}
              />
            </div>
          </>
        ) : (
          <p className="mt-2 text-sm text-slate-400">No properties selected / no data for range.</p>
        )}
      </section>

      {/* Occupancy by property with include-in-average toggles */}
      <section id="by-property" className="scroll-mt-20 lg:scroll-mt-6">
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Occupancy by property — tap to view detail, toggle to include in the average
          </p>
          <ExportMenu
            filename={exportFilename("Occupancy", null, exportDate)}
            title="Occupancy by property"
            matrix={occSummaryMatrix}
          />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {ranked.map((p) => {
            const occ = effOcc(p);
            const isIn = !!included[p.code];
            const isActive = p.code === activeCode;
            return (
              <div
                key={p.code}
                onClick={() => setActiveCode(p.code)}
                className={
                  "cursor-pointer rounded-lg border bg-white px-3 py-2 shadow-sm transition " +
                  (isActive ? "border-accent ring-1 ring-accent/30 " : "border-slate-200 ") +
                  (isIn ? "" : "opacity-50")
                }
              >
                <div className="flex items-start justify-between gap-1">
                  <p className="truncate text-xs text-slate-500">{p.name}</p>
                  {occ !== null && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggle(p.code);
                      }}
                      title={isIn ? "In average — click to exclude" : "Excluded — click to include"}
                      className={
                        "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium " +
                        (isIn ? "bg-accent/10 text-accent" : "bg-slate-100 text-slate-500")
                      }
                    >
                      {isIn ? "✓ avg" : "+ avg"}
                    </button>
                  )}
                </div>
                <p className="text-lg font-semibold text-slate-900">
                  {occ !== null ? pct(occ) : "—"}
                </p>
                {p.adjustment !== 0 && <p className="text-[10px] text-amber-700">{p.adjustment} reno</p>}
              </div>
            );
          })}
        </div>
      </section>

      {/* Per-property detail */}
      <section id="detail" className="scroll-mt-20 lg:scroll-mt-6">
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Property detail
          </p>
          {current && current.daily.length > 0 && (
            <ExportMenu
              filename={exportFilename("OccupancyDaily", current.id, exportDate)}
              title={`Daily occupancy — ${current.name}`}
              matrix={dailyMatrix}
            />
          )}
        </div>
        <div
          role="tablist"
          className="flex gap-1 overflow-x-auto border-b border-slate-200 pb-px"
        >
          {properties.map((p) => {
            const isActive = p.code === activeCode;
            const dot = p.rawOcc !== null ? "bg-emerald-500" : p.configured ? "bg-amber-500" : "bg-slate-300";
            return (
              <button
                key={p.code}
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveCode(p.code)}
                className={
                  "flex shrink-0 items-center gap-2 rounded-t-lg px-4 py-2 text-sm font-medium transition-colors " +
                  (isActive
                    ? "border border-b-0 border-slate-200 bg-white text-slate-900"
                    : "text-slate-500 hover:bg-slate-100 hover:text-slate-700")
                }
              >
                <span className={"h-1.5 w-1.5 rounded-full " + dot} />
                {p.name}
              </button>
            );
          })}
        </div>
        <div className="rounded-b-xl rounded-tr-xl border border-t-0 border-slate-200 bg-slate-50/50 p-4 sm:p-5">
          {current && <Detail p={current} />}
        </div>
      </section>
    </div>
  );
}
