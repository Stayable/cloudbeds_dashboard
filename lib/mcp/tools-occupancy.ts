// Occupancy, rate and revenue tools.
//
// Reads the banked snapshot store through getOccupancyRollup — the same source
// /report and /rob use — so an answer in Claude Desktop and a figure on the
// dashboard are the same number, not two derivations that can drift. Data
// Insights is deliberately NOT consulted: it returns Cloudbeds' own derivation
// over a capacity figure we know to be wrong (CLAUDE.md §6).

import { z } from "zod";
import { getOccupancyRollup, type OccupancyRollup } from "@/lib/db";
import { easternToday, monthStart } from "@/lib/dates";
import { PROPERTIES } from "@/config/properties";
import { parseYmdArg, ymdArgSchema } from "./args";
import { bucketRange, type Bucket, type Granularity } from "./buckets";
import { propertySummary, resolveProperties } from "./properties";
import { snapshotFreshness } from "./freshness";
import type { McpToolDef } from "./types";

export type PropertyBucketRow = {
  code: string;
  bucket: string;
  from: string;
  to: string;
  partial: boolean;
  /** Final review, Important 3: null — never 0 — when this property has no
   *  banked day at all inside the bucket. A bucket with zero real days used to
   *  come back as occupiedNights/inventoryNights/roomRevenue/oooNights: 0,
   *  which is a number a model will quote as "$0 revenue" or "0 nights sold"
   *  rather than "we don't know" — the same 429-zeros failure mode
   *  documented in lib/mcp/tools-live.ts, just in the snapshot-backed tools
   *  instead of the live ones. Only the ratios (occupancyPct/adr/revpar) were
   *  nulled before; the four counts they're built from were not. */
  occupiedNights: number | null;
  inventoryNights: number | null;
  /** Null when the bucket has no banked inventory — NEVER 0, which would read
   *  as an empty hotel rather than as a day we did not capture. */
  occupancyPct: number | null;
  roomRevenue: number | null;
  adr: number | null;
  revpar: number | null;
  oooNights: number | null;
};

const round = (n: number) => Math.round(n * 100) / 100;

/** Codes flagged `excludeFromAggregate` in config/properties.ts — currently
 *  Jacksonville North, which carries no bookings and would distort any
 *  average or total it was folded into. Every portfolio aggregate elsewhere
 *  in the app already excludes it (lib/report-card.ts, lib/ops-insights.ts,
 *  lib/ops-pdf-occupancy.ts, components/OccupancyView.tsx) — a portfolio
 *  figure computed over all 8 properties here would silently disagree with
 *  the dashboard's, which is exactly the drift CLAUDE.md §6 exists to prevent. */
const AGGREGATE_EXCLUDED_CODES: ReadonlySet<string> = new Set(
  PROPERTIES.filter((p) => p.excludeFromAggregate === true).map((p) => p.code),
);

export type PortfolioBucketRow = {
  bucket: string;
  from: string;
  to: string;
  partial: boolean;
  occupiedNights: number | null;
  inventoryNights: number | null;
  occupancyPct: number | null;
  roomRevenue: number | null;
  adr: number | null;
  revpar: number | null;
  oooNights: number | null;
  /** Property codes actually summed into this row (present, non-excluded). */
  includedCodes: string[];
  /** Non-excluded property codes that had no banked data for this bucket at
   *  all — named, never silently dropped from the total, matching the
   *  `excluded` convention this file already uses for property resolution. */
  missingCodes: string[];
};

/**
 * Final review, Critical 2: `get_portfolio_summary`'s own description says
 * "and the portfolio", and spec §5 says "Per property and portfolio" — neither
 * tool computed one, leaving the model to average `occupancyPct` across
 * properties (a mean of daily ratios, exactly what spec §5 forbids) and as
 * likely to include Jacksonville North as not, because `propertySummary` used
 * to have no field saying it should be excluded.
 *
 * This is a ratio of SUMS across properties within one bucket — the identical
 * rule `rollupToRows` already applies across DAYS within one property — never
 * a mean of `occupancyPct`, which would weigh a 30%-occupied 153-room property
 * the same as a 5%-occupied 20-room one.
 */
export function portfolioRows(rows: PropertyBucketRow[]): PortfolioBucketRow[] {
  const byBucket = new Map<string, PropertyBucketRow[]>();
  for (const r of rows) {
    if (AGGREGATE_EXCLUDED_CODES.has(r.code)) continue;
    const group = byBucket.get(r.bucket) ?? [];
    group.push(r);
    byBucket.set(r.bucket, group);
  }

  const out: PortfolioBucketRow[] = [];
  for (const group of byBucket.values()) {
    let occupiedNights = 0;
    let inventoryNights = 0;
    let roomRevenue = 0;
    let oooNights = 0;
    let anyData = false;
    const includedCodes: string[] = [];
    const missingCodes: string[] = [];

    for (const r of group) {
      // inventoryNights is the row's own "did this property have a banked
      // day in this bucket" flag (see rollupToRows) — null means no, and a
      // missing property contributes nothing to the sum rather than a 0.
      if (r.inventoryNights == null) {
        missingCodes.push(r.code);
        continue;
      }
      anyData = true;
      includedCodes.push(r.code);
      occupiedNights += r.occupiedNights ?? 0;
      inventoryNights += r.inventoryNights;
      roomRevenue += r.roomRevenue ?? 0;
      oooNights += r.oooNights ?? 0;
    }

    out.push({
      bucket: group[0].bucket,
      from: group[0].from,
      to: group[0].to,
      partial: group.some((r) => r.partial),
      occupiedNights: anyData ? round(occupiedNights) : null,
      inventoryNights: anyData ? round(inventoryNights) : null,
      occupancyPct: anyData && inventoryNights > 0 ? occupiedNights / inventoryNights : null,
      roomRevenue: anyData ? round(roomRevenue) : null,
      adr: anyData && occupiedNights > 0 ? round(roomRevenue / occupiedNights) : null,
      revpar: anyData && inventoryNights > 0 ? round(roomRevenue / inventoryNights) : null,
      oooNights: anyData ? round(oooNights) : null,
      includedCodes: includedCodes.sort(),
      missingCodes: missingCodes.sort(),
    });
  }
  return out.sort((a, b) => a.bucket.localeCompare(b.bucket));
}

/** Fold per-day rollups into buckets. Ratio of sums, once, at the end.
 *
 *  Sums each bucket's real per-day occupied/inventory/roomRev/ooo directly
 *  from OccupancyRollup.days rather than reconstructing them from the whole
 *  period's average inventory — that average is only exact when inventory is
 *  constant across the entire [from, to] range, which is not true in general
 *  (in-service windows, capacity changes, renovations mid-period). Summing the
 *  real per-day counts is exact regardless. See lib/db.ts's OccupancyRollup
 *  comment for why those per-day fields exist. */
export function rollupToRows(
  rollups: OccupancyRollup[],
  buckets: Bucket[],
  codes: string[],
): PropertyBucketRow[] {
  const byCode = new Map(rollups.map((r) => [r.code, r]));
  const rows: PropertyBucketRow[] = [];

  for (const code of codes) {
    const r = byCode.get(code);
    for (const b of buckets) {
      const days = (r?.days ?? []).filter((d) => d.day >= b.from && d.day <= b.to);
      // Final review, Important 3: a bucket with zero real days is a "we
      // don't know", not a "zero" — see PropertyBucketRow's comment. Only the
      // ratios were nulled before; the four counts they're built from were
      // not, and `roomRevenue: 0` in particular is a number a model will
      // quote as a fact rather than recognise as a gap.
      const hasData = days.length > 0;

      let occupiedNights = 0;
      let inventoryNights = 0;
      let roomRevenue = 0;
      let oooNights = 0;
      for (const d of days) {
        occupiedNights += d.occupied ?? 0;
        inventoryNights += d.inventory ?? 0;
        roomRevenue += d.roomRev ?? 0;
        oooNights += d.ooo ?? 0;
      }

      rows.push({
        code,
        bucket: b.key,
        from: b.from,
        to: b.to,
        partial: b.partial,
        occupiedNights: hasData ? round(occupiedNights) : null,
        inventoryNights: hasData ? round(inventoryNights) : null,
        occupancyPct: inventoryNights > 0 ? occupiedNights / inventoryNights : null,
        roomRevenue: hasData ? round(roomRevenue) : null,
        adr: occupiedNights > 0 ? round(roomRevenue / occupiedNights) : null,
        revpar: inventoryNights > 0 ? round(roomRevenue / inventoryNights) : null,
        oooNights: hasData ? round(oooNights) : null,
      });
    }
  }
  return rows;
}

const propertiesArg = z
  .array(z.string())
  .optional()
  .describe("Property names, codes or IDs. Omit for every active property.");

export const OCCUPANCY_TOOLS: McpToolDef[] = [
  {
    name: "list_properties",
    title: "List Stayable properties",
    description:
      "The eight Stayable properties with their IDs, codes and counties. Call this first if you are unsure how a property is named.",
    inputSchema: z.object({}),
    handler: async () => ({
      data: { properties: PROPERTIES.map(propertySummary) },
      freshness: {
        source: "config" as const,
        asOf: null,
        note: "The property list is configuration, not measured data; it changes only when a property is acquired or sold.",
      },
    }),
  },
  {
    name: "get_occupancy",
    title: "Occupancy, ADR and RevPAR",
    description:
      "Occupancy %, rooms sold, out-of-order nights, room revenue, ADR and RevPAR for a date range, per property AND for the portfolio. Weekly and monthly figures — including the portfolio total — are a ratio of sums over the bucket, never a mean of per-property percentages. The portfolio total excludes any property flagged excludeFromAggregate (currently Jacksonville North, which carries no bookings) — see `portfolio[].missingCodes`/`includedCodes` for exactly which properties were summed into each bucket.",
    inputSchema: z.object({
      from: ymdArgSchema.describe("Start date, YYYY-MM-DD (inclusive)."),
      to: ymdArgSchema.describe("End date, YYYY-MM-DD (inclusive)."),
      granularity: z.enum(["daily", "weekly", "monthly"]).default("daily"),
      properties: propertiesArg,
    }),
    handler: async (args: { from: string; to: string; granularity?: Granularity; properties?: string[] }) => {
      const { properties, excluded } = resolveProperties(args.properties);
      const buckets = bucketRange(args.from, args.to, args.granularity ?? "daily");
      const rollups = await getOccupancyRollup(args.from, args.to);
      const rows = rollupToRows(rollups, buckets, properties.map((p) => p.code));
      return {
        data: {
          range: { from: args.from, to: args.to },
          granularity: args.granularity ?? "daily",
          rows,
          // The one portfolio figure per bucket (Critical 2) — a ratio of
          // sums across properties, honouring excludeFromAggregate.
          portfolio: portfolioRows(rows),
          // Named, never silently dropped: a portfolio answer computed over
          // seven of eight hotels is wrong in a way that looks right. Empty
          // when the caller named properties explicitly, or when every
          // property is currently active (both real today).
          excluded: excluded.map(propertySummary),
        },
        freshness: await snapshotFreshness(),
      };
    },
  },
  {
    name: "get_portfolio_summary",
    title: "Portfolio month-to-date and year-to-date",
    description:
      "One call for 'how are we doing': MTD and YTD occupancy, room revenue, ADR and RevPAR for every active property AND the portfolio total (a ratio of sums, excluding Jacksonville North per excludeFromAggregate). NOTE ON COMPOSITION (Important 5): this MTD is banked snapshot days only, filtered to days with a real count capture — unlike /report's MTD, it does NOT add today's live Cloudbeds pull, so the two are not the same number even when asked for the same date.",
    inputSchema: z.object({
      asOf: ymdArgSchema.optional().describe("Date to measure to, YYYY-MM-DD. Defaults to today (Eastern)."),
    }),
    handler: async (args: { asOf?: string }) => {
      const asOf = args.asOf ? parseYmdArg("asOf", args.asOf) : easternToday();
      const { properties, excluded } = resolveProperties();
      const codes = properties.map((p) => p.code);
      const yearStart = `${asOf.slice(0, 4)}-01-01`;
      const [mtdRollup, ytdRollup] = await Promise.all([
        getOccupancyRollup(monthStart(asOf), asOf),
        getOccupancyRollup(yearStart, asOf),
      ]);
      const mtd = rollupToRows(mtdRollup, [{ key: "mtd", from: monthStart(asOf), to: asOf, partial: true }], codes);
      const ytd = rollupToRows(ytdRollup, [{ key: "ytd", from: yearStart, to: asOf, partial: true }], codes);
      const freshness = await snapshotFreshness();
      return {
        data: {
          asOf,
          mtd,
          ytd,
          portfolio: {
            mtd: portfolioRows(mtd)[0] ?? null,
            ytd: portfolioRows(ytd)[0] ?? null,
          },
          excluded: excluded.map(propertySummary),
        },
        // Important 5: the composition caveat travels in freshness.note too,
        // not just the tool description — the description is read once when
        // the connector is added; the note rides along with every answer.
        freshness: {
          ...freshness,
          note: `${freshness.note} This MTD is banked days only (no live "today" pull); /report's MTD additionally includes today's live Cloudbeds read, so the two figures are not the same composition.`,
        },
      };
    },
  },
];
