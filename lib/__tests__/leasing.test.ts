import { describe, it, expect } from "vitest";
import { buildLeasingViews, pct, FUNNEL_STAGES } from "@/lib/leasing";
import type { EliseFunnelRow, ElisePipelineRow } from "@/lib/db";

const f = (code: string, eventType: string, n: number, day = "2026-06-15"): EliseFunnelRow => ({
  code,
  day,
  eventType,
  n,
});

describe("pct", () => {
  it("returns a 1-decimal percentage", () => {
    expect(pct(50, 200)).toBe(25);
    expect(pct(1, 3)).toBe(33.3);
  });
  it("is null when the denominator is 0 or missing", () => {
    expect(pct(5, 0)).toBeNull();
    expect(pct(0, 0)).toBeNull();
  });
  it("is 0 when numerator is 0 but denominator positive", () => {
    expect(pct(0, 10)).toBe(0);
  });
});

describe("buildLeasingViews", () => {
  const funnel: EliseFunnelRow[] = [
    // Davenport: 100 leads, 20 tours booked, 10 attended, 4 leased, 3 cancelled
    f("DP", "prospect", 60),
    f("DP", "prospect", 40, "2026-06-16"), // splits across days -> sums to 100
    f("DP", "tour_booked", 20),
    f("DP", "tour_attended", 10),
    f("DP", "lease_completed", 4),
    f("DP", "prospect_canceled", 3),
    // Lakeland: 200 leads, 0 tours, 0 leased
    f("LL", "prospect", 200),
    // an event type we don't chart should be ignored by the stage list
    f("DP", "opt_out_sms", 99),
  ];
  const pipeline: ElisePipelineRow[] = [
    { code: "DP", status: "Inquiry", n: 90 },
    { code: "DP", status: "Leased", n: 4 },
    { code: "LL", status: "Inquiry", n: 200 },
  ];

  it("returns an ALL view first, then per-property ordered by leads desc", () => {
    const views = buildLeasingViews(funnel, pipeline);
    expect(views[0].key).toBe("ALL");
    expect(views[0].label).toBe("All properties");
    expect(views.slice(1).map((v) => v.key)).toEqual(["LL", "DP"]); // LL 200 leads > DP 100
  });

  it("sums stage counts across days and across properties for ALL", () => {
    const [all] = buildLeasingViews(funnel, pipeline);
    const leads = all.stages.find((s) => s.key === "prospect")!;
    expect(leads.n).toBe(300); // 100 DP + 200 LL
    expect(all.stages.find((s) => s.key === "tour_booked")!.n).toBe(20);
    expect(all.stages.find((s) => s.key === "lease_completed")!.n).toBe(4);
  });

  it("orders stages per FUNNEL_STAGES and ignores unlisted event types", () => {
    const views = buildLeasingViews(funnel, pipeline);
    const dp = views.find((v) => v.key === "DP")!;
    expect(dp.stages.map((s) => s.key)).toEqual(FUNNEL_STAGES.map((s) => s.key));
    // opt_out_sms is not a funnel stage -> never appears
    expect(dp.stages.some((s) => s.key === "opt_out_sms")).toBe(false);
  });

  it("computes conversion rates, null when the denominator is 0", () => {
    const views = buildLeasingViews(funnel, pipeline);
    const dp = views.find((v) => v.key === "DP")!;
    expect(dp.leadToTour).toBe(20); // 20/100
    expect(dp.tourToLease).toBe(20); // 4 leased / 20 BOOKED (not attended)
    expect(dp.leadToLease).toBe(4); // 4/100
    expect(dp.tourAttendanceRecorded).toBe(50); // 10 attended / 20 booked
    const ll = views.find((v) => v.key === "LL")!;
    expect(ll.leadToTour).toBe(0); // 0/200
    expect(ll.tourToLease).toBeNull(); // 0 booked -> null
    expect(ll.tourAttendanceRecorded).toBeNull();
  });

  it("never reports a Tour→Lease rate above 100% when attendance is under-recorded", () => {
    // Elise under-records tour_attended: real portfolio last-30 was 399 booked /
    // 93 attended / 138 leased, which over attended read 148.4%.
    const rows = [
      { code: "DP", day: "2026-07-01", eventType: "prospect", n: 2128 },
      { code: "DP", day: "2026-07-01", eventType: "tour_booked", n: 399 },
      { code: "DP", day: "2026-07-01", eventType: "tour_attended", n: 93 },
      { code: "DP", day: "2026-07-01", eventType: "lease_completed", n: 138 },
    ];
    const dp = buildLeasingViews(rows, []).find((v) => v.key === "DP")!;
    expect(dp.tourToLease).toBeLessThanOrEqual(100);
    expect(dp.tourToLease).toBeCloseTo(34.6, 1);
    expect(dp.tourAttendanceRecorded).toBeCloseTo(23.3, 1);
  });

  it("counts cancellations per property and in ALL", () => {
    const views = buildLeasingViews(funnel, pipeline);
    expect(views.find((v) => v.key === "DP")!.cancelled).toBe(3);
    expect(views.find((v) => v.key === "LL")!.cancelled).toBe(0);
    expect(views[0].cancelled).toBe(3);
  });

  it("attaches the pipeline snapshot per property and sums it in ALL", () => {
    const views = buildLeasingViews(funnel, pipeline);
    const dp = views.find((v) => v.key === "DP")!;
    expect(dp.pipeline.find((p) => p.status === "Inquiry")!.n).toBe(90);
    const all = views[0];
    expect(all.pipeline.find((p) => p.status === "Inquiry")!.n).toBe(290); // 90 + 200
    expect(all.pipeline.find((p) => p.status === "Leased")!.n).toBe(4);
  });

  it("resolves a friendly property label from config", () => {
    const views = buildLeasingViews(funnel, pipeline);
    expect(views.find((v) => v.key === "DP")!.label).toBe("Davenport");
  });

  it("includes a property that only has pipeline data (no funnel rows)", () => {
    const views = buildLeasingViews([], [{ code: "SA", status: "Inquiry", n: 5 }]);
    expect(views.some((v) => v.key === "SA")).toBe(true);
    expect(views.find((v) => v.key === "SA")!.stages.every((s) => s.n === 0)).toBe(true);
  });

  it("returns [] when there is no data at all", () => {
    expect(buildLeasingViews([], [])).toEqual([]);
  });
});
