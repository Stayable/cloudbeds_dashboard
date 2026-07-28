"use client";

import { useState } from "react";
import ExportMenu from "@/components/ExportMenu";
import { Notice, SectionTitle } from "@/components/ui";
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
// Filled tiles, per the design's room grid: occupied reads as the darkest
// (navy), vacant as sky, out-of-service as the negative tone.
const CHIP_CLASS: Record<"ooo" | "occupied" | "vacant", string> = {
  occupied: "bg-navy text-white",
  vacant: "bg-sky text-[#04305C]",
  ooo: "bg-neg text-white",
};

function RoomChip({ name, ooo, occupied, reason }: { name: string; ooo: boolean; occupied: boolean; reason?: string }) {
  const s = statusOf({ ooo, occupied });
  const title = s === "ooo" ? `OOO — ${reason ?? "—"}` : s === "occupied" ? "Occupied" : "Vacant";
  return (
    <span
      title={title}
      className={
        "inline-flex h-[30px] min-w-[42px] items-center justify-center rounded-[5px] px-1.5 text-[11px] font-semibold " +
        CHIP_CLASS[s]
      }
    >
      {name}
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
    <div className="flex flex-wrap items-center gap-3.5">
      {items.map((it) => (
        <span key={it.s} className="inline-flex items-center gap-1.5 text-[11.5px] text-txt2">
          <span className={"h-[11px] w-[11px] rounded-[3px] " + CHIP_CLASS[it.s]} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

function PropertyZones({ p }: { p: ZoneProperty }) {
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
        <p className="font-semibold">Room inventory unavailable</p>
        <p className="mt-1">{p.error}</p>
      </Notice>
    );
  }
  if (!p.total) {
    return <Notice>No rooms returned for this property.</Notice>;
  }

  const buildings = p.groups.filter((g) => g.zone !== "Other").length;
  const occPct = p.total > 0 ? Math.round((p.occupiedTotal / p.total) * 100) : 0;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
        <p className="text-[12.5px] font-semibold text-txt">
          {p.total} rooms across {buildings} building{buildings === 1 ? "" : "s"} ·{" "}
          <span className="font-normal text-txt3">
            {p.occupiedTotal} occupied ({occPct}%)
            {p.oooTotal > 0 && ` · ${p.oooTotal} out of service`}
          </span>
        </p>
        <Legend />
      </div>

      {p.groups.map((g) => (
        <section key={g.zone} className="border-b border-line pb-4 last:border-b-0 last:pb-0">
          <div className="mb-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <h4 className="text-[12.5px] font-semibold text-txt">
              {g.zone}
              {g.zone === "Other" && (
                <span className="ml-2 text-[10px] font-normal uppercase tracking-[.07em] text-txt3">
                  no zone match
                </span>
              )}
            </h4>
            <span className="text-[11.5px] text-txt3">
              {g.rooms.length} room{g.rooms.length === 1 ? "" : "s"} · {g.occupiedCount} occupied
              {g.oooCount > 0 && ` · ${g.oooCount} OOO`}
            </span>
          </div>
          {g.rooms.length ? (
            <div className="flex flex-wrap gap-[5px]">
              {g.rooms.map((r) => (
                <RoomChip key={r.name} name={r.name} ooo={r.ooo} occupied={r.occupied} reason={r.reason} />
              ))}
            </div>
          ) : (
            <p className="text-[11.5px] text-txt3">No rooms in inventory for this zone.</p>
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
    <section id="zones" className="scroll-mt-24 lg:scroll-mt-28">
      <SectionTitle
        title="Rooms by building / zone"
        sub="Live room status · inventory only, never guest data"
      >
        {current && current.configured && !current.error && current.total > 0 && (
          <ExportMenu
            filename={exportFilename("RoomZones", current.id, exportDate)}
            title={`Room zones — ${current.name}`}
            matrix={matrix}
          />
        )}
      </SectionTitle>

      <div
        role="tablist"
        className="flex gap-0.5 overflow-x-auto rounded-t-[10px] border border-b-0 border-line bg-surface2 px-1 pt-1"
      >
        {properties.map((p) => {
          const isActive = p.code === activeCode;
          // Data state, not occupancy: has inventory / configured-but-silent / no key.
          const dot =
            p.configured && !p.error && p.total > 0
              ? "bg-pos"
              : p.configured
                ? "bg-warn"
                : "bg-lineStrong";
          return (
            <button
              key={p.code}
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveCode(p.code)}
              className={
                "flex shrink-0 items-center gap-2 rounded-t-[7px] px-3.5 py-2 text-[12.5px] font-semibold transition-colors " +
                (isActive ? "bg-surface text-txt shadow-seg" : "text-txt2 hover:text-txt")
              }
            >
              <span className={"h-1.5 w-1.5 rounded-full " + dot} />
              {p.name}
            </button>
          );
        })}
      </div>

      <div className="rounded-b-[10px] border border-t-0 border-line bg-surface p-4 shadow-card sm:p-5">
        {current && <PropertyZones p={current} />}
      </div>

      <p className="mt-3 text-[11.5px] leading-relaxed text-txt3">
        Rooms grouped into buildings/zones per <code>ROOM-ZONING.md</code>.
        Occupied = In-House reservation today; OOO = out of service today
        (Cloudbeds room blocks). Room numbers are inventory, not guest data. JW /
        DP / KW wing assignments are inferred from unlabelled floor maps — treat as
        provisional.
      </p>
    </section>
  );
}
