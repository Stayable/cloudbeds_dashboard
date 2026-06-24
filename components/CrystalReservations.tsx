// Presentational §4 reservations view for /crystal. Server component. All values
// are PII-free aggregates (totals/counts/breakdowns) — no per-reservation rows.
import type { ReservationSummary } from "@/lib/reservations";

function money(n: number) {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}
function num(n: number) {
  return n.toLocaleString();
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-900">{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

function MixBars({ title, mix }: { title: string; mix: Record<string, number> }) {
  const entries = Object.entries(mix).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{title}</p>
      {total > 0 ? (
        <div className="mt-3 space-y-2">
          {entries.map(([k, v]) => (
            <div key={k} className="flex items-center gap-3">
              <span className="w-32 shrink-0 truncate text-sm text-slate-600" title={k}>{k}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-accent" style={{ width: `${(v / total) * 100}%` }} />
              </div>
              <span className="w-24 shrink-0 text-right text-sm tabular-nums text-slate-700">
                {num(v)} <span className="text-slate-400">({((v / total) * 100).toFixed(0)}%)</span>
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-sm text-slate-400">No data for the selected range.</p>
      )}
    </section>
  );
}

export default function CrystalReservations({
  summary,
  rangeLabel,
}: {
  summary: ReservationSummary;
  rangeLabel: string;
}) {
  if (summary.reporting === 0) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
        No reservation data returned for the selected range (no reporting properties).
      </div>
    );
  }

  const lease = summary.leaseMix;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
        <Tile label="Rooms on books" value={num(summary.rooms)} sub="active in range, excl. cancelled" />
        <Tile label="Room nights" value={num(summary.roomNights)} />
        <Tile label="Guests" value={num(summary.guests)} />
        <Tile label="Grand total" value={money(summary.grandTotal)} sub="full reservation value" />
        <Tile label="Paid" value={money(summary.paid)} />
        <Tile label="Balance due" value={money(summary.balanceDue)} />
      </div>

      <MixBars title="Reservation status mix (rooms)" mix={summary.statusMix} />

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Lease vs transient (rooms on books)</p>
        {lease.total > 0 ? (
          <div className="mt-3 grid grid-cols-3 gap-3 text-center">
            <div><p className="text-xs text-slate-500">Monthly lease</p><p className="text-lg font-semibold text-slate-900">{((lease.monthly / lease.total) * 100).toFixed(0)}%</p><p className="text-xs text-slate-400">{num(lease.monthly)} rooms</p></div>
            <div><p className="text-xs text-slate-500">Weekly lease</p><p className="text-lg font-semibold text-slate-900">{((lease.weekly / lease.total) * 100).toFixed(0)}%</p><p className="text-xs text-slate-400">{num(lease.weekly)} rooms</p></div>
            <div><p className="text-xs text-slate-500">Transient</p><p className="text-lg font-semibold text-slate-900">{((lease.transient / lease.total) * 100).toFixed(0)}%</p><p className="text-xs text-slate-400">{num(lease.transient)} rooms</p></div>
          </div>
        ) : (
          <p className="mt-2 text-sm text-slate-400">No data for the selected range.</p>
        )}
      </section>

      <MixBars title="Room type category (rooms)" mix={summary.roomTypeCategoryMix} />

      <p className="text-xs text-slate-400">
        Reservations whose stay overlaps {rangeLabel}. Currency, room-night, and guest
        totals exclude cancelled / no-show and reflect full reservation values (not
        prorated to the range). Aggregates only — no guest-level detail. {summary.reporting}{" "}
        propert{summary.reporting === 1 ? "y" : "ies"} reporting.
      </p>
    </div>
  );
}
