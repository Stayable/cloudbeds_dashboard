// Today's state, read live from Cloudbeds.
//
// COUNTS ONLY. Arrivals and departures are numbers here, never a list of who
// is arriving — CLAUDE.md §5 rule 2, and the /bea guest-name exception does not
// extend to this surface.
//
// A property whose fetch failed reports `unavailable`, never zeros. Zero
// arrivals is a completely plausible Tuesday, so a failed read that returns 0
// is indistinguishable from a real quiet day. That exact confusion cost this
// project weeks of wrong out-of-order figures (see getRoomBlocks pagination
// note in lib/cloudbeds.ts) — a 429 silently banked as zero, unnoticed because
// zero looked like a valid answer.

import { z } from "zod";
import { getPortfolio, getPortfolioOoo, summarizeOoo, type PropertyDashboard, type PropertyOoo } from "@/lib/cloudbeds";
import { easternToday } from "@/lib/dates";
import { ymdArgSchema, parseYmdArg } from "./args";
import { resolveProperties, propertySummary } from "./properties";
import { liveFreshness } from "./freshness";
import { mapUpstreamError } from "./error-mapper";
import type { McpToolDef } from "./types";

export type LiveRow = {
  code: string;
  arrivals: number | null;
  departures: number | null;
  inHouse: number | null;
  /** Rooms occupied today. Named `roomsSold` on this tool's output to match
   *  what Rob asks in plain language; the underlying Cloudbeds field is
   *  `roomsOccupied` (see DashboardData in lib/cloudbeds.ts). */
  roomsSold: number | null;
  /** Out-of-service rooms only (OooRoom category "ooo") — deliberately
   *  excludes "other" blocks (e.g. blocked_dates), which is a separate figure
   *  the /report and /bea OOO views break out on its own. */
  oooRooms: number | null;
  unavailable: boolean;
  note?: string;
};

/** `arrivals`/`departures` come back from Cloudbeds as STRINGS (verified in
 *  lib/cloudbeds.ts). Same parseInt-and-guard pattern app/page.tsx already
 *  uses for the same field, so a malformed string (or "") degrades to null
 *  rather than NaN or a silent zero — Number("") is 0, which is exactly the
 *  manufactured-zero failure this task exists to prevent, so parseInt was
 *  chosen over Number for that reason alone.
 *
 *  Deliberate, not an oversight: parseInt("3.5", 10) truncates to 3 rather
 *  than rejecting the value. Arrival/departure counts are integers in every
 *  real Cloudbeds payload seen so far, so a fractional string would already
 *  indicate something wrong upstream; truncating is treated as an acceptable
 *  minor imprecision rather than grounds to null out an otherwise-present count. */
function parsedCount(raw: string): number | null {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

/** Pure pairing of a dashboard read and an out-of-order read per property code.
 *  Kept pure (no I/O) so the "unavailable, never zero" rule is unit-tested
 *  without touching the network. */
export function liveRows(portfolio: PropertyDashboard[], ooo: PropertyOoo[], codes: string[]): LiveRow[] {
  const byCode = new Map(portfolio.map((p) => [p.property.code, p]));
  const oooByCode = new Map(ooo.map((o) => [o.property.code, o]));

  return codes.map((code) => {
    const p = byCode.get(code);
    const o = oooByCode.get(code);

    // "ooo" specifically — never "other" blocks — computed independently of
    // whether the dashboard read succeeded, so a working OOO read still shows
    // up even when the dashboard read for the same property failed.
    const oooRooms = o?.configured && o.result?.ok ? summarizeOoo(o.result.data).ooo : null;

    if (!p || !p.configured || !p.result?.ok) {
      const name = p?.property.name;
      // Final review, Important 1: `p.result.error` used to ride straight
      // into this note unscrubbed — it can be "Network error reaching
      // Cloudbeds: <raw exception text>", which is exactly the kind of detail
      // spec §8 says must never leave the process for a third-party desktop
      // client. mapUpstreamError is the one shared translation (also used by
      // tools-ops.ts) so this doesn't grow a second, slightly different
      // version of the same idea.
      const reason = p?.configured === false
        ? "no Cloudbeds key is configured for this property."
        : p?.result && !p.result.ok
          ? mapUpstreamError("cloudbeds", p.result.error)
          : "Cloudbeds did not respond.";
      return {
        code,
        arrivals: null,
        departures: null,
        inHouse: null,
        roomsSold: null,
        oooRooms,
        unavailable: true,
        note: `Today's figures for ${name ? `${name} (${code})` : code} could not be read from Cloudbeds: ${reason}`,
      };
    }

    const d = p.result.data;
    return {
      code,
      arrivals: parsedCount(d.arrivals),
      departures: parsedCount(d.departures),
      inHouse: d.inHouse,
      roomsSold: d.roomsOccupied,
      oooRooms,
      unavailable: false,
    };
  });
}

/** One blocked room, in the SAME shape and wording as Bea's OOO explorer
 *  (components/BeaOosExplorer.tsx ROOM_COLS): Room, Type, Type code, Category,
 *  Reason, Until. Requested 08/13/26 so Jefferson can see which rooms are down
 *  from Claude rather than only in the dashboard. Matching her columns exactly
 *  is deliberate — two surfaces answering "which rooms are out of order" with
 *  different fields is how they start disagreeing. */
export type OooRoomRow = {
  /** Room code (`roomName`). "Unknown" when the name map could not resolve it —
   *  the same fallback Bea's table shows, rather than a Cloudbeds-internal
   *  roomID, which is meaningless to ops and looks like a room number. */
  room: string;
  roomType: string;
  roomTypeCode: string;
  category: "Out-of-Order" | "Other";
  /** FREE TEXT written by staff in Cloudbeds. Measured 08/13/26 across ~100
   *  live reasons: overwhelmingly operational (renovation, HVAC, pest control,
   *  flooring), and NO guest names — but three reasons named STAFF ("PM Sage's
   *  room", a site supervisor, a purchase-order owner). Staff names in a
   *  staff-only tool are not the guest PII CLAUDE.md §5 rule 2 forbids, which is
   *  why this field ships. The field is unconstrained, though, so that is
   *  current practice and not a guarantee. */
  reason: string;
  /** Block end date (`endDate`) — "Until" in Bea's table. */
  until: string;
};

export type OooPropertyRows = {
  code: string;
  name: string;
  /** Reconciles: ooo + other === total === rooms.length. Null when unreadable —
   *  never a zeroed object, for the reason in this file's header. */
  counts: { ooo: number; other: number; total: number } | null;
  rooms: OooRoomRow[];
  unavailable: boolean;
  note?: string;
};

/** Pure shaping of an out-of-order read into Bea's columns. No I/O, so the
 *  "unavailable, never zero" rule is unit-tested without the network — a
 *  property whose read failed must not look like a property with no blocks. */
export function oooRoomRows(ooo: PropertyOoo[], codes: string[]): OooPropertyRows[] {
  const byCode = new Map(ooo.map((o) => [o.property.code, o]));

  return codes.map((code) => {
    const o = byCode.get(code);
    const name = o?.property.name ?? code;

    if (!o || !o.configured || !o.result?.ok) {
      const reason = o?.configured === false
        ? "no Cloudbeds key is configured for this property."
        : o?.result && !o.result.ok
          ? mapUpstreamError("cloudbeds", o.result.error)
          : "Cloudbeds did not respond.";
      return {
        code,
        name,
        counts: null,
        rooms: [],
        unavailable: true,
        note: `Blocked rooms for ${name} (${code}) could not be read from Cloudbeds: ${reason}`,
      };
    }

    const data = o.result.data;
    return {
      code,
      name,
      counts: summarizeOoo(data),
      rooms: data.map((r) => ({
        room: r.room || "Unknown",
        roomType: r.roomType,
        roomTypeCode: r.roomTypeCode,
        category: r.category === "ooo" ? ("Out-of-Order" as const) : ("Other" as const),
        reason: r.reason,
        until: r.endDate,
      })),
      unavailable: false,
    };
  });
}

export const LIVE_TOOLS: McpToolDef[] = [
  {
    name: "get_today",
    title: "Today's live state",
    description:
      "Arrivals, departures, in-house, rooms sold and out-of-order rooms for today, read live from Cloudbeds — not the banked snapshot store. Counts only: no guest names or reservation-level detail are available through this tool.",
    inputSchema: z.object({
      properties: z
        .array(z.string())
        .optional()
        .describe("Property names, codes or business IDs. Omit for every active property."),
    }),
    handler: async (args: { properties?: string[] }) => {
      const { properties, excluded } = resolveProperties(args.properties);
      const codes = properties.map((p) => p.code);
      const asOf = easternToday();
      const [portfolio, ooo] = await Promise.all([
        getPortfolio().catch(() => []),
        getPortfolioOoo(asOf).catch(() => []),
      ]);
      return {
        data: {
          asOf,
          rows: liveRows(portfolio, ooo, codes),
          // A default (no-argument) portfolio answer computed over fewer than
          // all 8 hotels must say so out loud — see resolveProperties in
          // lib/mcp/properties.ts. Always [] when properties were named
          // explicitly.
          excluded: excluded.map(propertySummary),
        },
        freshness: liveFreshness(new Date().toISOString()),
      };
    },
  },
  {
    name: "get_ooo_rooms",
    title: "Out-of-order rooms (which rooms, not how many)",
    description:
      "The actual list of blocked rooms per property — room number, room type, whether it is Out-of-Order or an Other block, the reason, and the date the block runs until. This is the same view as the OOO explorer on the dashboard. Use this when asked WHICH rooms are down; use get_today for a count. The reason is free text typed by staff in Cloudbeds, so it may be terse, may run long, and may name a staff member — quote it as a note from the property, not as an authoritative status.",
    inputSchema: z.object({
      properties: z
        .array(z.string())
        .optional()
        .describe("Property names, codes or business IDs. Omit for every active property."),
      asOf: ymdArgSchema
        .optional()
        .describe("Stay date, YYYY-MM-DD. Defaults to today (Eastern). Blocks overlapping this date are returned."),
    }),
    handler: async (args: { properties?: string[]; asOf?: string }) => {
      const { properties, excluded } = resolveProperties(args.properties);
      const codes = properties.map((p) => p.code);
      const asOf = args.asOf ? parseYmdArg("asOf", args.asOf) : easternToday();
      const ooo = await getPortfolioOoo(asOf).catch(() => []);
      return {
        data: {
          asOf,
          properties: oooRoomRows(ooo, codes),
          excluded: excluded.map(propertySummary),
        },
        freshness: liveFreshness(new Date().toISOString()),
      };
    },
  },
];
