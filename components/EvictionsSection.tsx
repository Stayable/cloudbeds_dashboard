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
    <div className="rounded-[10px] border border-line bg-surface px-4 py-3.5 shadow-card">
      <p className="text-[10.5px] font-semibold uppercase tracking-[.08em] text-txt3">{label}</p>
      <p className="mt-2.5 text-[27px] font-semibold leading-none tracking-[-.03em] text-txt">{value}</p>
      {sub && <p className="mt-[7px] text-[11.5px] text-txt3">{sub}</p>}
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
      <div className="rounded-[10px] border border-warn/40 bg-warnbg p-5 text-sm text-warn">
        Evictions data isn&apos;t connected yet. Set the{" "}
        <code className="rounded bg-warnbg px-1">SMARTSHEET_API_TOKEN</code> environment
        variable (Smartsheet → Personal Settings → API Access) so the server can read the
        Evictions Metrics sheet.
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-[10px] border border-neg/40 bg-negbg p-5 text-sm text-neg">
        Couldn&apos;t load evictions data from Smartsheet: {error}
      </div>
    );
  }

  if (views.length === 0) {
    return (
      <div className="rounded-[10px] border border-warn/40 bg-warnbg p-5 text-sm text-warn">
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
                    : "border-line bg-surface text-txt2 hover:border-lineStrong")
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
      <section className="overflow-hidden rounded-[10px] border border-line bg-surface shadow-card">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-lineStrong bg-surface2 text-left text-[10px] font-semibold uppercase tracking-[.07em] text-txt3">
                <th className="px-4 py-2.5 font-semibold">Property</th>
                <th className="px-4 py-2.5 text-right font-semibold">Open</th>
                <th className="px-4 py-2.5 text-right font-semibold">Closed</th>
                <th className="px-4 py-2.5 text-right font-semibold">Total</th>
                <th className="px-4 py-2.5 text-right font-semibold">Days to file</th>
                <th className="px-4 py-2.5 text-right font-semibold">Days to resolve</th>
              </tr>
            </thead>
            <tbody>
              {perProperty.map((v) => {
                const active = v.key === view.key;
                return (
                  <tr
                    key={v.key}
                    className={
                      "border-b border-line last:border-0 " +
                      (active ? "bg-accent/5" : "")
                    }
                  >
                    <td className="px-4 py-2 text-txt">{v.label}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-txt">{intFmt(v.open)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-txt">{intFmt(v.closed)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-txt">{intFmt(v.total)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-txt">
                      {v.avgDaysToFile == null ? "—" : v.avgDaysToFile.toFixed(1)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-txt">
                      {v.avgDays == null ? "—" : v.avgDays.toFixed(1)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <p className="text-xs text-txt3">
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
