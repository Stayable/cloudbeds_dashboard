"use client";

// Bea §1 explorer: property cards (like the base dashboard) → select a property
// (or "All") → reason-summary cards on top (rooms grouped by same/near-same
// reason) → the OOO room list at the bottom. Room numbers are inventory, no PII.
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
  // Label each group with its most common original spelling.
  return [...groups.values()]
    .map((g) => ({
      label: [...g.labels.entries()].sort((a, b) => b[1] - a[1])[0][0],
      count: g.count,
    }))
    .sort((a, b) => b.count - a.count);
}

export default function BeaOosExplorer({ properties }: { properties: BeaProperty[] }) {
  const reporting = properties.filter((p) => p.rooms !== null);
  const allRooms = reporting.flatMap((p) => p.rooms ?? []);

  // Views: "All properties" first, then each property (configured + not).
  const [activeKey, setActiveKey] = useState("ALL");

  const selected =
    activeKey === "ALL"
      ? { name: "All properties", rooms: allRooms, configured: true, error: null as string | null }
      : (() => {
          const p = properties.find((x) => x.code === activeKey);
          return p
            ? { name: p.name, rooms: p.rooms ?? [], configured: p.configured, error: p.error ?? null }
            : { name: "", rooms: [], configured: false, error: null };
        })();

  const reasons = groupReasons(selected.rooms);

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
          <p className="mt-1 text-2xl font-semibold text-slate-900">{count}</p>
        ) : (
          <p className="mt-1 text-sm font-medium text-slate-400">{sub}</p>
        )}
        {count !== null && <p className="text-[11px] text-slate-400">{sub}</p>}
      </button>
    );
  };

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

      {/* Reason summary cards (top) */}
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
          {selected.name} · by reason
        </p>
        {selected.error ? (
          <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">{selected.error}</p>
        ) : !selected.configured ? (
          <p className="rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-400">Awaiting Cloudbeds key.</p>
        ) : reasons.length === 0 ? (
          <p className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">No rooms out of service.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {reasons.map((g) => (
              <div key={g.label} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                <p className="text-2xl font-semibold text-slate-900">{g.count}</p>
                <p className="mt-0.5 text-xs text-slate-500">{g.label}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Room list (bottom) */}
      {selected.configured && !selected.error && selected.rooms.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="bg-ink text-left text-xs uppercase tracking-wide text-white/70">
                <th className="px-4 py-3 font-medium">Room</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Reason</th>
                <th className="px-4 py-3 font-medium">Until</th>
              </tr>
            </thead>
            <tbody>
              {selected.rooms.map((r, i) => (
                <tr key={`${r.room}-${i}`} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-medium text-slate-900">{r.room}</td>
                  <td className="px-4 py-3 text-slate-600">{r.roomType || "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{r.reason}</td>
                  <td className="px-4 py-3 text-slate-500">{r.endDate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
