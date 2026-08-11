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
//
// Final review, Critical 3: the contractor schedule carries the SAME risk
// class, in a column stripReviewsPII's own comment never considered — the
// sheet's "Latest WhatsApp Update" is a maintenance crew's message copied
// verbatim, and a message about a hotel room routinely names the occupant
// ("guest in 214 says the AC is out"), a staff member, or a phone number. The
// module-level reasoning below used to say "not guest data, passes through
// unchanged" — true of the contractor/property NAMES, false of the free-text
// columns riding alongside them. See stripContractorFreeText.

import { z } from "zod";
import { getEvictions, getOneStarReviews } from "@/lib/smartsheet";
import { buildReviewsView, type ReviewsView } from "@/lib/reviews";
import { buildLeasingViews } from "@/lib/leasing";
import { getContractorSchedule, type ContractorSchedule } from "@/lib/contractor-schedule";
import { getEliseFunnel, getElisePipeline, getEliseSyncStatus, getSetting } from "@/lib/db";
import { easternToday, shiftYmd } from "@/lib/dates";
import { parseYmdArg, ymdArgSchema } from "./args";
import { describeElise, smartsheetFreshness } from "./freshness";
import { mapUpstreamError } from "./error-mapper";
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

/** Aggregate-only shape of one contractor-schedule row — no free text. */
export type ContractorScheduleRowSummary = {
  contractor: string;
  property: string;
  status: string;
  date: string;
};

export type ContractorScheduleDaySummary = {
  key: string;
  date: string;
  rows: ContractorScheduleRowSummary[];
};

/** Aggregate-only shape of the contractor schedule — no free text. */
export type ContractorScheduleSummary = {
  sheetName: string;
  permalink: string;
  days: ContractorScheduleDaySummary[];
  defaultKey: string;
  todayWeekday: string;
  weekendRows: number;
  undatedRows: number;
  totalRows: number;
};

/**
 * Strip the two free-text columns — `task` and `update` ("Latest WhatsApp
 * Update") — out of ContractorSchedule before it can leave the process.
 *
 * WHAT THIS STRIPS AND WHY (Critical 3, final review): `ScheduleRow.update`
 * is a maintenance crew's WhatsApp message copied verbatim into the sheet —
 * the exact same risk class stripReviewsPII exists to block for 1-star
 * reviews, on the SAME weaker (no-PIN) gate: a message about a hotel room
 * routinely names the occupant ("guest in 214 says the AC is out"), a staff
 * member, or a phone number. `task` is dropped alongside it for the same
 * reason — a short work-order description can just as easily name a room's
 * occupant. Contractor and property NAMES are not guest data (they're vendor/
 * crew identities, unrelated to the /bea exception) and pass through, mirroring
 * app/rob/page.tsx.
 *
 * Built via an explicit field-by-field mapping, like stripReviewsPII, so a new
 * column added to the sheet later cannot slip through by simply spreading the
 * row — it has to be added here on purpose.
 */
export function stripContractorFreeText(schedule: ContractorSchedule): ContractorScheduleSummary {
  return {
    sheetName: schedule.sheetName,
    permalink: schedule.permalink,
    days: schedule.days.map((d) => ({
      key: d.key,
      date: d.date,
      rows: d.rows.map((r) => ({
        contractor: r.contractor,
        property: r.property,
        status: r.status,
        date: r.date,
      })),
    })),
    defaultKey: schedule.defaultKey,
    todayWeekday: schedule.todayWeekday,
    weekendRows: schedule.weekendRows,
    undatedRows: schedule.undatedRows,
    totalRows: schedule.totalRows,
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
      const ok = payload.configured && !payload.error;
      return {
        data: {
          configured: payload.configured,
          error: payload.error ? mapUpstreamError("smartsheet", payload.error) : null,
          evictions: payload.views,
        },
        freshness: smartsheetFreshness(new Date().toISOString(), ok),
      };
    },
  },
  {
    name: "get_contractor_schedule",
    title: "This week's contractor schedule",
    description:
      "The contractor schedule for the current week — contractor, property, status and date, per row. The source sheet holds only the current week — there is no history and no forward view. The sheet's task description and WhatsApp update text are never returned; they routinely name a guest, a room occupant, a staff member or a phone number.",
    inputSchema: z.object({}),
    handler: async () => {
      const result = await getContractorSchedule();
      return {
        data: result.ok
          ? { schedule: stripContractorFreeText(result.data) }
          : { error: mapUpstreamError("smartsheet", result.error) },
        freshness: smartsheetFreshness(new Date().toISOString(), result.ok),
      };
    },
  },
  {
    name: "get_reviews",
    title: "One-star reviews",
    description:
      "One-star review counts and response rate per property. Defaults to the same locked date window the Operations dashboard uses. Counts only — review text and manager responses are never returned.",
    inputSchema: z.object({
      from: ymdArgSchema.optional().describe("Start date, YYYY-MM-DD."),
      to: ymdArgSchema.optional().describe("End date, YYYY-MM-DD."),
    }),
    handler: async (args: { from?: string; to?: string }) => {
      // Validate before any I/O: a malformed date should fail fast rather
      // than reach Smartsheet/Neon and produce a wrong or empty window.
      const from = args.from ? parseYmdArg("from", args.from) : undefined;
      const to = args.to ? parseYmdArg("to", args.to) : undefined;
      const asOf = easternToday();
      const [payload, saved] = await Promise.all([getOneStarReviews(), getSetting("ops_reviews_window")]);
      const win = from && to ? { from, to } : defaultReviewWindow(asOf, saved);
      const view = buildReviewsView(payload.reviews, win.from, win.to);
      const ok = payload.configured && !payload.error;
      return {
        data: {
          configured: payload.configured,
          error: payload.error ? mapUpstreamError("smartsheet", payload.error) : null,
          window: win,
          reviews: stripReviewsPII(view),
        },
        freshness: smartsheetFreshness(new Date().toISOString(), ok),
      };
    },
  },
  {
    name: "get_leasing_funnel",
    title: "EliseAI leasing funnel",
    description:
      "Leasing funnel stages and the current prospect pipeline from EliseAI. Check the freshness note — this feed has failed before, and stale figures look identical to current ones.",
    inputSchema: z.object({
      from: ymdArgSchema.optional().describe("Start date, YYYY-MM-DD. Defaults to the last 30 days."),
      to: ymdArgSchema.optional().describe("End date, YYYY-MM-DD."),
    }),
    handler: async (args: { from?: string; to?: string }) => {
      const asOf = easternToday();
      const from = args.from ? parseYmdArg("from", args.from) : shiftYmd(asOf, -29);
      const to = args.to ? parseYmdArg("to", args.to) : asOf;
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
