"use client";

// §5 Finance view (Rob). PII-free aggregates from DI dataset 1. Property selector
// ("All properties" + one per reporting property), per the dashboard convention.
import { useState } from "react";
import type { FinanceView } from "@/lib/finance";
import ExportMenu from "@/components/ExportMenu";
import { buildMatrix, exportFilename, type ExportColumn } from "@/lib/export";
import { propertyIdByCode } from "@/config/properties";

function money(n: number) {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

const FINANCE_COLS: ExportColumn<FinanceView>[] = [
  { header: "Property", value: (v) => v.label },
  { header: "Charges (debits)", value: (v) => v.charges },
  { header: "Payments & credits", value: (v) => v.paymentsCredits },
  { header: "Net transaction amount", value: (v) => v.net },
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

function MixBars({ title, mix }: { title: string; mix: Record<string, number> }) {
  const entries = Object.entries(mix).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  return (
    <section className="rounded-[10px] border border-line bg-surface p-5 shadow-card sm:p-6">
      <p className="text-[10.5px] font-semibold uppercase tracking-[.08em] text-txt3">{title}</p>
      {total > 0 ? (
        <div className="mt-3 space-y-2">
          {entries.map(([k, v]) => (
            <div key={k} className="flex items-center gap-3">
              <span className="w-40 shrink-0 truncate text-sm text-txt2" title={k}>{k}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface2">
                <div className="h-full rounded-full bg-accent" style={{ width: `${(v / total) * 100}%` }} />
              </div>
              <span className="w-28 shrink-0 text-right text-sm tabular-nums text-txt">{money(v)}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-sm text-txt3">No data for the selected range.</p>
      )}
    </section>
  );
}

export default function FinanceSection({
  views,
  rangeLabel,
  exportDate,
}: {
  views: FinanceView[];
  rangeLabel: string;
  exportDate: string; // YYYY-MM-DD, for export filenames
}) {
  const [activeKey, setActiveKey] = useState(views[0]?.key ?? "ALL");

  if (views.length === 0) {
    return (
      <div className="rounded-[10px] border border-warn/40 bg-warnbg p-5 text-sm text-warn">
        No finance data returned for the selected range (no reporting properties).
      </div>
    );
  }

  const view = views.find((v) => v.key === activeKey) ?? views[0];
  const isAll = view.key === "ALL";
  const exportRows = isAll ? views.filter((v) => v.key !== "ALL") : [view];

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
          filename={exportFilename("Finance", isAll ? null : propertyIdByCode(view.key), exportDate)}
          title={`Finance — ${isAll ? "All properties" : view.label}`}
          matrix={buildMatrix(FINANCE_COLS, exportRows)}
        />
      </div>

      {view.capped && (
        <div className="rounded-lg border border-warn/40 bg-warnbg px-4 py-3 text-sm text-warn">
          A single day hit the Cloudbeds 1,500-transaction cap, so these totals may
          undercount. Narrow the date range for an exact figure.
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
        <Tile label="Charges (debits)" value={money(view.charges)} sub="service date in range" />
        <Tile label="Payments & credits" value={money(view.paymentsCredits)} />
        <Tile label="Net transaction amount" value={money(view.net)} />
      </div>

      <MixBars title="Charges by transaction type" mix={view.typeMix} />
      <MixBars title="Payments by method" mix={view.paymentMethodMix} />

      <p className="text-xs text-txt3">
        Cloudbeds Finances dataset, service date within {rangeLabel}. Aggregates only —
        no guest-level or folio-level rows. Charges = debits; payments &amp; credits =
        credit transactions; net = transaction amount. Fee type, tax type, GL account, and
        add-on breakdowns are available in the same dataset on request.
      </p>
    </div>
  );
}
