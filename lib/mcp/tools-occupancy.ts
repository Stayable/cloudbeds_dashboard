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
  occupiedNights: number;
  inventoryNights: number;
  /** Null when the bucket has no banked inventory — NEVER 0, which would read
   *  as an empty hotel rather than as a day we did not capture. */
  occupancyPct: number | null;
  roomRevenue: number;
  adr: number | null;
  revpar: number | null;
  oooNights: number;
};

const round = (n: number) => Math.round(n * 100) / 100;

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
        occupiedNights: round(occupiedNights),
        inventoryNights: round(inventoryNights),
        occupancyPct: inventoryNights > 0 ? occupiedNights / inventoryNights : null,
        roomRevenue: round(roomRevenue),
        adr: occupiedNights > 0 ? round(roomRevenue / occupiedNights) : null,
        revpar: inventoryNights > 0 ? round(roomRevenue / inventoryNights) : null,
        oooNights: round(oooNights),
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
        source: "snapshot" as const,
        asOf: null,
        note: "The property list is configuration, not measured data; it changes only when a property is acquired or sold.",
      },
    }),
  },
  {
    name: "get_occupancy",
    title: "Occupancy, ADR and RevPAR",
    description:
      "Occupancy %, rooms sold, out-of-order nights, room revenue, ADR and RevPAR for a date range, per property. Weekly and monthly figures are a ratio of sums over the bucket.",
    inputSchema: z.object({
      from: z.string().describe("Start date, YYYY-MM-DD (inclusive)."),
      to: z.string().describe("End date, YYYY-MM-DD (inclusive)."),
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
      "One call for 'how are we doing': MTD and YTD occupancy, room revenue, ADR and RevPAR for every active property and the portfolio.",
    inputSchema: z.object({
      asOf: z.string().optional().describe("Date to measure to, YYYY-MM-DD. Defaults to today (Eastern)."),
    }),
    handler: async (args: { asOf?: string }) => {
      const asOf = args.asOf ?? easternToday();
      const { properties, excluded } = resolveProperties();
      const codes = properties.map((p) => p.code);
      const yearStart = `${asOf.slice(0, 4)}-01-01`;
      const [mtd, ytd] = await Promise.all([
        getOccupancyRollup(monthStart(asOf), asOf),
        getOccupancyRollup(yearStart, asOf),
      ]);
      return {
        data: {
          asOf,
          mtd: rollupToRows(mtd, [{ key: "mtd", from: monthStart(asOf), to: asOf, partial: true }], codes),
          ytd: rollupToRows(ytd, [{ key: "ytd", from: yearStart, to: asOf, partial: true }], codes),
          excluded: excluded.map(propertySummary),
        },
        freshness: await snapshotFreshness(),
      };
    },
  },
];
