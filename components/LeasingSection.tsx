"use client";

// Operations Dashboard §2 — Leasing funnel. PII-free rollups synced nightly from
// the EliseAI Snowflake data share (PROSPECT_EVENTS → funnel, PROSPECTS → current
// pipeline). Property selector ("All properties" + one per property) per the
// dashboard convention. Counts only — no lead names/emails/phones ever leave
// Snowflake (aggregated at the source).
import { useState } from "react";
import type { LeasingView } from "@/lib/leasing";
import ExportMenu from "@/components/ExportMenu";
import { buildMatrix, exportFilename, type ExportColumn } from "@/lib/export";
import { propertyIdByCode } from "@/config/properties";

const intFmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });
const rate = (v: number | null) => (v == null ? "—" : `${v}%`);

const EXPORT_COLS: ExportColumn<LeasingView>[] = [
  { header: "Property", value: (v) => v.label },
  { header: "Leads", value: (v) => v.stages.find((s) => s.key === "prospect")?.n ?? 0 },
  { header: "Engaged", value: (v) => v.stages.find((s) => s.key === "prospect_engaged")?.n ?? 0 },
  { header: "Tours booked", value: (v) => v.stages.find((s) => s.key === "tour_booked")?.n ?? 0 },
  { header: "Tours attended", value: (v) => v.stages.find((s) => s.key === "tour_attended")?.n ?? 0 },
  { header: "Apps started", value: (v) => v.stages.find((s) => s.key === "application_started")?.n ?? 0 },
  { header: "Apps approved", value: (v) => v.stages.find((s) => s.key === "application_approved")?.n ?? 0 },
  { header: "Leased", value: (v) => v.stages.find((s) => s.key === "lease_completed")?.n ?? 0 },
  { header: "Cancelled", value: (v) => v.cancelled },
  { header: "Lead→Lease %", value: (v) => (v.leadToLease == null ? "" : v.leadToLease) },
];

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "bad" }) {
  const valueColor = tone === "good" ? "text-emerald-700" : tone === "bad" ? "text-red-700" : "text-slate-900";
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-2 text-2xl font-semibold ${valueColor}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

/** Horizontal funnel: each stage a bar scaled to the top-of-funnel (leads). */
function Funnel({ view }: { view: LeasingView }) {
  const leads = view.stages[0]?.n ?? 0;
  const max = Math.max(1, ...view.stages.map((s) => s.n));
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <p className="mb-4 text-xs font-medium uppercase tracking-wide text-slate-500">
        Funnel · {view.label}
      </p>
      <div className="space-y-2.5">
        {view.stages.map((s) => {
          const shareOfLeads = leads > 0 ? Math.round((s.n / leads) * 100) : null;
          return (
            <div key={s.key} className="flex items-center gap-3">
              <span className="w-28 shrink-0 text-right text-xs font-medium text-slate-600">{s.label}</span>
              <div className="relative h-6 flex-1 overflow-hidden rounded bg-slate-100">
                <div
                  className="h-full rounded bg-accent/80"
                  style={{ width: `${(s.n / max) * 100}%`, minWidth: s.n ? "2px" : 0 }}
                />
              </div>
              <span className="w-24 shrink-0 text-xs tabular-nums text-slate-500">
                <span className="font-semibold text-slate-900">{intFmt(s.n)}</span>
                {shareOfLeads != null && s.key !== "prospect" && <span className="text-slate-400"> · {shareOfLeads}%</span>}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function LeasingSection({
  configured,
  views,
  from,
  to,
  asOf,
}: {
  configured: boolean;
  views: LeasingView[];
  from: string;
  to: string;
  asOf: string; // YYYY-MM-DD, for export filenames
}) {
  const [activeKey, setActiveKey] = useState("ALL");

  if (!configured || views.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-center">
        <p className="text-sm font-semibold text-slate-700">Leasing data not synced yet</p>
        <p className="mx-auto mt-1 max-w-md text-xs text-slate-500">
          The nightly EliseAI → Neon sync hasn&apos;t populated the funnel. It runs daily; once{" "}
          <code className="rounded bg-slate-200 px-1">/api/cron/elise-sync</code> has run (or{" "}
          <code className="rounded bg-slate-200 px-1">node scripts/elise-sync.mjs</code> locally), the
          funnel appears here.
        </p>
      </div>
    );
  }

  const view = views.find((v) => v.key === activeKey) ?? views[0];
  const perProperty = views.filter((v) => v.key !== "ALL");
  const isAll = view.key === "ALL";
  const scopeId = isAll ? null : propertyIdByCode(view.key);

  const leads = view.stages.find((s) => s.key === "prospect")?.n ?? 0;
  const toursBooked = view.stages.find((s) => s.key === "tour_booked")?.n ?? 0;
  const leased = view.stages.find((s) => s.key === "lease_completed")?.n ?? 0;

  const stageN = (v: LeasingView, key: string) => v.stages.find((s) => s.key === key)?.n ?? 0;

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
          filename={exportFilename("LeasingFunnel", scopeId, asOf)}
          title={`Leasing funnel — ${isAll ? "All properties" : view.label}`}
          matrix={buildMatrix(EXPORT_COLS, isAll ? perProperty : [view])}
        />
      </div>

      <p className="text-xs text-slate-500">
        Activity from <span className="font-medium text-slate-700">{from}</span> to{" "}
        <span className="font-medium text-slate-700">{to}</span> · windowed by event date.
      </p>

      {/* Conversion + volume tiles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Tile label="Leads" value={intFmt(leads)} sub="new prospects" />
        <Tile label="Leased" value={intFmt(leased)} sub="signed in window" tone={leased > 0 ? "good" : undefined} />
        <Tile label="Lead → Tour" value={rate(view.leadToTour)} sub="booked a tour" />
        <Tile label="Tour → Lease" value={rate(view.tourToLease)} sub="attended → leased" />
        <Tile label="Cancelled" value={intFmt(view.cancelled)} sub="prospects canceled" tone={view.cancelled > 0 ? "bad" : undefined} />
      </div>

      {/* Funnel bars */}
      <Funnel view={view} />

      {/* Current pipeline snapshot (not windowed) */}
      {view.pipeline.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-500">
            Current pipeline · {view.label} <span className="text-slate-400">(live status, all-time)</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {view.pipeline.map((p) => (
              <span
                key={p.status}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600"
              >
                {p.status}
                <span className="font-semibold text-slate-900 tabular-nums">{intFmt(p.n)}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Per-property summary — always visible so the portfolio reads at a glance. */}
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2 font-medium">Property</th>
                <th className="px-4 py-2 text-right font-medium">Leads</th>
                <th className="px-4 py-2 text-right font-medium">Tours</th>
                <th className="px-4 py-2 text-right font-medium">Apps</th>
                <th className="px-4 py-2 text-right font-medium">Leased</th>
                <th className="px-4 py-2 text-right font-medium">Lead→Lease</th>
              </tr>
            </thead>
            <tbody>
              {perProperty.map((v) => (
                <tr
                  key={v.key}
                  className={"border-b border-slate-100 last:border-0 " + (v.key === view.key ? "bg-accent/5" : "")}
                >
                  <td className="px-4 py-2 text-slate-700">{v.label}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-700">{intFmt(stageN(v, "prospect"))}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-700">{intFmt(stageN(v, "tour_booked"))}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-700">{intFmt(stageN(v, "application_started"))}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-700">{intFmt(stageN(v, "lease_completed"))}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-700">{rate(v.leadToLease)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p className="text-xs text-slate-400">
        Source: EliseAI Snowflake data share (PROSPECT_EVENTS for the funnel, PROSPECTS for the pipeline
        snapshot), synced nightly to Neon. Aggregate counts only — no lead names, emails, phones, or
        conversation content ever leave Snowflake. Funnel is windowed by event date; the pipeline
        snapshot is the current all-time status.
      </p>
    </div>
  );
}
