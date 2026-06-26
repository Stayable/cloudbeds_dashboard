"use client";

// Evictions section. Counts only, sourced from the pre-aggregated Smartsheet
// "Evictions Metrics" sheet — no tenant names or case detail. Property selector
// ("All properties" + one per property), per the dashboard convention.
import { useState } from "react";
import type { EvictionsView } from "@/lib/evictions";
import ExportMenu from "@/components/ExportMenu";
import { buildMatrix, exportFilename, type ExportColumn } from "@/lib/export";

function intFmt(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

const EVICTION_COLS: ExportColumn<EvictionsView>[] = [
  { header: "Property", value: (v) => v.label },
  { header: "Open", value: (v) => v.open },
  { header: "Closed", value: (v) => v.closed },
  { header: "Total", value: (v) => v.total },
  { header: "Avg days to file", value: (v) => (v.avgDaysToFile == null ? "" : v.avgDaysToFile.toFixed(1)) },
  { header: "Avg days to resolve", value: (v) => (v.avgDays == null ? "" : v.avgDays.toFixed(1)) },
];

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-900">{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

export default function EvictionsSection({
  configured,
  error,
  views,
  asOf,
}: {
  configured: boolean;
  error: string | null;
  views: EvictionsView[];
  asOf: string; // YYYY-MM-DD, for export filenames
}) {
  const [activeKey, setActiveKey] = useState("ALL");

  if (!configured) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
        Evictions data isn&apos;t connected yet. Set the{" "}
        <code className="rounded bg-amber-100 px-1">SMARTSHEET_API_TOKEN</code> environment
        variable (Smartsheet → Personal Settings → API Access) so the server can read the
        Evictions Metrics sheet.
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-900">
        Couldn&apos;t load evictions data from Smartsheet: {error}
      </div>
    );
  }

  if (views.length === 0) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
        No evictions metrics returned from the sheet.
      </div>
    );
  }

  const view = views.find((v) => v.key === activeKey) ?? views[0];
  const perProperty = views.filter((v) => v.key !== "ALL");
  const isAll = view.key === "ALL";
  const exportRows = isAll ? perProperty : [view];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {views.map((v) => {
            const active = v.key === view.key;
            return (
              <button
                key={v.key}
                onClick={() => setActiveKey(v.key)}
                className={
                  "rounded-lg border px-3 py-1.5 text-sm font-medium transition " +
                  (active
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-300")
                }
              >
                {v.key === "ALL" ? "All properties" : v.label}
              </button>
            );
          })}
        </div>
        <ExportMenu
          filename={exportFilename("Evictions", isAll ? null : view.key, asOf)}
          title={`Evictions — ${isAll ? "All properties" : view.label}`}
          matrix={buildMatrix(EVICTION_COLS, exportRows)}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5">
        <Tile label="Open" value={intFmt(view.open)} sub="all non-closed cases" />
        <Tile label="Closed" value={intFmt(view.closed)} />
        <Tile label="Total" value={intFmt(view.total)} sub="open + closed, all-time" />
        <Tile
          label="Avg days to file"
          value={view.avgDaysToFile == null ? "—" : view.avgDaysToFile.toFixed(1)}
          sub="notice → complaint · all-time"
        />
        <Tile
          label="Avg days to resolve"
          value={view.avgDays == null ? "—" : view.avgDays.toFixed(1)}
          sub="filing → completion · MTD"
        />
      </div>

      {/* Per-property breakdown — always visible so the portfolio reads at a glance. */}
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2 font-medium">Property</th>
                <th className="px-4 py-2 text-right font-medium">Open</th>
                <th className="px-4 py-2 text-right font-medium">Closed</th>
                <th className="px-4 py-2 text-right font-medium">Total</th>
                <th className="px-4 py-2 text-right font-medium">Days to file</th>
                <th className="px-4 py-2 text-right font-medium">Days to resolve</th>
              </tr>
            </thead>
            <tbody>
              {perProperty.map((v) => {
                const active = v.key === view.key;
                return (
                  <tr
                    key={v.key}
                    className={
                      "border-b border-slate-100 last:border-0 " +
                      (active ? "bg-accent/5" : "")
                    }
                  >
                    <td className="px-4 py-2 text-slate-700">{v.label}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-700">{intFmt(v.open)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-700">{intFmt(v.closed)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-700">{intFmt(v.total)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-700">
                      {v.avgDaysToFile == null ? "—" : v.avgDaysToFile.toFixed(1)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-700">
                      {v.avgDays == null ? "—" : v.avgDays.toFixed(1)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <p className="text-xs text-slate-400">
        Source: Smartsheet &ldquo;Evictions Metrics&rdquo; (pre-aggregated rollup of the Closed
        and Master Database case sheets). Counts only — no tenant names or case-level detail.
        &ldquo;Open&rdquo; = all non-closed cases; &ldquo;Total&rdquo; = open + closed all-time.
        Days to resolve (complaint filed → completion, MTD) comes straight from the sheet;
        days to file (notice posted → complaint filed, all-time) is computed by the dashboard
        from the Closed sheet&apos;s dates only.
      </p>
    </div>
  );
}
