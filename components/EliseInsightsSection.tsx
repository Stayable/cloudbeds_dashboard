"use client";

// Operations Dashboard §6–§8 — the EliseAI enrichment sections. One component
// renders all three (Leasing insights, Voice AI, AI performance) because they
// share the same shape: property selector → KPI tiles → ranked breakdowns →
// per-property table. Which tiles/breakdowns appear is chosen by `section`.
//
// All numbers arrive pre-aggregated from lib/elise-insights (server-side). This
// component owns only the property toggle. PII-free by construction — the
// Snowflake queries GROUP BY at the source, so no lead name, email, phone,
// transcript or call recording is ever in this payload.
import { useState } from "react";
import type { InsightView, Slice } from "@/lib/elise-insights";
import ExportMenu from "@/components/ExportMenu";
import { buildMatrix, exportFilename, type ExportColumn } from "@/lib/export";
import { propertyIdByCode } from "@/config/properties";

export type InsightSection = "leasing" | "voice" | "ai";

const intFmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });
const pct = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);
/** Seconds → m:ss. Null when there were no calls (never render a fake 0:00). */
const mmss = (s: number | null) =>
  s == null ? "—" : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

function Tile({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "good" | "bad";
}) {
  const valueColor = tone === "good" ? "text-emerald-700" : tone === "bad" ? "text-red-700" : "text-slate-900";
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-2 text-2xl font-semibold ${valueColor}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

/** Ranked horizontal bars, scaled to the largest slice. */
function Breakdown({ title, slices, note }: { title: string; slices: Slice[]; note?: string }) {
  if (slices.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">{title}</p>
        <p className="text-sm text-slate-400">No data in this window.</p>
      </div>
    );
  }
  const max = Math.max(...slices.map((s) => s.n), 1);
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">{title}</p>
      {note && <p className="mb-3 text-xs text-slate-400">{note}</p>}
      <div className={note ? "space-y-2.5" : "mt-3 space-y-2.5"}>
        {slices.map((s) => (
          <div key={s.label} className="flex items-center gap-3">
            <span className="w-36 shrink-0 truncate text-right text-xs font-medium text-slate-600" title={s.label}>
              {s.label}
            </span>
            <div className="relative h-6 flex-1 overflow-hidden rounded bg-slate-100">
              <div
                className="h-full rounded bg-accent/80"
                style={{ width: `${(s.n / max) * 100}%`, minWidth: s.n ? "2px" : 0 }}
              />
            </div>
            <span className="w-24 shrink-0 text-xs tabular-nums text-slate-500">
              <span className="font-semibold text-slate-900">{intFmt(s.n)}</span>
              <span className="text-slate-400"> · {Math.round(s.pct * 100)}%</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const EXPORT_COLS: Record<InsightSection, ExportColumn<InsightView>[]> = {
  leasing: [
    { header: "Property", value: (v) => v.label },
    { header: "Leads (sourced)", value: (v) => v.leadSources.reduce((s, x) => s + x.n, 0) },
    { header: "Top lead source", value: (v) => v.leadSources[0]?.label ?? "" },
    { header: "AI-booked %", value: (v) => (v.aiBookedPct == null ? "" : Math.round(v.aiBookedPct * 100)) },
    { header: "After-hours %", value: (v) => (v.afterHoursPct == null ? "" : Math.round(v.afterHoursPct * 100)) },
    { header: "Cancellations", value: (v) => v.cancelTotal },
    { header: "Top cancel reason", value: (v) => v.cancelReasons[0]?.label ?? "" },
  ],
  voice: [
    { header: "Property", value: (v) => v.label },
    { header: "Calls", value: (v) => v.voiceCalls },
    { header: "Avg length", value: (v) => mmss(v.voiceAvgSec) },
    { header: "After-hours %", value: (v) => (v.voiceAfterHoursPct == null ? "" : Math.round(v.voiceAfterHoursPct * 100)) },
    { header: "Transferred %", value: (v) => (v.voiceTransferPct == null ? "" : Math.round(v.voiceTransferPct * 100)) },
    { header: "Top transfer reason", value: (v) => v.voiceTransferReasons[0]?.label ?? "" },
  ],
  ai: [
    { header: "Property", value: (v) => v.label },
    { header: "Handoffs", value: (v) => v.handoffs },
    { header: "Top handoff reason", value: (v) => v.handoffReasons[0]?.label ?? "" },
    { header: "Tasks", value: (v) => v.tasks },
    { header: "Resolved %", value: (v) => (v.taskResolutionPct == null ? "" : Math.round(v.taskResolutionPct * 100)) },
  ],
};

const EXPORT_NAME: Record<InsightSection, string> = {
  leasing: "LeasingInsights",
  voice: "VoiceAI",
  ai: "AIPerformance",
};

const SOURCE_NOTE: Record<InsightSection, string> = {
  leasing:
    "Source: EliseAI Snowflake data share (PROSPECT_EVENTS), aggregated at the source and synced nightly to Neon. " +
    "Lead source is counted on new-prospect events; AI-booked % is measured over booked tours only (the flag is not set on other events).",
  voice:
    "Source: EliseAI Snowflake data share (VOICE_CALLS), aggregated at the source. Phone numbers, transcripts and " +
    "recordings are never selected. Transferred % counts only transfers that carry a reason, so treat it as a floor.",
  ai:
    "Source: EliseAI Snowflake data share (HANDOFFS, TASKS), aggregated at the source. Handoffs are AI→human " +
    "escalations; Resolved % is resolved tasks over tasks triggered in the window.",
};

export default function EliseInsightsSection({
  section,
  views,
  from,
  to,
  asOf,
}: {
  section: InsightSection;
  views: InsightView[];
  from: string;
  to: string;
  asOf: string; // YYYY-MM-DD, for export filenames
}) {
  const [activeKey, setActiveKey] = useState("ALL");

  // A single "ALL" view with no properties means the sync hasn't landed rows.
  if (views.length <= 1) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-center">
        <p className="text-sm font-semibold text-slate-700">Elise enrichment not synced yet</p>
        <p className="mx-auto mt-1 max-w-md text-xs text-slate-500">
          The nightly sync hasn&apos;t populated <code className="rounded bg-slate-200 px-1">elise_metric_daily</code>.
          It runs daily; you can also run{" "}
          <code className="rounded bg-slate-200 px-1">node scripts/elise-enrichment-sync.mjs</code> locally.
        </p>
      </div>
    );
  }

  const view = views.find((v) => v.key === activeKey) ?? views[0];
  const perProperty = views.filter((v) => v.key !== "ALL");
  const isAll = view.key === "ALL";
  const scopeId = isAll ? null : propertyIdByCode(view.key);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {views.map((v) => (
            <button
              key={v.key}
              onClick={() => setActiveKey(v.key)}
              className={
                "rounded-lg border px-3 py-1.5 text-sm font-medium transition " +
                (v.key === view.key
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300")
              }
            >
              {v.key === "ALL" ? "All properties" : v.label}
            </button>
          ))}
        </div>
        <ExportMenu
          filename={exportFilename(EXPORT_NAME[section], scopeId, asOf)}
          title={`${EXPORT_NAME[section]} — ${isAll ? "All properties" : view.label}`}
          matrix={buildMatrix(EXPORT_COLS[section], isAll ? perProperty : [view])}
        />
      </div>

      <p className="text-xs text-slate-500">
        Activity from <span className="font-medium text-slate-700">{from}</span> to{" "}
        <span className="font-medium text-slate-700">{to}</span> · windowed by event date.
      </p>

      {section === "leasing" && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile
              label="AI-booked tours"
              value={pct(view.aiBookedPct)}
              sub={`of ${intFmt(view.toursClassified)} booked tours`}
              tone={view.aiBookedPct != null && view.aiBookedPct >= 0.5 ? "good" : undefined}
            />
            <Tile label="After-hours contact" value={pct(view.afterHoursPct)} sub="of all prospect events" />
            <Tile label="Cancellations" value={intFmt(view.cancelTotal)} sub="reason recorded" tone={view.cancelTotal > 0 ? "bad" : undefined} />
            <Tile label="Top lead source" value={view.leadSources[0]?.label ?? "—"} sub={view.leadSources[0] ? `${pct(view.leadSources[0].pct)} of leads` : undefined} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Breakdown title={`Lead source · ${view.label}`} slices={view.leadSources} />
            <Breakdown title={`Contact channel · ${view.label}`} slices={view.channels} />
            <Breakdown title={`Cancellation reasons · ${view.label}`} slices={view.cancelReasons} />
            <Breakdown title={`Tour type · ${view.label}`} slices={view.tourTypes} />
          </div>
        </>
      )}

      {section === "voice" && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile label="Calls" value={intFmt(view.voiceCalls)} sub="inbound + outbound" />
            <Tile label="Avg length" value={mmss(view.voiceAvgSec)} sub="across all calls" />
            <Tile label="After hours" value={pct(view.voiceAfterHoursPct)} sub="outside office hours" />
            <Tile
              label="Transferred"
              value={pct(view.voiceTransferPct)}
              sub="reason-tagged (a floor)"
              tone={view.voiceTransferPct != null && view.voiceTransferPct > 0.25 ? "bad" : undefined}
            />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Breakdown
              title={`Who answered · ${view.label}`}
              slices={view.voiceAnswered}
              note="Voice AI vs the leasing office vs never answered."
            />
            <Breakdown title={`Transfer reasons · ${view.label}`} slices={view.voiceTransferReasons} />
          </div>
        </>
      )}

      {section === "ai" && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile label="Handoffs" value={intFmt(view.handoffs)} sub="AI → human escalations" />
            <Tile label="Top handoff reason" value={view.handoffReasons[0]?.label ?? "—"} sub={view.handoffReasons[0] ? `${pct(view.handoffReasons[0].pct)} of handoffs` : undefined} />
            <Tile label="Tasks triggered" value={intFmt(view.tasks)} sub="in window" />
            <Tile
              label="Resolved"
              value={pct(view.taskResolutionPct)}
              sub="of tasks triggered"
              tone={view.taskResolutionPct != null && view.taskResolutionPct >= 0.9 ? "good" : undefined}
            />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Breakdown title={`Handoff reasons · ${view.label}`} slices={view.handoffReasons} />
            <Breakdown title={`Task types · ${view.label}`} slices={view.taskTypes} />
          </div>
        </>
      )}

      {/* Per-property summary — always visible so the portfolio reads at a glance. */}
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                {EXPORT_COLS[section].map((c, i) => (
                  <th key={c.header} className={"px-4 py-2 font-medium " + (i === 0 ? "" : "text-right")}>
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {perProperty.map((v) => (
                <tr
                  key={v.key}
                  className={"border-b border-slate-100 last:border-0 " + (v.key === view.key ? "bg-accent/5" : "")}
                >
                  {EXPORT_COLS[section].map((c, i) => {
                    const raw = c.value(v);
                    const isNum = typeof raw === "number";
                    return (
                      <td
                        key={c.header}
                        className={
                          "px-4 py-2 " +
                          (i === 0 ? "text-slate-700" : "text-right text-slate-700 ") +
                          (isNum ? "tabular-nums" : "")
                        }
                      >
                        {raw === "" || raw == null ? "—" : isNum ? intFmt(raw) : String(raw)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p className="text-xs text-slate-400">{SOURCE_NOTE[section]}</p>
    </div>
  );
}
