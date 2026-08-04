"use client";

// Rob §6: the weekly contractor schedule, one tab per weekday (Mon–Fri).
// Opens on today's tab (Eastern) — `defaultKey` is resolved server-side in
// lib/contractor-schedule.ts, because the browser's clock is the visitor's
// timezone and Rob's day is Eastern regardless of where he is.
import { useState } from "react";
import type { ContractorSchedule, ScheduleRow, Weekday } from "@/lib/contractor-schedule";
import ExportMenu from "@/components/ExportMenu";
import { thClass } from "@/components/ui";
import { buildMatrix, exportFilename, type ExportColumn } from "@/lib/export";

const COLS: ExportColumn<ScheduleRow>[] = [
  { header: "Contractor", value: (r) => r.contractor },
  { header: "Property", value: (r) => r.property },
  { header: "Task", value: (r) => r.task },
  { header: "Status", value: (r) => r.status },
  { header: "Latest WhatsApp Update", value: (r) => r.update },
];

/** Status → badge classes. Only token pairs already used elsewhere in the app. */
function statusClass(status: string): string {
  switch (status.toLowerCase()) {
    case "completed":
      return "bg-posbg text-pos";
    case "in progress":
      return "bg-accent text-white";
    case "delayed":
      return "bg-negbg text-neg";
    case "off":
      return "bg-surface3 text-txt3";
    default: // Pending, and anything new the picklist grows
      return "bg-surface2 text-txt2";
  }
}

/** "2026-08-03" → "Aug 3". Parsed as UTC so the label never shifts a day. */
function shortDate(ymd: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return "";
  return new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function StatusPill({ status }: { status: string }) {
  if (!status) return <span className="text-txt3">—</span>;
  return (
    <span className={"whitespace-nowrap rounded-[5px] px-[7px] py-0.5 text-[11px] font-semibold " + statusClass(status)}>
      {status}
    </span>
  );
}

export default function ContractorSchedule({ schedule }: { schedule: ContractorSchedule }) {
  const [activeKey, setActiveKey] = useState<Weekday>(schedule.defaultKey);
  const active = schedule.days.find((d) => d.key === activeKey) ?? schedule.days[0];

  // A day's completion, so Rob can read progress without scanning every row.
  const done = active.rows.filter((r) => r.status.toLowerCase() === "completed").length;
  const inProgress = active.rows.filter((r) => r.status.toLowerCase() === "in progress").length;
  const delayed = active.rows.filter((r) => r.status.toLowerCase() === "delayed").length;

  return (
    <div className="space-y-3">
      {/* Day tabs */}
      <div className="flex flex-wrap gap-1.5">
        {schedule.days.map((d) => {
          const on = d.key === activeKey;
          const isToday = d.key === schedule.todayWeekday;
          return (
            <button
              key={d.key}
              onClick={() => setActiveKey(d.key)}
              disabled={d.rows.length === 0}
              className={
                "rounded-[8px] border px-3 py-2 text-left transition-colors " +
                (on ? "border-accent bg-surface " : "border-line bg-surface hover:border-accent ") +
                (d.rows.length === 0 ? "cursor-not-allowed opacity-50 hover:border-line" : "")
              }
            >
              <span className="flex items-center gap-1.5">
                <span className="text-[12.5px] font-semibold text-txt">{d.key}</span>
                {isToday && (
                  <span className="rounded-[4px] bg-accent px-[5px] py-px text-[9.5px] font-semibold uppercase tracking-[.06em] text-white">
                    Today
                  </span>
                )}
              </span>
              <span className="mt-[3px] block text-[11px] text-txt3">
                {shortDate(d.date) || "no rows"}
                {d.rows.length > 0 && <> · {d.rows.length}</>}
              </span>
            </button>
          );
        })}
      </div>

      {/* Selected day summary + export */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-line bg-surface px-4 py-3 shadow-card">
        <span>
          <span className="text-2xl font-semibold text-txt">{active.rows.length}</span>
          <span className="ml-2 text-sm text-txt2">
            assignment{active.rows.length === 1 ? "" : "s"} · {active.key}
            {active.date && <> {shortDate(active.date)}</>}
            {active.rows.length > 0 && (
              <>
                {" "}({done} completed · {inProgress} in progress
                {delayed > 0 && <> · {delayed} delayed</>})
              </>
            )}
          </span>
        </span>
        {active.rows.length > 0 && (
          <ExportMenu
            filename={exportFilename("ContractorSchedule", null, active.date)}
            title={`Contractor schedule — ${active.key}`}
            matrix={buildMatrix(COLS, active.rows)}
          />
        )}
      </div>

      {active.rows.length === 0 ? (
        <p className="rounded-lg bg-surface2 px-4 py-3 text-sm text-txt3">
          No assignments for {active.key} in this sheet.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-[10px] border border-line bg-surface shadow-card">
          <table className="w-full min-w-[880px] border-collapse">
            <thead>
              <tr>
                <th className={thClass("left")}>Contractor</th>
                <th className={thClass("left")}>Property</th>
                <th className={thClass("left")}>Task</th>
                <th className={thClass("left")}>Status</th>
                <th className={thClass("left")}>Latest WhatsApp Update</th>
              </tr>
            </thead>
            <tbody>
              {active.rows.map((r, i) => (
                <tr key={`${r.contractor}-${i}`} className="border-t border-line align-top">
                  <td className="px-4 py-2.5 text-[12.5px] font-semibold text-txt">
                    {r.contractor || <span className="font-normal text-txt3">—</span>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-[12.5px] text-txt2">
                    {r.property || <span className="text-txt3">—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-[12.5px] text-txt2">
                    {r.task || <span className="text-txt3">—</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    <StatusPill status={r.status} />
                  </td>
                  <td className="px-4 py-2.5 text-[12.5px] text-txt2">
                    {r.update || <span className="text-txt3">no update yet</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(schedule.weekendRows > 0 || schedule.undatedRows > 0) && (
        <p className="text-[11.5px] text-txt3">
          Not shown in the weekday tabs:
          {schedule.weekendRows > 0 && <> {schedule.weekendRows} row(s) dated Saturday/Sunday</>}
          {schedule.weekendRows > 0 && schedule.undatedRows > 0 && " ·"}
          {schedule.undatedRows > 0 && <> {schedule.undatedRows} row(s) with no usable date</>}.
        </p>
      )}
    </div>
  );
}
