"use client";

import ExecFeedback from "@/components/ExecFeedback";

export type ExecProperty = {
  code: string;
  name: string;
  county: string;
  id: string;
  occupancy: number | null; // range avg %, capacity-adjusted
  adr: number | null;
  revpar: number | null;
  lease: { monthly: number; weekly: number; transient: number; total: number } | null;
  excludeDefault: boolean;
};

export type ExecData = {
  portfolioOcc: number | null;
  wow: number | null; // delta in percentage points vs prior equal window
  mom: number | null; // delta vs prior month
  portfolioAdr: number | null;
  portfolioRevpar: number | null;
  portfolioLease: { monthly: number; weekly: number; transient: number; total: number };
  rangeLabel: string;
  leaseAsOf: string;
  properties: ExecProperty[];
};

function pct(n: number | null) {
  return n === null ? "—" : `${n.toFixed(1)}%`;
}
function money(n: number | null) {
  return n === null ? "—" : `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function Delta({ value, label }: { value: number | null; label: string }) {
  if (value === null) return <span className="text-xs text-slate-400">{label} —</span>;
  const up = value >= 0;
  return (
    <span className={"text-xs font-medium " + (up ? "text-emerald-600" : "text-red-600")}>
      {label} {up ? "▲" : "▼"} {Math.abs(value).toFixed(1)} pts
    </span>
  );
}
function leasePctParts(l: { monthly: number; weekly: number; transient: number; total: number } | null) {
  if (!l || l.total <= 0) return null;
  const f = (n: number) => (n / l.total) * 100;
  return { monthly: f(l.monthly), weekly: f(l.weekly), transient: f(l.transient) };
}

export default function ExecView({ data }: { data: ExecData }) {
  const ranked = [...data.properties].sort((a, b) => (b.occupancy ?? -1) - (a.occupancy ?? -1));
  const lp = leasePctParts(data.portfolioLease);

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Occupancy headline + trend */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Portfolio Occupancy</p>
          <span className="text-xs text-slate-400">{data.rangeLabel}</span>
        </div>
        <span className="mt-1 block text-5xl font-semibold text-slate-900 sm:text-6xl">{pct(data.portfolioOcc)}</span>
        <div className="mt-2 flex gap-4">
          <Delta value={data.wow} label="WoW" />
          <Delta value={data.mom} label="MoM" />
        </div>
      </section>

      {/* ADR / RevPAR portfolio KPIs */}
      <section className="grid grid-cols-2 gap-3 sm:gap-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">ADR (portfolio)</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900 sm:text-3xl">{money(data.portfolioAdr)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">RevPAR (portfolio)</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900 sm:text-3xl">{money(data.portfolioRevpar)}</p>
        </div>
      </section>

      {/* Leaderboard */}
      <section>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
          Property leaderboard — occupancy, best to worst
        </p>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="bg-ink text-left text-xs uppercase tracking-wide text-white/70">
                <th className="px-4 py-3 font-medium">#</th>
                <th className="px-4 py-3 font-medium">Property</th>
                <th className="px-4 py-3 font-medium">Occupancy</th>
                <th className="px-4 py-3 font-medium">ADR</th>
                <th className="px-4 py-3 font-medium">RevPAR</th>
                <th className="px-4 py-3 font-medium">Flags</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((p, i) => {
                const low = p.occupancy !== null && p.occupancy < 5;
                return (
                  <tr key={p.code} className="border-t border-slate-100">
                    <td className="px-4 py-3 text-slate-400">{i + 1}</td>
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {p.name} <span className="text-xs text-slate-400">· {p.county}</span>
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-900">{pct(p.occupancy)}</td>
                    <td className="px-4 py-3 text-slate-700">{money(p.adr)}</td>
                    <td className="px-4 py-3 text-slate-700">{money(p.revpar)}</td>
                    <td className="px-4 py-3">
                      {low && (
                        <span className="rounded bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
                          near-zero occ
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Lease vs Transient */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Lease vs Transient (in-house)</p>
          <span className="text-xs text-slate-400">as of {data.leaseAsOf}</span>
        </div>
        {lp ? (
          <>
            <div className="mt-3 flex h-3 w-full overflow-hidden rounded-full bg-slate-100">
              <div className="h-full bg-accent" style={{ width: `${lp.monthly}%` }} title={`Monthly lease ${lp.monthly.toFixed(1)}%`} />
              <div className="h-full bg-accent/60" style={{ width: `${lp.weekly}%` }} title={`Weekly lease ${lp.weekly.toFixed(1)}%`} />
              <div className="h-full bg-slate-300" style={{ width: `${lp.transient}%` }} title={`Transient ${lp.transient.toFixed(1)}%`} />
            </div>
            <div className="mt-3 grid grid-cols-3 gap-3 text-center">
              <div><p className="text-xs text-slate-500">Monthly lease</p><p className="text-lg font-semibold text-slate-900">{lp.monthly.toFixed(1)}%</p></div>
              <div><p className="text-xs text-slate-500">Weekly lease</p><p className="text-lg font-semibold text-slate-900">{lp.weekly.toFixed(1)}%</p></div>
              <div><p className="text-xs text-slate-500">Transient</p><p className="text-lg font-semibold text-slate-900">{lp.transient.toFixed(1)}%</p></div>
            </div>
          </>
        ) : (
          <p className="mt-2 text-sm text-slate-400">No in-house rooms for the as-of date.</p>
        )}
      </section>

      <ExecFeedback />
    </div>
  );
}
