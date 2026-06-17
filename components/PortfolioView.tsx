"use client";

import { useState } from "react";
import type { PropertyDashboard } from "@/lib/cloudbeds";

function pct(n: number) {
  return `${n.toFixed(1)}%`;
}

// Per-property derived metrics, applying any manual capacity adjustment
// (e.g. Kissimmee East -20 for renovation) to the occupancy denominator.
function derive(pd: PropertyDashboard) {
  if (!pd.result?.ok) return null;
  const d = pd.result.data;
  const adj = pd.property.capacityAdjustment ?? 0;
  const effectiveCapacity = Math.max(0, d.capacity + adj);
  const occ = effectiveCapacity > 0 ? (d.roomsOccupied / effectiveCapacity) * 100 : 0;
  return { d, adj, effectiveCapacity, occ };
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

function Detail({ pd }: { pd: PropertyDashboard }) {
  const { property, configured, result } = pd;

  if (!configured) {
    return (
      <p className="rounded-lg bg-slate-50 px-4 py-8 text-center text-sm text-slate-400">
        Awaiting key — <code className="text-xs">CLOUDBEDS_API_KEY_{property.code}</code>
      </p>
    );
  }
  if (!result || !result.ok) {
    return (
      <div className="rounded-lg bg-amber-50 px-4 py-4 text-sm text-amber-900">
        <p className="font-medium">
          {result && result.status ? `HTTP ${result.status}` : "Error"} — data unavailable
        </p>
        <p className="mt-1">{result ? result.error : "Unknown error"}</p>
      </div>
    );
  }

  const der = derive(pd)!;
  const { d, adj, effectiveCapacity, occ } = der;

  return (
    <>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-xs text-slate-400">
          {property.county} County · ID {property.id}
        </span>
        <span className="text-xs text-slate-400">
          As of {d.property_now} ({d.timezone})
        </span>
      </div>

      {adj !== 0 && property.adjustmentNote && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          <span className="font-medium">Capacity adjusted {adj}:</span>{" "}
          {property.adjustmentNote}. Occupancy shown against {effectiveCapacity}{" "}
          rooms ({d.capacity} total − {Math.abs(adj)}).
        </div>
      )}

      {/* Occupancy hero (adjusted) */}
      <section className="mb-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Occupancy</p>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-4">
          <span className="text-4xl font-semibold text-slate-900 sm:text-5xl">{pct(occ)}</span>
          <span className="text-sm text-slate-500">
            {d.roomsOccupied} of {effectiveCapacity} rooms occupied
            {adj !== 0 ? ` (adj.)` : ""}
          </span>
        </div>
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-accent"
            style={{ width: `${Math.min(100, occ)}%` }}
          />
        </div>
      </section>

      {/* Metric tiles */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        <StatTile label="Rooms Occupied" value={String(d.roomsOccupied)} sub={`of ${effectiveCapacity} avail.`} />
        <StatTile label="In-House" value={String(d.inHouse)} sub={`${d.guestsInHouse} guests`} />
        <StatTile label="Arrivals" value={String(d.arrivals)} sub={`${d.arrivalsConfirmed} confirmed`} />
        <StatTile label="Departures" value={String(d.departures)} sub={`${d.departuresConfirmed} confirmed`} />
        <StatTile label="Stayovers" value={String(d.stayovers)} />
        <StatTile
          label="Rooms Blocked"
          value={String(d.roomsBlocked)}
          sub={`${d.roomBlocks.out_of_service} OOO · ${pct(d.percentageBlocked)}`}
        />
        <StatTile label="Bookings (today)" value={String(d.bookings)} />
        <StatTile label="Cancellations" value={String(d.cancellations)} />
      </section>
    </>
  );
}

export default function PortfolioView({ portfolio }: { portfolio: PropertyDashboard[] }) {
  const [included, setIncluded] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const pd of portfolio) {
      init[pd.property.code] = !!pd.result?.ok && !pd.property.excludeFromAggregate;
    }
    return init;
  });

  const firstReporting = portfolio.find((p) => p.result?.ok);
  const [activeCode, setActiveCode] = useState(
    firstReporting?.property.code ?? portfolio[0]?.property.code ?? "",
  );

  function toggle(code: string) {
    setIncluded((prev) => ({ ...prev, [code]: !prev[code] }));
  }

  // Live aggregate over included, reporting properties (effective capacities).
  const agg = portfolio.reduce(
    (acc, pd) => {
      if (!included[pd.property.code]) return acc;
      const der = derive(pd);
      if (!der) return acc;
      acc.cap += der.effectiveCapacity;
      acc.occRooms += der.d.roomsOccupied;
      acc.inHouse += der.d.inHouse;
      acc.arr += Number(der.d.arrivals || 0);
      acc.dep += Number(der.d.departures || 0);
      acc.blocked += der.d.roomsBlocked;
      acc.count += 1;
      return acc;
    },
    { cap: 0, occRooms: 0, inHouse: 0, arr: 0, dep: 0, blocked: 0, count: 0 },
  );
  const portfolioOcc = agg.cap > 0 ? (agg.occRooms / agg.cap) * 100 : null;
  const reportingCount = portfolio.filter((p) => p.result?.ok).length;

  // Strip ranked by occupancy (reporting first, highest first).
  const ranked = [...portfolio].sort((a, b) => {
    const ao = derive(a)?.occ ?? -1;
    const bo = derive(b)?.occ ?? -1;
    return bo - ao;
  });

  const current = portfolio.find((p) => p.property.code === activeCode);

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Portfolio aggregate */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Portfolio Occupancy
          </p>
          <span className="text-xs text-slate-400">
            {agg.count} of {reportingCount} properties in average
          </span>
        </div>
        {portfolioOcc !== null ? (
          <>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-4">
              <span className="text-4xl font-semibold text-slate-900 sm:text-5xl">
                {pct(portfolioOcc)}
              </span>
              <span className="text-sm text-slate-500">
                {agg.occRooms} of {agg.cap} rooms occupied
              </span>
            </div>
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-accent"
                style={{ width: `${Math.min(100, portfolioOcc)}%` }}
              />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-slate-500">In-house</span>
                <span className="font-medium text-slate-900">{agg.inHouse}</span>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-slate-500">Arrivals</span>
                <span className="font-medium text-slate-900">{agg.arr}</span>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-slate-500">Departures</span>
                <span className="font-medium text-slate-900">{agg.dep}</span>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-slate-500">Blocked</span>
                <span className="font-medium text-slate-900">{agg.blocked}</span>
              </div>
            </div>
          </>
        ) : (
          <p className="mt-2 text-sm text-slate-400">No properties selected for the average.</p>
        )}
      </section>

      {/* Current occupancy by property — with include-in-average toggles */}
      <section>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
          Current occupancy by property — tap a card to view detail, toggle to include in the average
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {ranked.map((pd) => {
            const der = derive(pd);
            const code = pd.property.code;
            const isIn = !!included[code];
            const isActive = code === activeCode;
            return (
              <div
                key={code}
                onClick={() => setActiveCode(code)}
                className={
                  "cursor-pointer rounded-lg border bg-white px-3 py-2 shadow-sm transition " +
                  (isActive ? "border-accent ring-1 ring-accent/30 " : "border-slate-200 ") +
                  (isIn ? "" : "opacity-50")
                }
              >
                <div className="flex items-start justify-between gap-1">
                  <p className="truncate text-xs text-slate-500">{pd.property.name}</p>
                  {der && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggle(code);
                      }}
                      title={isIn ? "In average — click to exclude" : "Excluded — click to include"}
                      className={
                        "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium " +
                        (isIn
                          ? "bg-accent/10 text-accent"
                          : "bg-slate-100 text-slate-500")
                      }
                    >
                      {isIn ? "✓ avg" : "+ avg"}
                    </button>
                  )}
                </div>
                <p className="text-lg font-semibold text-slate-900">
                  {der ? pct(der.occ) : "—"}
                </p>
                {der && der.adj !== 0 && (
                  <p className="text-[10px] text-amber-700">{der.adj} reno</p>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Individual property data — clickable tabs */}
      <section>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
          Property detail
        </p>
        <div
          role="tablist"
          aria-label="Properties"
          className="flex gap-1 overflow-x-auto border-b border-slate-200 pb-px"
        >
          {portfolio.map((p) => {
            const code = p.property.code;
            const isActive = code === activeCode;
            const dot = p.result?.ok
              ? "bg-emerald-500"
              : p.configured
                ? "bg-amber-500"
                : "bg-slate-300";
            return (
              <button
                key={code}
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveCode(code)}
                className={
                  "flex shrink-0 items-center gap-2 rounded-t-lg px-4 py-2 text-sm font-medium transition-colors " +
                  (isActive
                    ? "border border-b-0 border-slate-200 bg-white text-slate-900"
                    : "text-slate-500 hover:bg-slate-100 hover:text-slate-700")
                }
              >
                <span className={"h-1.5 w-1.5 rounded-full " + dot} />
                {p.property.name}
              </button>
            );
          })}
        </div>
        <div className="rounded-b-xl rounded-tr-xl border border-t-0 border-slate-200 bg-slate-50/50 p-4 sm:p-5">
          {current && <Detail pd={current} />}
        </div>
      </section>
    </div>
  );
}
