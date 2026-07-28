"use client";

// Bea §1 explorer: property cards (like the base dashboard) → select a property
// to see reason-summary cards + that property's blocked-room list. Selecting
// "All properties" instead shows a per-property accordion (less crowded than a
// single merged list). Room numbers are inventory, no PII.
//
// Breakdown (Kyle's decision, ooo-breakdown-brief.md): `rooms` now carries
// EVERY Cloudbeds room block (out_of_service AND other types, e.g.
// blocked_dates), each tagged `category`. Ops (Bea) counts all of them; the
// dashboard used to show out_of_service only and undercounted vs her tally
// (e.g. JN 20 vs 35). Every count below is Out-of-Order / Other blocks / Total
// via `summarizeOoo` so the two numbers always reconcile.
import { useState } from "react";
import { summarizeOoo, type OooRoom } from "@/lib/cloudbeds";
import ExportMenu from "@/components/ExportMenu";
import { thClass } from "@/components/ui";
import { buildMatrix, exportFilename, type ExportColumn } from "@/lib/export";

export type BeaProperty = {
  id: string; // business property ID, for export filenames (§7)
  code: string;
  name: string;
  county: string;
  configured: boolean;
  rooms: OooRoom[] | null; // null = not reporting (no key) or error
  error?: string | null;
};

// Columns for a single property's blocked rooms.
const ROOM_COLS: ExportColumn<OooRoom>[] = [
  { header: "Room", value: (r) => r.room || "Unknown" },
  { header: "Type", value: (r) => r.roomType },
  { header: "Type code", value: (r) => r.roomTypeCode },
  { header: "Category", value: (r) => (r.category === "ooo" ? "Out-of-Order" : "Other") },
  { header: "Reason", value: (r) => r.reason },
  { header: "Until", value: (r) => r.endDate },
];
// All-properties view prepends the property name.
type OooRowAll = OooRoom & { property: string };
const ROOM_COLS_ALL: ExportColumn<OooRowAll>[] = [
  { header: "Property", value: (r) => r.property },
  ...ROOM_COLS.map((c) => ({ header: c.header, value: (r: OooRowAll) => c.value(r) })),
];

// Normalize a reason so "NEEDS RENO", "Needs Reno", "needs  reno." all collapse.
function normReason(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

type ReasonGroup = { label: string; count: number };

function groupReasons(rooms: OooRoom[]): ReasonGroup[] {
  const groups = new Map<string, { count: number; labels: Map<string, number> }>();
  for (const r of rooms) {
    const key = normReason(r.reason) || "unspecified";
    const g = groups.get(key) ?? { count: 0, labels: new Map() };
    g.count += 1;
    g.labels.set(r.reason, (g.labels.get(r.reason) ?? 0) + 1);
    groups.set(key, g);
  }
  return [...groups.values()]
    .map((g) => ({ label: [...g.labels.entries()].sort((a, b) => b[1] - a[1])[0][0], count: g.count }))
    .sort((a, b) => b.count - a.count);
}

function RoomTable({ rooms }: { rooms: OooRoom[] }) {
  return (
    <table className="w-full min-w-[520px] border-collapse">
      <thead>
        <tr>
          <th className={thClass("left")}>Room</th>
          <th className={thClass("left")}>Type</th>
          <th className={thClass("left")}>Reason</th>
          <th className={thClass("left")}>Until</th>
        </tr>
      </thead>
      <tbody>
        {rooms.map((r, i) => (
          <tr key={`${r.room}-${i}`} className="border-t border-line">
            <td className="px-4 py-2.5 text-[12.5px] font-semibold text-txt">
              {r.room || <span className="italic text-txt3">Unknown</span>}
            </td>
            <td className="px-4 py-2.5 text-[12.5px] text-txt2">
              {r.roomType || "—"}
              {r.roomTypeCode && <span className="ml-1 text-[11px] text-txt3">({r.roomTypeCode})</span>}
            </td>
            <td className="px-4 py-2.5 text-[12.5px] text-txt2">{r.reason}</td>
            <td className="px-4 py-2.5 text-[12.5px] text-txt2">{r.endDate}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** One category's reason-summary cards + room list. Renders a quiet "none"
 *  message instead of an empty grid/table when the category has no rooms, so
 *  a property that's all Out-of-Order (or all Other) doesn't show a blank
 *  section for the other category. */
function CategoryGroup({ title, rooms }: { title: string; rooms: OooRoom[] }) {
  return (
    <div className="space-y-2">
      <p className="text-[10.5px] font-semibold uppercase tracking-[.08em] text-txt3">
        {title} · {rooms.length}
      </p>
      {rooms.length === 0 ? (
        <p className="rounded-lg bg-surface2 px-4 py-2 text-xs text-txt3">None.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {groupReasons(rooms).map((g) => (
              <div key={g.label} className="rounded-[10px] border border-line bg-surface px-4 py-3.5 shadow-card">
                <p className="text-[27px] font-semibold leading-none tracking-[-.03em] text-txt">
                  {g.count}
                </p>
                <p className="mt-[7px] text-[11.5px] text-txt3">{g.label}</p>
              </div>
            ))}
          </div>
          <div className="overflow-x-auto rounded-[10px] border border-line bg-surface shadow-card">
            <RoomTable rooms={rooms} />
          </div>
        </>
      )}
    </div>
  );
}

export default function BeaOosExplorer({ properties, asOf }: { properties: BeaProperty[]; asOf: string }) {
  const allRooms = properties.flatMap((p) => p.rooms ?? []);
  const allCounts = summarizeOoo(allRooms);
  const allRowsForExport: OooRowAll[] = properties.flatMap((p) =>
    (p.rooms ?? []).map((r) => ({ ...r, property: p.name })),
  );
  const [activeKey, setActiveKey] = useState("ALL");

  const card = (key: string, label: string, rooms: OooRoom[] | null, statusSub: string, disabled: boolean) => {
    const active = key === activeKey;
    const counts = rooms ? summarizeOoo(rooms) : null;
    return (
      <button
        key={key}
        onClick={() => setActiveKey(key)}
        className={
          "rounded-[10px] border bg-surface px-4 py-3.5 text-left shadow-card transition-colors " +
          (active ? "border-accent " : "border-line hover:border-accent ") +
          (disabled ? "opacity-60" : "")
        }
      >
        <p className="truncate text-[13px] font-semibold tracking-[-.01em] text-txt">{label}</p>
        {counts !== null ? (
          <>
            <p className="mt-2.5 text-[27px] font-semibold leading-none tracking-[-.03em] text-txt">
              {counts.total}
            </p>
            <p className="mt-[7px] text-[11.5px] text-txt3">
              {counts.ooo} out-of-order · {counts.other} other blocks
            </p>
          </>
        ) : (
          <p className="mt-2.5 text-[12.5px] font-semibold text-txt3">{statusSub}</p>
        )}
      </button>
    );
  };

  const selectedProp = activeKey === "ALL" ? null : properties.find((p) => p.code === activeKey) ?? null;
  const selectedRooms = selectedProp?.rooms ?? [];
  const selectedCounts = summarizeOoo(selectedRooms);

  // All-properties summary table, sorted by Total desc (Kyle's decision) —
  // properties with no data (awaiting key / error) sort last.
  const sortedProperties = [...properties].sort((a, b) => {
    const ta = a.configured && !a.error ? (a.rooms?.length ?? 0) : -1;
    const tb = b.configured && !b.error ? (b.rooms?.length ?? 0) : -1;
    return tb - ta;
  });

  return (
    <div className="space-y-5">
      {/* Property cards */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {card("ALL", "All properties", allRooms, "", false)}
        {properties.map((p) =>
          card(
            p.code,
            p.name,
            p.configured && !p.error ? p.rooms ?? [] : null,
            p.configured ? (p.error ? "error" : "") : "awaiting key",
            !p.configured || !!p.error,
          ),
        )}
      </div>

      {activeKey === "ALL" ? (
        /* All properties → total + a compact summary table; click a row to drill in. */
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 rounded-[10px] border border-line bg-surface px-4 py-3 shadow-card">
            <span>
              <span className="text-2xl font-semibold text-txt">{allCounts.total}</span>
              <span className="ml-2 text-sm text-txt2">
                room{allCounts.total === 1 ? "" : "s"} blocked across all properties
                {allCounts.total > 0 && (
                  <> ({allCounts.ooo} out-of-order · {allCounts.other} other blocks)</>
                )}
              </span>
            </span>
            <ExportMenu
              filename={exportFilename("OutOfService", null, asOf)}
              title="Out of service — All properties"
              matrix={buildMatrix(ROOM_COLS_ALL, allRowsForExport)}
            />
          </div>
          <div className="overflow-x-auto rounded-[10px] border border-line bg-surface shadow-card">
            <table className="w-full min-w-[560px] border-collapse">
              <thead>
                <tr>
                  <th className={thClass("left")}>Property</th>
                  <th className={thClass("left")}>Out-of-Order</th>
                  <th className={thClass("left")}>Other blocks</th>
                  <th className={thClass("left")}>Total</th>
                  <th className={thClass("left")}>Top reason</th>
                </tr>
              </thead>
              <tbody>
                {sortedProperties.map((p) => {
                  const counts = p.configured && !p.error ? summarizeOoo(p.rooms ?? []) : null;
                  const drillable = counts !== null && counts.total > 0;
                  const top = drillable ? groupReasons(p.rooms ?? [])[0] : null;
                  return (
                    <tr
                      key={p.code}
                      onClick={drillable ? () => setActiveKey(p.code) : undefined}
                      className={
                        "border-t border-line " +
                        (drillable ? "cursor-pointer hover:bg-surface2" : "")
                      }
                    >
                      <td className="px-4 py-2.5 text-[12.5px] font-semibold text-txt">
                        {p.name} <span className="text-xs font-normal text-txt3">· {p.county}</span>
                      </td>
                      <td className="px-4 py-2.5 text-[12.5px] text-txt">{counts === null ? <span className="text-txt3">—</span> : counts.ooo}</td>
                      <td className="px-4 py-2.5 text-[12.5px] text-txt">{counts === null ? <span className="text-txt3">—</span> : counts.other}</td>
                      <td className="px-4 py-2.5">
                        {counts === null ? (
                          <span className="text-txt3">—</span>
                        ) : (
                          <span
                            className={
                              "rounded-[5px] px-[7px] py-0.5 text-[11px] font-semibold " +
                              (counts.total > 0 ? "bg-warnbg text-warn" : "bg-surface2 text-txt2")
                            }
                          >
                            {counts.total}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-txt2">
                        {!p.configured ? (
                          <span className="text-txt3">awaiting key</span>
                        ) : p.error ? (
                          <span className="text-warn">error</span>
                        ) : counts !== null && counts.total === 0 ? (
                          <span className="text-pos">none</span>
                        ) : (
                          <span className="flex items-center justify-between gap-2">
                            <span>
                              {top?.label} <span className="text-txt3">({top?.count})</span>
                            </span>
                            <span className="text-txt3">›</span>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* Single property → Total + breakdown header, then Out-of-Order / Other-blocks groups. */
        <>
          <div className="flex items-center justify-between gap-3 rounded-[10px] border border-line bg-surface px-4 py-3 shadow-card">
            <span>
              <span className="text-2xl font-semibold text-txt">{selectedCounts.total}</span>
              <span className="ml-2 text-sm text-txt2">
                {selectedProp?.name} · total blocked
                {selectedCounts.total > 0 && (
                  <> ({selectedCounts.ooo} out-of-order · {selectedCounts.other} other blocks)</>
                )}
              </span>
            </span>
            {selectedProp?.configured && !selectedProp.error && selectedCounts.total > 0 && (
              <ExportMenu
                filename={exportFilename("OutOfService", selectedProp?.id ?? null, asOf)}
                title={`Out of service — ${selectedProp?.name}`}
                matrix={buildMatrix(ROOM_COLS, selectedRooms)}
              />
            )}
          </div>

          {!selectedProp?.configured ? (
            <p className="rounded-lg bg-surface2 px-4 py-3 text-sm text-txt3">Awaiting Cloudbeds key.</p>
          ) : selectedProp?.error ? (
            <p className="rounded-lg bg-warnbg px-4 py-3 text-sm text-warn">{selectedProp.error}</p>
          ) : selectedCounts.total === 0 ? (
            <p className="rounded-lg bg-posbg px-4 py-3 text-sm text-pos">No rooms blocked.</p>
          ) : (
            <>
              {selectedRooms.some((r) => !r.room) && (
                <p className="rounded-lg bg-warnbg px-4 py-2 text-xs text-warn">
                  Some room numbers couldn&apos;t be resolved (shown as “Unknown”). This property&apos;s
                  Cloudbeds key needs the <span className="font-semibold">Room</span> scope.
                </p>
              )}
              <CategoryGroup title="Out-of-Order" rooms={selectedRooms.filter((r) => r.category === "ooo")} />
              <CategoryGroup title="Other blocks" rooms={selectedRooms.filter((r) => r.category === "other")} />
            </>
          )}
        </>
      )}
    </div>
  );
}
