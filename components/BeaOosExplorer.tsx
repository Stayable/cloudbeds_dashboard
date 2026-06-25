"use client";

// Bea §1 explorer: property cards (like the base dashboard) → select a property
// to see reason-summary cards + that property's OOO room list. Selecting "All
// properties" instead shows a per-property accordion (less crowded than a single
// merged list). Room numbers are inventory, no PII.
import { useState } from "react";
import type { OooRoom } from "@/lib/cloudbeds";

export type BeaProperty = {
  code: string;
  name: string;
  county: string;
  configured: boolean;
  rooms: OooRoom[] | null; // null = not reporting (no key) or error
  error?: string | null;
};

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
    <table className="w-full min-w-[520px] text-sm">
      <thead>
        <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
          <th className="px-4 py-2 font-medium">Room</th>
          <th className="px-4 py-2 font-medium">Type</th>
          <th className="px-4 py-2 font-medium">Reason</th>
          <th className="px-4 py-2 font-medium">Until</th>
        </tr>
      </thead>
      <tbody>
        {rooms.map((r, i) => (
          <tr key={`${r.room}-${i}`} className="border-t border-slate-100">
            <td className="px-4 py-2 font-medium text-slate-900">{r.room}</td>
            <td className="px-4 py-2 text-slate-600">{r.roomType || "—"}</td>
            <td className="px-4 py-2 text-slate-600">{r.reason}</td>
            <td className="px-4 py-2 text-slate-500">{r.endDate}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function BeaOosExplorer({ properties }: { properties: BeaProperty[] }) {
  const allRooms = properties.flatMap((p) => p.rooms ?? []);
  const [activeKey, setActiveKey] = useState("ALL");

  const card = (key: string, label: string, sub: string, count: number | null, disabled: boolean) => {
    const active = key === activeKey;
    return (
      <button
        key={key}
        onClick={() => setActiveKey(key)}
        className={
          "rounded-xl border bg-white px-3 py-3 text-left shadow-sm transition " +
          (active ? "border-accent ring-1 ring-accent/30 " : "border-slate-200 hover:border-slate-300 ") +
          (disabled ? "opacity-60" : "")
        }
      >
        <p className="truncate text-xs text-slate-500">{label}</p>
        {count !== null ? (
          <>
            <p className="mt-1 text-2xl font-semibold text-slate-900">{count}</p>
            <p className="text-[11px] text-slate-400">{sub}</p>
          </>
        ) : (
          <p className="mt-1 text-sm font-medium text-slate-400">{sub}</p>
        )}
      </button>
    );
  };

  const selectedProp = activeKey === "ALL" ? null : properties.find((p) => p.code === activeKey) ?? null;

  return (
    <div className="space-y-5">
      {/* Property cards */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {card("ALL", "All properties", "rooms OOO", allRooms.length, false)}
        {properties.map((p) =>
          card(
            p.code,
            p.name,
            p.configured ? (p.error ? "error" : "rooms OOO") : "awaiting key",
            p.configured && !p.error ? (p.rooms?.length ?? 0) : null,
            !p.configured || !!p.error,
          ),
        )}
      </div>

      {activeKey === "ALL" ? (
        /* All properties → total + a compact summary table; click a row to drill in. */
        <div className="space-y-3">
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <span className="text-2xl font-semibold text-slate-900">{allRooms.length}</span>
            <span className="ml-2 text-sm text-slate-500">
              room{allRooms.length === 1 ? "" : "s"} out of service across all properties
            </span>
          </div>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full min-w-[480px] text-sm">
              <thead>
                <tr className="bg-ink text-left text-xs uppercase tracking-wide text-white/70">
                  <th className="px-4 py-3 font-medium">Property</th>
                  <th className="px-4 py-3 font-medium">OOO</th>
                  <th className="px-4 py-3 font-medium">Top reason</th>
                </tr>
              </thead>
              <tbody>
                {properties.map((p) => {
                  const count = p.rooms?.length ?? 0;
                  const drillable = p.configured && !p.error && count > 0;
                  const top = drillable ? groupReasons(p.rooms ?? [])[0] : null;
                  return (
                    <tr
                      key={p.code}
                      onClick={drillable ? () => setActiveKey(p.code) : undefined}
                      className={
                        "border-t border-slate-100 " +
                        (drillable ? "cursor-pointer hover:bg-slate-50" : "")
                      }
                    >
                      <td className="px-4 py-3 font-medium text-slate-900">
                        {p.name} <span className="text-xs font-normal text-slate-400">· {p.county}</span>
                      </td>
                      <td className="px-4 py-3">
                        {!p.configured || p.error ? (
                          <span className="text-slate-300">—</span>
                        ) : (
                          <span
                            className={
                              "rounded-full px-2 py-0.5 text-xs font-semibold " +
                              (count > 0 ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-500")
                            }
                          >
                            {count}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {!p.configured ? (
                          <span className="text-slate-400">awaiting key</span>
                        ) : p.error ? (
                          <span className="text-amber-700">error</span>
                        ) : count === 0 ? (
                          <span className="text-emerald-700">none</span>
                        ) : (
                          <span className="flex items-center justify-between gap-2">
                            <span>
                              {top?.label} <span className="text-slate-400">({top?.count})</span>
                            </span>
                            <span className="text-slate-300">›</span>
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
        /* Single property → reason-summary cards, then the room list. */
        <>
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
              {selectedProp?.name} · by reason
            </p>
            {!selectedProp?.configured ? (
              <p className="rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-400">Awaiting Cloudbeds key.</p>
            ) : selectedProp?.error ? (
              <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">{selectedProp.error}</p>
            ) : (selectedProp?.rooms?.length ?? 0) === 0 ? (
              <p className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">No rooms out of service.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {groupReasons(selectedProp?.rooms ?? []).map((g) => (
                  <div key={g.label} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                    <p className="text-2xl font-semibold text-slate-900">{g.count}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{g.label}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {selectedProp?.configured && !selectedProp.error && (selectedProp.rooms?.length ?? 0) > 0 && (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
              <RoomTable rooms={selectedProp.rooms ?? []} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
