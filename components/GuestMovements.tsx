"use client";

// Home §5: arrivals & departures per guest, all properties, today + tomorrow.
//
// MAY CONTAIN GUEST NAMES. `showGuests` is NOT the security boundary — the
// server already decided, and when it decided no, the names were never fetched
// and every `guest` here is "". This flag only chooses whether to render a
// column that would otherwise be empty. Do not "improve" this by fetching names
// always and hiding them client-side: props cross into the RSC payload and are
// readable in the browser. See lib/guest-movements.ts and lib/guest-pii.ts.
//
// Per the per-user-dashboard convention: every section carries a per-property /
// All toggle. Direction and day are the other two axes, both segmented controls.

import { useState } from "react";
import ExportMenu from "@/components/ExportMenu";
import { Notice, SegTrack, TableScroll, segButton, thClass } from "@/components/ui";
import { buildMatrix, exportFilename, type ExportColumn } from "@/lib/export";
import type { MovementDirection, MovementRow, MovementState } from "@/lib/guest-movements";

export type MovementProperty = {
  id: string; // business property ID, for export filenames (§7)
  code: string;
  name: string;
  county: string;
  configured: boolean;
  arrivals: Record<string, MovementRow[]> | null;
  departures: Record<string, MovementRow[]> | null;
  error?: string | null;
};

// State chips. `due-out` and `expected` are the two that carry an action, so
// they get the accent; `departed`/`arrived` are settled facts and read quiet.
const STATE_LABEL: Record<MovementState, string> = {
  expected: "Expected",
  arrived: "Arrived",
  "due-out": "Due out",
  departed: "Departed",
  cancelled: "Cancelled",
  other: "—",
};
const STATE_CLASS: Record<MovementState, string> = {
  expected: "bg-sky text-[#04305C]",
  arrived: "bg-navy text-white",
  "due-out": "bg-sky text-[#04305C]",
  departed: "bg-surface3 text-txt3",
  cancelled: "bg-neg text-white",
  other: "bg-surface3 text-txt3",
};

function StateChip({ state, status }: { state: MovementState; status: string }) {
  // `other` shows the raw status so an unmapped Cloudbeds state is legible
  // rather than rendering as a dash and looking like missing data.
  const label = state === "other" && status ? status : STATE_LABEL[state];
  return (
    <span
      className={
        "inline-flex h-[22px] items-center whitespace-nowrap rounded-[4px] px-2 text-[10.5px] font-semibold " +
        STATE_CLASS[state]
      }
    >
      {label}
    </span>
  );
}

function cols(showGuests: boolean): ExportColumn<MovementRow>[] {
  const base: ExportColumn<MovementRow>[] = [
    { header: "Room", value: (r) => r.rooms },
    { header: "Check-in", value: (r) => r.checkin },
    { header: "Checkout", value: (r) => r.checkout },
    { header: "Nights", value: (r) => (r.nights === null ? "" : r.nights) },
    { header: "Status", value: (r) => r.status },
    { header: "Reservation", value: (r) => r.reservationNumber },
  ];
  if (!showGuests) return base;
  return [
    { header: "Guest", value: (r) => r.guest },
    { header: "Guests", value: (r) => (r.guests === null ? "" : r.guests) },
    // Free text staff typed after the `*` marker — "Active Eviction" and the
    // like. Exported because it is the kind of thing someone needs in a
    // spreadsheet, not just on screen.
    { header: "Note", value: (r) => r.note },
    ...base,
  ];
}

type RowAll = MovementRow & { property: string; propertyId: string };

function colsAll(showGuests: boolean): ExportColumn<RowAll>[] {
  return [
    { header: "Property", value: (r) => r.property },
    // Business property ID per CLAUDE.md §3/§7 — a row lifted out of the export
    // must name its property unambiguously.
    { header: "Property ID", value: (r) => r.propertyId },
    ...cols(showGuests).map((c) => ({ header: c.header, value: (r: RowAll) => c.value(r) })),
  ];
}

function Table({
  rows,
  showGuests,
  showProperty,
}: {
  rows: RowAll[];
  showGuests: boolean;
  showProperty: boolean;
}) {
  return (
    <TableScroll>
      <table className="w-full border-collapse text-[12.5px]">
        <thead>
          <tr>
            {showProperty && <th className={thClass("left")}>Property</th>}
            {showGuests && <th className={thClass("left")}>Guest</th>}
            <th className={thClass("left")}>Room</th>
            <th className={thClass("left")}>Check-in</th>
            <th className={thClass("left")}>Checkout</th>
            <th className={thClass("right")}>Nights</th>
            {showGuests && <th className={thClass("right")}>Guests</th>}
            <th className={thClass("left")}>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.propertyId}-${r.reservationNumber}`} className="border-b border-line">
              {showProperty && <td className="px-4 py-2.5 text-txt2">{r.property}</td>}
              {showGuests && (
                <td className="px-4 py-2.5 font-semibold text-txt">
                  {r.guest || <span className="text-txt3">—</span>}
                  {r.note && (
                    // Staff-entered free text. Rendered as a warning because the
                    // one value seen live was "Active Eviction", which nobody
                    // should have to hover to find.
                    <span className="ml-2 inline-flex h-[19px] items-center rounded-[4px] bg-neg px-1.5 text-[10px] font-semibold text-white">
                      {r.note}
                    </span>
                  )}
                </td>
              )}
              <td className="px-4 py-2.5 tabular-nums text-txt">{r.rooms || "—"}</td>
              <td className="px-4 py-2.5 tabular-nums text-txt2">{r.checkin || "—"}</td>
              <td className="px-4 py-2.5 tabular-nums text-txt2">{r.checkout || "—"}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-txt2">
                {r.nights === null ? "—" : r.nights}
              </td>
              {showGuests && (
                <td className="px-4 py-2.5 text-right tabular-nums text-txt2">
                  {r.guests === null ? "—" : r.guests}
                </td>
              )}
              <td className="px-4 py-2.5">
                <StateChip state={r.state} status={r.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroll>
  );
}

export default function GuestMovements({
  properties,
  days,
  dayLabels,
  showGuests,
}: {
  properties: MovementProperty[];
  /** ISO dates, in the order the toggle should offer them. */
  days: string[];
  /** Human label per day, same order — "Today", "Tomorrow". */
  dayLabels: string[];
  showGuests: boolean;
}) {
  const [direction, setDirection] = useState<MovementDirection>("arrivals");
  const [day, setDay] = useState(days[0]);
  const [code, setCode] = useState<string>("ALL");

  const reporting = properties.filter((p) => p.configured);
  const selected = code === "ALL" ? reporting : reporting.filter((p) => p.code === code);

  // Flatten the selection into export/render rows, tagging each with its
  // property so an "All properties" row is attributable.
  const rows: RowAll[] = selected.flatMap((p) => {
    const byDay = direction === "arrivals" ? p.arrivals : p.departures;
    if (!byDay) return []; // null = the read FAILED; surfaced separately below
    return (byDay[day] ?? []).map((r) => ({ ...r, property: p.name, propertyId: p.id }));
  });

  // A property whose read failed is called out rather than silently contributing
  // nothing — zero movements and a broken read must not look identical.
  const failed = selected.filter(
    (p) => (direction === "arrivals" ? p.arrivals : p.departures) === null,
  );

  const showProperty = code === "ALL";
  const filenameId = code === "ALL" ? null : (selected[0]?.id ?? null);
  const matrix = showProperty
    ? buildMatrix(colsAll(showGuests), rows)
    : buildMatrix(cols(showGuests), rows);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SegTrack>
          <button
            className={segButton(direction === "arrivals")}
            onClick={() => setDirection("arrivals")}
          >
            Arrivals
          </button>
          <button
            className={segButton(direction === "departures")}
            onClick={() => setDirection("departures")}
          >
            Departures
          </button>
        </SegTrack>

        <SegTrack>
          {days.map((d, i) => (
            <button key={d} className={segButton(day === d)} onClick={() => setDay(d)}>
              {dayLabels[i] ?? d}
            </button>
          ))}
        </SegTrack>

        <SegTrack className="max-w-full overflow-x-auto">
          <button className={segButton(code === "ALL")} onClick={() => setCode("ALL")}>
            All
          </button>
          {reporting.map((p) => (
            <button
              key={p.code}
              className={segButton(code === p.code)}
              onClick={() => setCode(p.code)}
              title={`${p.name} · ${p.id} · ${p.county}`}
            >
              {p.code}
            </button>
          ))}
        </SegTrack>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-txt3">
            {rows.length} {direction === "arrivals" ? "arriving" : "departing"} · {day}
          </span>
          <ExportMenu
            filename={exportFilename(
              direction === "arrivals" ? "Arrivals" : "Departures",
              filenameId,
              day,
            )}
            matrix={matrix}
            title={`${direction === "arrivals" ? "Arrivals" : "Departures"} · ${day}`}
            disabled={rows.length === 0}
          />
        </div>
      </div>

      {failed.length > 0 && (
        <div className="mb-3 rounded-[8px] border border-neg/30 bg-negbg px-3.5 py-2 text-[12px] text-neg">
          Read failed for {failed.map((p) => p.code).join(", ")} — this list is incomplete. Not the
          same as a quiet day.
        </div>
      )}

      {rows.length === 0 ? (
        <Notice tone="muted">
          No {direction} for {day}
          {code === "ALL" ? " across the portfolio" : ` at ${selected[0]?.name ?? code}`}.
        </Notice>
      ) : (
        <Table rows={rows} showGuests={showGuests} showProperty={showProperty} />
      )}

      <p className="mt-3 text-[11.5px] leading-relaxed text-txt3">
        Filtered on date only, never on reservation status — so the list stays complete all day and
        you can see who has arrived versus who is still expected. Nights is derived from the check-in
        and checkout dates. Cached up to 10 min.
        {showGuests && " Contains guest names — internal staff only."}
      </p>
    </div>
  );
}
