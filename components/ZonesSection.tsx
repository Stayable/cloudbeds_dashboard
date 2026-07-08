"use client";

import { useState } from "react";
import ExportMenu from "@/components/ExportMenu";
import { buildMatrix, exportFilename } from "@/lib/export";
import type { ZoneGroup } from "@/lib/zones";

// Per-property zone breakdown, precomputed server-side (pure buildZoneGroups).
export type ZoneProperty = {
  code: string;
  name: string;
  id: string; // business ID, for export filenames
  configured: boolean;
  error?: string | null;
  total: number; // total rooms in inventory
  occupiedTotal: number; // rooms occupied today (In-House)
  oooTotal: number; // rooms out of service today
  groups: ZoneGroup[];
};

// Flatten a property's zones → export rows.
type Row = { zone: string; room: string; type: string; status: string };
const ROW_COLS = [
  { header: "Zone", value: (r: Row) => r.zone },
  { header: "Room", value: (r: Row) => r.room },
  { header: "Type", value: (r: Row) => r.type },
  { header: "Status", value: (r: Row) => r.status },
];

// Status precedence: OOO > occupied > vacant. Colors are shared by the chips and
// the legend so they read as one system.
function statusOf(r: { ooo: boolean; occupied: boolean }): "ooo" | "occupied" | "vacant" {
  if (r.ooo) return "ooo";
  if (r.occupied) return "occupied";
  return "vacant";
}
const CHIP_CLASS: Record<"ooo" | "occupied" | "vacant", string> = {
  occupied: "border-accent bg-accent text-white",
  vacant: "border-slate-200 bg-white text-slate-600",
  ooo: "border-amber-300 bg-amber-50 text-amber-800",
};

function RoomChip({ name, ooo, occupied, reason }: { name: string; ooo: boolean; occupied: boolean; reason?: string }) {
  const s = statusOf({ ooo, occupied });
  const title = s === "ooo" ? `Out of service — ${reason ?? "—"}` : s === "occupied" ? "Occupied" : "Vacant";
  return (
    <span
      title={title}
      className={"inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium tabular-nums " + CHIP_CLASS[s]}
    >
      {name}
      {s === "ooo" && <span className="ml-1 text-[10px] uppercase tracking-wide text-amber-600">OOO</span>}
    </span>
  );
}

function Legend() {
  const items: { s: "occupied" | "vacant" | "ooo"; label: string }[] = [
    { s: "occupied", label: "Occupied" },
    { s: "vacant", label: "Vacant" },
    { s: "ooo", label: "Out of service" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-3">
      {items.map((it) => (
        <span key={it.s} className="inline-flex items-center gap-1.5 text-xs text-slate-500">
          <span className={"h-3 w-3 rounded-sm border " + CHIP_CLASS[it.s]} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

function PropertyZones({ p }: { p: ZoneProperty }) {
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
        <p className="font-medium">Room inventory unavailable</p>
        <p className="mt-1">{p.error}</p>
      </div>
    );
  }
  if (!p.total) {
    return (
      <p className="rounded-lg bg-slate-50 px-4 py-8 text-center text-sm text-slate-400">
        No rooms returned for this property.
      </p>
    );
  }

  const buildings = p.groups.filter((g) => g.zone !== "Other").length;
  const occPct = p.total > 0 ? Math.round((p.occupiedTotal / p.total) * 100) : 0;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-slate-500">
          {p.total} rooms across {buildings} building{buildings === 1 ? "" : "s"} · {p.occupiedTotal}{" "}
          occupied ({occPct}%)
          {p.oooTotal > 0 && ` · ${p.oooTotal} out of service`}
        </p>
        <Legend />
      </div>

      {p.groups.map((g) => (
        <section key={g.zone} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h4 className="text-sm font-semibold text-slate-900">
              {g.zone}
              {g.zone === "Other" && (
                <span className="ml-2 text-[10px] font-normal uppercase tracking-wide text-slate-400">
                  no zone match
                </span>
              )}
            </h4>
            <span className="text-xs text-slate-500">
              {g.rooms.length} room{g.rooms.length === 1 ? "" : "s"} · {g.occupiedCount} occupied
              {g.oooCount > 0 && ` · ${g.oooCount} OOO`}
            </span>
          </div>
          {g.rooms.length ? (
            <div className="flex flex-wrap gap-1.5">
              {g.rooms.map((r) => (
                <RoomChip key={r.name} name={r.name} ooo={r.ooo} occupied={r.occupied} reason={r.reason} />
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-400">No rooms in inventory for this zone.</p>
          )}
        </section>
      ))}
    </div>
  );
}

export default function ZonesSection({
  properties,
  exportDate,
}: {
  properties: ZoneProperty[];
  exportDate: string; // YYYY-MM-DD, for export filenames
}) {
  const [activeCode, setActiveCode] = useState(() => {
    const r = properties.find((p) => p.configured && !p.error && p.total > 0);
    return r?.code ?? properties[0]?.code ?? "";
  });
  const current = properties.find((p) => p.code === activeCode);

  const rows: Row[] =
    current?.groups.flatMap((g) =>
      g.rooms.map((r) => ({
        zone: g.zone,
        room: r.name,
        type: r.type,
        status: r.ooo ? `Out of service — ${r.reason ?? "—"}` : r.occupied ? "Occupied" : "Vacant",
      })),
    ) ?? [];
  const matrix = buildMatrix(ROW_COLS, rows);

  return (
    <section id="zones" className="scroll-mt-20 lg:scroll-mt-6">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
          Rooms by building / zone
        </p>
        {current && current.configured && !current.error && current.total > 0 && (
          <ExportMenu
            filename={exportFilename("RoomZones", current.id, exportDate)}
            title={`Room zones — ${current.name}`}
            matrix={matrix}
          />
        )}
      </div>

      <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-slate-200 pb-px">
        {properties.map((p) => {
          const isActive = p.code === activeCode;
          const dot =
            p.configured && !p.error && p.total > 0
              ? "bg-emerald-500"
              : p.configured
                ? "bg-amber-500"
                : "bg-slate-300";
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
        {current && <PropertyZones p={current} />}
      </div>

      <p className="mt-3 text-xs text-slate-400">
        Rooms grouped into buildings/zones per <code>ROOM-ZONING.md</code>.
        Occupied = In-House reservation today; OOO = out of service today
        (Cloudbeds room blocks). Room numbers are inventory, not guest data. JW /
        DP / KW wing assignments are inferred from unlabelled floor maps — treat as
        provisional.
      </p>
    </section>
  );
}
