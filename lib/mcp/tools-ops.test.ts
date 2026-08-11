import { describe, it, expect, vi } from "vitest";
import { defaultReviewWindow, stripReviewsPII, stripContractorFreeText, OPS_TOOLS } from "./tools-ops";
import { McpArgError } from "./types";
import type { ReviewsView } from "@/lib/reviews";
import type { ContractorSchedule } from "@/lib/contractor-schedule";

describe("defaultReviewWindow", () => {
  // /ops uses a lockable window stored in Neon so everyone sees the same set of
  // reviews. The MCP tool must honour it, or Rob and the dashboard disagree
  // about how many 1-star reviews there were.
  it("uses the saved window when one is stored", () => {
    const w = defaultReviewWindow("2026-08-11", JSON.stringify({ from: "2026-07-01", to: "2026-07-31" }));
    expect(w).toEqual({ from: "2026-07-01", to: "2026-07-31" });
  });

  it("falls back to the last 30 days when nothing is saved", () => {
    expect(defaultReviewWindow("2026-08-11", null)).toEqual({ from: "2026-07-13", to: "2026-08-11" });
  });

  it("falls back when the stored value is not valid JSON", () => {
    expect(defaultReviewWindow("2026-08-11", "{not json")).toEqual({ from: "2026-07-13", to: "2026-08-11" });
  });

  it("falls back when the stored JSON is missing a bound", () => {
    expect(defaultReviewWindow("2026-08-11", JSON.stringify({ from: "2026-07-01" }))).toEqual({
      from: "2026-07-13",
      to: "2026-08-11",
    });
  });
});

describe("stripReviewsPII", () => {
  // buildReviewsView's per-review list carries verbatim review text and manager
  // responses — free text a guest or a manager wrote, which can name a guest, a
  // unit, or a staff member. This MCP surface has a weaker gate than /ops (PIN),
  // so it must never carry that text. Build a fake view with an obvious "leak"
  // in every free-text field and assert none of it survives the strip.
  const fakeView: ReviewsView = {
    total: 2,
    responded: 1,
    priorTotal: 3,
    from: "2026-07-01",
    to: "2026-07-31",
    priorFrom: "2026-06-01",
    priorTo: "2026-06-30",
    byProperty: [
      {
        property: "Davenport",
        count: 2,
        responded: 1,
        priorCount: 3,
        reviews: [
          {
            review: "John Smith in room 204 was a nightmare guest",
            source: "Google",
            managerResponse: "We spoke with Jane Doe about this, called her at 555-1234",
            created: "2026-07-15",
          },
        ],
      },
    ],
  };

  it("keeps only counts and aggregates, dropping the per-review list", () => {
    const stripped = stripReviewsPII(fakeView);
    expect(stripped).toEqual({
      total: 2,
      responded: 1,
      priorTotal: 3,
      from: "2026-07-01",
      to: "2026-07-31",
      priorFrom: "2026-06-01",
      priorTo: "2026-06-30",
      byProperty: [{ property: "Davenport", count: 2, responded: 1, priorCount: 3 }],
    });
  });

  it("carries no name-like or free-text field anywhere in the output", () => {
    const stripped = stripReviewsPII(fakeView);
    const serialized = JSON.stringify(stripped);
    // No leaked review text, manager response, phone number, or the planted names.
    expect(serialized).not.toMatch(/John Smith|Jane Doe|555-1234|nightmare|spoke with/i);
    // No field that could carry free text in the first place.
    expect(serialized).not.toMatch(/"review"|"managerResponse"|"reviews"/);
  });
});

// Critical 3 (final review): the sheet's "Latest WhatsApp Update" and "Task"
// columns are a maintenance crew's free text — the same risk class
// stripReviewsPII exists to block, on the same weaker (no-PIN) gate. Build a
// fake schedule with an obvious "leak" in both free-text fields and assert
// neither survives.
describe("stripContractorFreeText", () => {
  const fakeSchedule: ContractorSchedule = {
    sheetName: "Contractor Schedule 08-03 to 08-07-26",
    permalink: "https://app.smartsheet.com/sheets/abc123",
    defaultKey: "Monday",
    todayWeekday: "Monday",
    weekendRows: 0,
    undatedRows: 0,
    totalRows: 1,
    days: [
      {
        key: "Monday",
        date: "2026-08-03",
        rows: [
          {
            contractor: "ABC Roofing",
            property: "Lakeland",
            task: "Fix AC in room 214 for guest John Smith",
            status: "In progress",
            update: "Spoke with tenant Jane Doe, called her at 555-1234",
            date: "2026-08-03",
          },
        ],
      },
      { key: "Tuesday", date: "", rows: [] },
      { key: "Wednesday", date: "", rows: [] },
      { key: "Thursday", date: "", rows: [] },
      { key: "Friday", date: "", rows: [] },
    ],
  };

  it("keeps contractor/property/status/date, dropping task and update entirely", () => {
    const stripped = stripContractorFreeText(fakeSchedule);
    expect(stripped.days[0].rows[0]).toEqual({
      contractor: "ABC Roofing",
      property: "Lakeland",
      status: "In progress",
      date: "2026-08-03",
    });
  });

  it("carries no free-text field or leaked identity anywhere in the output", () => {
    const stripped = stripContractorFreeText(fakeSchedule);
    const serialized = JSON.stringify(stripped);
    expect(serialized).not.toMatch(/John Smith|Jane Doe|555-1234|room 214/i);
    // No field that could carry free text in the first place.
    expect(serialized).not.toMatch(/"task"|"update"/);
  });

  it("preserves the schedule-level metadata (sheet name, permalink, counts)", () => {
    const stripped = stripContractorFreeText(fakeSchedule);
    expect(stripped.sheetName).toBe(fakeSchedule.sheetName);
    expect(stripped.permalink).toBe(fakeSchedule.permalink);
    expect(stripped.totalRows).toBe(1);
    expect(stripped.days).toHaveLength(5);
  });
});

describe("get_contractor_schedule error handling (Important 1)", () => {
  it("never returns the raw upstream error text — maps it through mapUpstreamError", async () => {
    const tool = OPS_TOOLS.find((t) => t.name === "get_contractor_schedule")!;
    // Simulate the unconfigured case by clearing the env var the real
    // getContractorSchedule reads (lib/contractor-schedule.ts readSmartsheetToken).
    const original = process.env.SMARTSHEET_API_TOKEN;
    delete process.env.SMARTSHEET_API_TOKEN;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { data, freshness } = await tool.handler({});
      expect(JSON.stringify(data)).not.toMatch(/SMARTSHEET_API_TOKEN/);
      expect((data as any).error).toMatch(/not configured/i);
      expect(freshness.asOf).toBeNull();
    } finally {
      spy.mockRestore();
      if (original === undefined) delete process.env.SMARTSHEET_API_TOKEN;
      else process.env.SMARTSHEET_API_TOKEN = original;
    }
  });
});

// Both tools take optional from/to. Neither used to check they were real
// calendar dates before handing them to buildReviewsView / getEliseFunnel —
// validating here means the check runs (and fails fast) before any
// Smartsheet/Snowflake I/O is attempted.
describe("get_reviews and get_leasing_funnel date arguments", () => {
  const getReviews = OPS_TOOLS.find((t) => t.name === "get_reviews")!;
  const getLeasingFunnel = OPS_TOOLS.find((t) => t.name === "get_leasing_funnel")!;

  it("get_reviews rejects a malformed from, naming the argument", async () => {
    await expect(getReviews.handler({ from: "not-a-date", to: "2026-08-10" })).rejects.toThrow(McpArgError);
    await expect(getReviews.handler({ from: "not-a-date", to: "2026-08-10" })).rejects.toThrow(/from/);
  });

  it("get_reviews rejects a calendar-impossible to (Feb 30)", async () => {
    await expect(getReviews.handler({ from: "2026-02-01", to: "2026-02-30" })).rejects.toThrow(McpArgError);
  });

  it("get_leasing_funnel rejects a malformed from, naming the argument", async () => {
    await expect(getLeasingFunnel.handler({ from: "not-a-date" })).rejects.toThrow(McpArgError);
    await expect(getLeasingFunnel.handler({ from: "not-a-date" })).rejects.toThrow(/from/);
  });

  it("get_leasing_funnel rejects a calendar-impossible to (Feb 30)", async () => {
    await expect(getLeasingFunnel.handler({ to: "2026-02-30" })).rejects.toThrow(McpArgError);
  });
});
