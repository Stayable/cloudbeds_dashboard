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
];
