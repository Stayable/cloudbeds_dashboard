"use client";

// §4 reservations view for /crystal, with a property selector ("All properties"
// + one per reporting property). All values are PII-free aggregates
// (totals/counts/breakdowns) — no per-reservation rows.
import { useState } from "react";
import type { ReservationView } from "@/lib/reservations";
import ExportMenu from "@/components/ExportMenu";
import { buildMatrix, exportFilename, type ExportColumn } from "@/lib/export";
import { propertyIdByCode } from "@/config/properties";

function resCols(showFinancials: boolean): ExportColumn<ReservationView>[] {
  const base: ExportColumn<ReservationView>[] = [
    { header: "Property", value: (v) => v.label },
    { header: "Rooms on books", value: (v) => v.rooms },
    { header: "Room nights", value: (v) => v.roomNights },
    { header: "Guests", value: (v) => v.guests },
    { header: "Grand total", value: (v) => v.grandTotal },
    { header: "Paid", value: (v) => v.paid },
    { header: "Balance due", value: (v) => v.balanceDue },
  ];
  const fin: ExportColumn<ReservationView>[] = showFinancials
    ? [
        { header: "Fees", value: (v) => v.fees },
        { header: "Taxes", value: (v) => v.taxes },
        { header: "Channel commission", value: (v) => v.commission },
      ]
    : [];
  const lease: ExportColumn<ReservationView>[] = [
    { header: "Monthly lease (rooms)", value: (v) => v.leaseMix.monthly },
    { header: "Weekly lease (rooms)", value: (v) => v.leaseMix.weekly },
    { header: "Transient (rooms)", value: (v) => v.leaseMix.transient },
  ];
  return [...base, ...fin, ...lease];
}

function money(n: number) {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}
function num(n: number) {
  return n.toLocaleString();
}

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
              <span className="w-32 shrink-0 truncate text-sm text-txt2" title={k}>{k}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface2">
                <div className="h-full rounded-full bg-accent" style={{ width: `${(v / total) * 100}%` }} />
              </div>
              <span className="w-24 shrink-0 text-right text-sm tabular-nums text-txt">
                {num(v)} <span className="text-txt3">({((v / total) * 100).toFixed(0)}%)</span>
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-sm text-txt3">No data for the selected range.</p>
      )}
    </section>
  );
}

export default function CrystalReservations({
  views,
  rangeLabel,
  showFinancials = false,
  exportDate,
}: {
  views: ReservationView[];
  rangeLabel: string;
  showFinancials?: boolean;
  exportDate: string; // YYYY-MM-DD, for export filenames
}) {
  const [activeKey, setActiveKey] = useState(views[0]?.key ?? "ALL");

  if (views.length === 0) {
    return (
      <div className="rounded-[10px] border border-warn/40 bg-warnbg p-5 text-sm text-warn">
        No reservation data returned for the selected range (no reporting properties).
      </div>
    );
  }

  const view = views.find((v) => v.key === activeKey) ?? views[0];
  const lease = view.leaseMix;
  const isAll = view.key === "ALL";
  const exportRows = isAll ? views.filter((v) => v.key !== "ALL") : [view];

  return (
    <div className="space-y-5">
      {/* Property selector */}
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
          filename={exportFilename("Reservations", isAll ? null : propertyIdByCode(view.key), exportDate)}
          title={`Reservations — ${isAll ? "All properties" : view.label}`}
          matrix={buildMatrix(resCols(showFinancials), exportRows)}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
        <Tile label="Rooms on books" value={num(view.rooms)} sub="active in range, excl. cancelled" />
        <Tile label="Room nights" value={num(view.roomNights)} />
        <Tile label="Guests" value={num(view.guests)} />
        <Tile label="Grand total" value={money(view.grandTotal)} sub="full reservation value" />
        <Tile label="Paid" value={money(view.paid)} />
        <Tile label="Balance due" value={money(view.balanceDue)} />
        {showFinancials && (
          <>
            <Tile label="Fees" value={money(view.fees)} />
            <Tile label="Taxes" value={money(view.taxes)} />
            <Tile label="Channel commission" value={money(view.commission)} />
          </>
        )}
      </div>

      <MixBars title="Reservation status mix (rooms)" mix={view.statusMix} />

      <section className="rounded-[10px] border border-line bg-surface p-5 shadow-card sm:p-6">
        <p className="text-[10.5px] font-semibold uppercase tracking-[.08em] text-txt3">Lease vs transient (rooms on books)</p>
        {lease.total > 0 ? (
          <div className="mt-3 grid grid-cols-3 gap-3 text-center">
            <div><p className="text-xs text-txt2">Monthly lease</p><p className="text-lg font-semibold text-txt">{((lease.monthly / lease.total) * 100).toFixed(0)}%</p><p className="text-xs text-txt3">{num(lease.monthly)} rooms</p></div>
            <div><p className="text-xs text-txt2">Weekly lease</p><p className="text-lg font-semibold text-txt">{((lease.weekly / lease.total) * 100).toFixed(0)}%</p><p className="text-xs text-txt3">{num(lease.weekly)} rooms</p></div>
            <div><p className="text-xs text-txt2">Transient</p><p className="text-lg font-semibold text-txt">{((lease.transient / lease.total) * 100).toFixed(0)}%</p><p className="text-xs text-txt3">{num(lease.transient)} rooms</p></div>
          </div>
        ) : (
          <p className="mt-2 text-sm text-txt3">No data for the selected range.</p>
        )}
      </section>

      <MixBars title="Room type category (rooms)" mix={view.roomTypeCategoryMix} />

      <p className="text-xs text-txt3">
        {isAll ? "All reporting properties combined. " : `${view.label} only. `}
        Reservations whose stay overlaps {rangeLabel}. Currency, room-night, and guest
        totals exclude cancelled / no-show and reflect full reservation values (not
        prorated to the range). Aggregates only — no guest-level detail.
      </p>
    </div>
  );
}
