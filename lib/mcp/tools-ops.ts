// The non-Cloudbeds sections of Rob's dashboard: evictions, contractors,
// 1-star reviews and the EliseAI leasing funnel.
//
// Each calls the SAME builder the dashboard page calls (see app/ops/page.tsx
// and app/rob/page.tsx), so a figure quoted in chat matches the figure on the
// page. Where the dashboard applies a stored setting — the lockable reviews
// window — this honours it too, or the two surfaces would silently be counting
// different sets of reviews.
//
// PII posture: evictions and reviews are sourced from Smartsheet rows about
// tenants and guests. /ops shows them behind a PIN; this surface has a weaker
// gate and must never carry a name, email, phone number, or free text a guest
// or manager wrote. See stripReviewsPII below for what that costs.

import { z } from "zod";
import { getEvictions, getOneStarReviews } from "@/lib/smartsheet";
import { buildReviewsView, type ReviewsView } from "@/lib/reviews";
import { buildLeasingViews } from "@/lib/leasing";
import { getContractorSchedule } from "@/lib/contractor-schedule";
import { getEliseFunnel, getElisePipeline, getEliseSyncStatus, getSetting } from "@/lib/db";
import { easternToday, shiftYmd } from "@/lib/dates";
import { describeElise, smartsheetFreshness } from "./freshness";
import type { McpToolDef } from "./types";

/** The 1-star review window: the locked one from Neon if set, else 30 days.
 *  Mirrors app/ops/page.tsx so both surfaces count the same reviews. */
export function defaultReviewWindow(asOf: string, saved: string | null): { from: string; to: string } {
  const fallback = { from: shiftYmd(asOf, -29), to: asOf };
  if (!saved) return fallback;
  try {
    const parsed = JSON.parse(saved) as { from?: string; to?: string };
    return parsed.from && parsed.to ? { from: parsed.from, to: parsed.to } : fallback;
  } catch {
    return fallback;
  }
}

/** Aggregate-only shape of a per-property review breakdown — no free text. */
export type ReviewsPropertySummary = {
  property: string;
  count: number;
  responded: number;
  priorCount: number;
};

/** Aggregate-only shape of the reviews view — no free text. */
export type ReviewsSummary = {
  total: number;
  responded: number;
  priorTotal: number;
  from: string;
  to: string;
  priorFrom: string;
  priorTo: string;
  byProperty: ReviewsPropertySummary[];
};

/**
 * Strip guest/tenant-identifying free text out of buildReviewsView's output
 * before it can leave the process.
 *
 * WHAT THIS STRIPS AND WHY: `ReviewsView.byProperty[].reviews` carries, per
 * review, the verbatim `review` text and `managerResponse` text (plus
 * `source` and `created`, which are safe). Both are free text a guest or a
 * manager typed — a 1-star review can (and in practice does) name the guest,
 * a specific room, or a staff member, and a manager's reply can repeat that
 * name back along with a phone number or other contact detail entered while
 * trying to resolve the complaint. /ops shows this text behind a PIN gate;
 * this MCP surface does not have that gate, so the text does not travel here
 * at all — only the counts (`count`, `responded`, `priorCount`) that the
 * per-review list would otherwise back. The `reviews` array itself is dropped
 * from the output entirely, not filtered field-by-field, so a future field
 * added to ReviewRow can't slip through unnoticed.
 */
export function stripReviewsPII(view: ReviewsView): ReviewsSummary {
  return {
    total: view.total,
    responded: view.responded,
    priorTotal: view.priorTotal,
    from: view.from,
    to: view.to,
    priorFrom: view.priorFrom,
    priorTo: view.priorTo,
    byProperty: view.byProperty.map((p) => ({
      property: p.property,
      count: p.count,
      responded: p.responded,
      priorCount: p.priorCount,
    })),
  };
}

export const OPS_TOOLS: McpToolDef[] = [
  {
    name: "get_evictions",
    title: "Eviction pipeline",
    description:
      "Open, closed and total eviction cases per property, with average days to file, from Smartsheet. Counts only — no tenant names or case detail.",
    inputSchema: z.object({}),
    handler: async () => {
      // getEvictions() already runs the rows through buildEvictionsViews
      // (lib/smartsheet.ts) — the sheet it reads is a pre-aggregated metrics
      // rollup with counts only, never tenant names or case detail, so there
      // is nothing to strip here (verified by reading EvictionsView field by
      // field: key, label, open, closed, total, avgDays, avgDaysToFile).
      const payload = await getEvictions();
      return {
        data: { configured: payload.configured, error: payload.error, evictions: payload.views },
        freshness: smartsheetFreshness(new Date().toISOString()),
      };
    },
  },
  {
    name: "get_contractor_schedule",
    title: "This week's contractor schedule",
    description:
      "The contractor schedule for the current week. The source sheet holds only the current week — there is no history and no forward view.",
    inputSchema: z.object({}),
    handler: async () => {
      // Vendor/crew names on this sheet are NOT guest data (lib/contractor-
      // schedule.ts) — unrelated to the /bea guest-PII exception — so they
      // pass through unchanged, matching app/rob/page.tsx.
      const result = await getContractorSchedule();
      return {
        data: result.ok ? { schedule: result.data } : { error: result.error },
        freshness: smartsheetFreshness(new Date().toISOString()),
      };
    },
  },
  {
    name: "get_reviews",
    title: "One-star reviews",
    description:
      "One-star review counts and response rate per property. Defaults to the same locked date window the Operations dashboard uses. Counts only — review text and manager responses are never returned.",
    inputSchema: z.object({
      from: z.string().optional().describe("Start date, YYYY-MM-DD."),
      to: z.string().optional().describe("End date, YYYY-MM-DD."),
    }),
    handler: async (args: { from?: string; to?: string }) => {
      const asOf = easternToday();
      const [payload, saved] = await Promise.all([getOneStarReviews(), getSetting("ops_reviews_window")]);
      const win =
        args.from && args.to ? { from: args.from, to: args.to } : defaultReviewWindow(asOf, saved);
      const view = buildReviewsView(payload.reviews, win.from, win.to);
      return {
        data: {
          configured: payload.configured,
          error: payload.error,
          window: win,
          reviews: stripReviewsPII(view),
        },
        freshness: smartsheetFreshness(new Date().toISOString()),
      };
    },
  },
  {
    name: "get_leasing_funnel",
    title: "EliseAI leasing funnel",
    description:
      "Leasing funnel stages and the current prospect pipeline from EliseAI. Check the freshness note — this feed has failed before, and stale figures look identical to current ones.",
    inputSchema: z.object({
      from: z.string().optional().describe("Start date, YYYY-MM-DD. Defaults to the last 30 days."),
      to: z.string().optional().describe("End date, YYYY-MM-DD."),
    }),
    handler: async (args: { from?: string; to?: string }) => {
      const asOf = easternToday();
      const from = args.from ?? shiftYmd(asOf, -29);
      const to = args.to ?? asOf;
      const [funnel, pipeline, status] = await Promise.all([
        getEliseFunnel(from, to),
        getElisePipeline(),
        getEliseSyncStatus(),
      ]);
      // Funnel/pipeline rows are aggregated inside Snowflake (counts by stage
      // / status per property) — no lead or resident PII in EliseFunnelRow /
      // ElisePipelineRow, verified by reading lib/db.ts and lib/leasing.ts.
      return {
        data: { range: { from, to }, leasing: buildLeasingViews(funnel, pipeline) },
        freshness: describeElise(status, new Date().toISOString()),
      };
    },
  },
];
