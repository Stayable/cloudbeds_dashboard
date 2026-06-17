"use client";

import { useState } from "react";
import type { PropertyDashboard } from "@/lib/cloudbeds";

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

  const d = result.data;
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

      {/* Occupancy hero */}
      <section className="mb-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Occupancy</p>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-4">
          <span className="text-4xl font-semibold text-slate-900 sm:text-5xl">
            {pct(d.percentageOccupied)}
          </span>
          <span className="text-sm text-slate-500">
            {d.roomsOccupied} of {d.capacity} rooms occupied
          </span>
        </div>
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-accent"
            style={{ width: `${Math.min(100, d.percentageOccupied)}%` }}
          />
        </div>
      </section>

      {/* Metric tiles */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        <StatTile label="Rooms Occupied" value={String(d.roomsOccupied)} sub={`of ${d.capacity} total`} />
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

export default function PropertyTabs({ portfolio }: { portfolio: PropertyDashboard[] }) {
  const firstReporting = portfolio.findIndex((p) => p.result?.ok);
  const [active, setActive] = useState(firstReporting >= 0 ? firstReporting : 0);
  const current = portfolio[active];

  return (
    <div>
      {/* Tabs — browser-style, horizontally scrollable on small screens */}
      <div
        role="tablist"
        aria-label="Properties"
        className="flex gap-1 overflow-x-auto border-b border-slate-200 pb-px"
      >
        {portfolio.map((p, i) => {
          const isActive = i === active;
          const dot = p.result?.ok
            ? "bg-emerald-500"
            : p.configured
              ? "bg-amber-500"
              : "bg-slate-300";
          return (
            <button
              key={p.property.code}
              role="tab"
              aria-selected={isActive}
              onClick={() => setActive(i)}
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

      {/* Panel */}
      <div className="rounded-b-xl rounded-tr-xl border border-t-0 border-slate-200 bg-slate-50/50 p-4 sm:p-5">
        {current && <Detail pd={current} />}
      </div>
    </div>
  );
}
