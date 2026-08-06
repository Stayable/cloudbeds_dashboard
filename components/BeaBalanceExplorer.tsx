"use client";

// Bea §3: outstanding balances on in-house reservations, per property.
// Same shape as BeaOosExplorer — property cards → a property's rows, or "All
// properties" for a summary table you can click through.
//
// CONTAINS GUEST NAMES (authorised 08/04/26 — see lib/balance-due.ts header and
// CLAUDE.md §5 rule 2). `/bea` is PIN-gated and must stay that way.
//
// There is deliberately no due-date column: rent accrues nightly and no DI
// dataset carries a due date. lib/balance-due.ts explains the measurement.
import { useState } from "react";
import type { BalanceRow, BalanceSummary } from "@/lib/balance-due";
import ExportMenu from "@/components/ExportMenu";
import { thClass } from "@/components/ui";
import { buildMatrix, exportFilename, type ExportColumn } from "@/lib/export";

export type BeaBalanceProperty = {
  id: string; // business property ID, for export filenames (§7)
  code: string;
  name: string;
  county: string;
  configured: boolean;
  summary: BalanceSummary | null; // null = not reporting (no key) or error
  error?: string | null;
};

function money(n: number) {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function planLabel(r: BalanceRow) {
  return r.leaseClass === "lease-monthly" ? "Monthly lease" : r.leaseClass === "lease-weekly" ? "Weekly lease" : "Transient";
}

const DEPARTURE_LABEL: Record<BalanceRow["departure"], string> = {
  overdue: "Checkout passed",
  today: "Leaving today",
  future: "",
  unknown: "",
};

const ROW_COLS: ExportColumn<BalanceRow>[] = [
  { header: "Guest", value: (r) => r.guest },
  { header: "Room", value: (r) => r.rooms },
  { header: "Balance due", value: (r) => r.balanceDue.toFixed(2) },
  { header: "Type", value: (r) => planLabel(r) },
  { header: "Rate plan", value: (r) => r.ratePlan },
  { header: "Check-in", value: (r) => r.checkin },
  { header: "Checkout", value: (r) => r.checkout },
  { header: "Flag", value: (r) => DEPARTURE_LABEL[r.departure] },
  { header: "Reservation", value: (r) => r.reservationNumber },
];
type RowAll = BalanceRow & { property: string };
const ROW_COLS_ALL: ExportColumn<RowAll>[] = [
  { header: "Property", value: (r) => r.property },
  ...ROW_COLS.map((c) => ({ header: c.header, value: (r: RowAll) => c.value(r) })),
];

function BalanceTable({ rows }: { rows: BalanceRow[] }) {
  return (
    <table className="w-full min-w-[720px] border-collapse">
      <thead>
        <tr>
          <th className={thClass("left")}>Guest</th>
          <th className={thClass("left")}>Room</th>
          <th className={thClass("right")}>Balance due</th>
          <th className={thClass("left")}>Type</th>
          <th className={thClass("left")}>Check-in</th>
          <th className={thClass("left")}>Checkout</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.reservationNumber} className="border-t border-line">
            <td className="px-4 py-2.5 text-[12.5px] font-semibold text-txt">{r.guest}</td>
            <td className="px-4 py-2.5 text-[12.5px] text-txt2">{r.rooms}</td>
            <td className="px-4 py-2.5 text-right text-[12.5px] font-semibold tabular-nums text-txt">
              {money(r.balanceDue)}
            </td>
            <td className="px-4 py-2.5 text-[12.5px]">
              <span
                className={
                  "rounded-[5px] px-[7px] py-0.5 text-[11px] font-semibold " +
                  (r.leaseClass === "transient" ? "bg-surface2 text-txt2" : "bg-warnbg text-warn")
                }
              >
                {planLabel(r)}
              </span>
            </td>
            <td className="px-4 py-2.5 text-[12.5px] text-txt2">{r.checkin || "—"}</td>
            <td className="px-4 py-2.5 text-[12.5px] text-txt2">
              {r.checkout || "—"}
              {/* An In-House reservation whose checkout has passed is an
                  overstay / eviction — the highest-urgency row on the table, and
                  the case the old date-window filter used to hide entirely. */}
              {r.departure !== "future" && r.departure !== "unknown" && (
                <span
                  className={
                    "ml-2 rounded-[5px] px-[7px] py-0.5 text-[11px] font-semibold " +
                    (r.departure === "overdue" ? "bg-warnbg text-warn" : "bg-surface2 text-txt2")
                  }
                >
                  {DEPARTURE_LABEL[r.departure]}
                </span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Credits + in-house context, shown under a table so the headline total is not
 *  mistaken for net AR. */
function Footnote({ s }: { s: BalanceSummary }) {
  return (
    <p className="text-[11.5px] text-txt3">
      {s.inHouseCount} in-house reservation{s.inHouseCount === 1 ? "" : "s"} checked ·{" "}
      {s.rows.length} carrying a balance
      {s.overdueCount > 0 && (
        <>
          {" "}· {s.overdueCount} still in-house past checkout ({money(s.overdueTotal)})
        </>
      )}
      {s.creditCount > 0 && (
        <>
          {" "}· {s.creditCount} in credit ({money(s.creditTotal)}), excluded from the total
        </>
      )}
    </p>
  );
}

export default function BeaBalanceExplorer({
  properties,
  asOf,
}: {
  properties: BeaBalanceProperty[];
  asOf: string;
}) {
  const [activeKey, setActiveKey] = useState("ALL");

  const reporting = properties.filter((p) => p.configured && !p.error && p.summary);
  const allTotal = reporting.reduce((sum, p) => sum + (p.summary?.total ?? 0), 0);
  const allRowCount = reporting.reduce((n, p) => n + (p.summary?.rows.length ?? 0), 0);
  const allRowsForExport: RowAll[] = reporting.flatMap((p) =>
    (p.summary?.rows ?? []).map((r) => ({ ...r, property: p.name })),
  );

  const card = (key: string, label: string, summary: BalanceSummary | null, statusSub: string, disabled: boolean) => {
    const active = key === activeKey;
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
        {summary !== null ? (
          <>
            <p className="mt-2.5 text-[21px] font-semibold leading-none tracking-[-.03em] text-txt">
              {money(summary.total)}
            </p>
            <p className="mt-[7px] text-[11.5px] text-txt3">
              {summary.rows.length} reservation{summary.rows.length === 1 ? "" : "s"}
            </p>
          </>
        ) : (
          <p className="mt-2.5 text-[12.5px] font-semibold text-txt3">{statusSub}</p>
        )}
      </button>
    );
  };

  // Aggregate card for "All properties" — sum across reporting properties only.
  const allSummary: BalanceSummary = {
    rows: allRowsForExport,
    total: allTotal,
    leaseCount: reporting.reduce((n, p) => n + (p.summary?.leaseCount ?? 0), 0),
    transientCount: reporting.reduce((n, p) => n + (p.summary?.transientCount ?? 0), 0),
    creditCount: reporting.reduce((n, p) => n + (p.summary?.creditCount ?? 0), 0),
    creditTotal: reporting.reduce((n, p) => n + (p.summary?.creditTotal ?? 0), 0),
    inHouseCount: reporting.reduce((n, p) => n + (p.summary?.inHouseCount ?? 0), 0),
    overdueCount: reporting.reduce((n, p) => n + (p.summary?.overdueCount ?? 0), 0),
    overdueTotal: reporting.reduce((n, p) => n + (p.summary?.overdueTotal ?? 0), 0),
  };

  const selectedProp = activeKey === "ALL" ? null : properties.find((p) => p.code === activeKey) ?? null;
  const selected = selectedProp?.summary ?? null;

  const sortedProperties = [...properties].sort((a, b) => {
    const ta = a.configured && !a.error && a.summary ? a.summary.total : -1;
    const tb = b.configured && !b.error && b.summary ? b.summary.total : -1;
    return tb - ta;
  });

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {card("ALL", "All properties", reporting.length ? allSummary : null, "no data", false)}
        {properties.map((p) =>
          card(
            p.code,
            p.name,
            p.configured && !p.error ? p.summary : null,
            p.configured ? (p.error ? "error" : "no data") : "awaiting key",
            !p.configured || !!p.error,
          ),
        )}
      </div>

      {activeKey === "ALL" ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 rounded-[10px] border border-line bg-surface px-4 py-3 shadow-card">
            <span>
              <span className="text-2xl font-semibold tabular-nums text-txt">{money(allTotal)}</span>
              <span className="ml-2 text-sm text-txt2">
                outstanding across {allRowCount} reservation{allRowCount === 1 ? "" : "s"}
                {allSummary.leaseCount + allSummary.transientCount > 0 && (
                  <> ({allSummary.leaseCount} lease · {allSummary.transientCount} transient)</>
                )}
              </span>
            </span>
            {allRowCount > 0 && (
              <ExportMenu
                filename={exportFilename("BalanceDue", null, asOf)}
                title="Balance due — All properties"
                matrix={buildMatrix(ROW_COLS_ALL, allRowsForExport)}
              />
            )}
          </div>
          <div className="overflow-x-auto rounded-[10px] border border-line bg-surface shadow-card">
            <table className="w-full min-w-[560px] border-collapse">
              <thead>
                <tr>
                  <th className={thClass("left")}>Property</th>
                  <th className={thClass("right")}>Balance due</th>
                  <th className={thClass("left")}>Reservations</th>
                  <th className={thClass("left")}>Lease / transient</th>
                  <th className={thClass("left")}>Largest</th>
                </tr>
              </thead>
              <tbody>
                {sortedProperties.map((p) => {
                  const s = p.configured && !p.error ? p.summary : null;
                  const drillable = !!s && s.rows.length > 0;
                  const top = drillable ? s!.rows[0] : null;
                  return (
                    <tr
                      key={p.code}
                      onClick={drillable ? () => setActiveKey(p.code) : undefined}
                      className={"border-t border-line " + (drillable ? "cursor-pointer hover:bg-surface2" : "")}
                    >
                      <td className="px-4 py-2.5 text-[12.5px] font-semibold text-txt">
                        {p.name} <span className="text-xs font-normal text-txt3">· {p.county}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right text-[12.5px] font-semibold tabular-nums text-txt">
                        {s ? money(s.total) : <span className="font-normal text-txt3">—</span>}
                      </td>
                      <td className="px-4 py-2.5 text-[12.5px] text-txt">
                        {s ? s.rows.length : <span className="text-txt3">—</span>}
                      </td>
                      <td className="px-4 py-2.5 text-[12.5px] text-txt2">
                        {s ? `${s.leaseCount} / ${s.transientCount}` : <span className="text-txt3">—</span>}
                      </td>
                      <td className="px-4 py-3 text-[12.5px] text-txt2">
                        {!p.configured ? (
                          <span className="text-txt3">awaiting key</span>
                        ) : p.error ? (
                          <span className="text-warn">error</span>
                        ) : !drillable ? (
                          <span className="text-pos">none</span>
                        ) : (
                          <span className="flex items-center justify-between gap-2">
                            <span>
                              {money(top!.balanceDue)}{" "}
                              <span className="text-txt3">· room {top!.rooms}</span>
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
          {reporting.length > 0 && <Footnote s={allSummary} />}
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3 rounded-[10px] border border-line bg-surface px-4 py-3 shadow-card">
            <span>
              <span className="text-2xl font-semibold tabular-nums text-txt">{money(selected?.total ?? 0)}</span>
              <span className="ml-2 text-sm text-txt2">
                {selectedProp?.name} · outstanding
                {selected && selected.rows.length > 0 && (
                  <> ({selected.leaseCount} lease · {selected.transientCount} transient)</>
                )}
              </span>
            </span>
            {selected && selected.rows.length > 0 && (
              <ExportMenu
                filename={exportFilename("BalanceDue", selectedProp?.id ?? null, asOf)}
                title={`Balance due — ${selectedProp?.name}`}
                matrix={buildMatrix(ROW_COLS, selected.rows)}
              />
            )}
          </div>

          {!selectedProp?.configured ? (
            <p className="rounded-lg bg-surface2 px-4 py-3 text-sm text-txt3">Awaiting Cloudbeds key.</p>
          ) : selectedProp?.error ? (
            <p className="rounded-lg bg-warnbg px-4 py-3 text-sm text-warn">{selectedProp.error}</p>
          ) : !selected || selected.rows.length === 0 ? (
            <p className="rounded-lg bg-posbg px-4 py-3 text-sm text-pos">
              No in-house reservation is carrying a balance.
            </p>
          ) : (
            <div className="space-y-2">
              <div className="overflow-x-auto rounded-[10px] border border-line bg-surface shadow-card">
                <BalanceTable rows={selected.rows} />
              </div>
              <Footnote s={selected} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
