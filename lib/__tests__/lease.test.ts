import { describe, it, expect } from "vitest";
import { classifyRatePlan } from "@/lib/lease";

describe("classifyRatePlan", () => {
  it("classifies monthly leases", () => {
    expect(classifyRatePlan("Monthly Lease")).toBe("lease-monthly");
    expect(classifyRatePlan("Long Term Rate (21 nights min)")).toBe("lease-monthly");
    expect(classifyRatePlan("Discounted Long Term Rate")).toBe("lease-monthly");
  });
  it("classifies weekly leases", () => {
    expect(classifyRatePlan("Weekly Lease")).toBe("lease-weekly");
    expect(classifyRatePlan("Discounted Weekly Rate")).toBe("lease-weekly");
    expect(classifyRatePlan("Employee Weekly Rate")).toBe("lease-weekly");
    expect(classifyRatePlan("Weekly Rate")).toBe("lease-weekly");
  });
  it("classifies transient", () => {
    expect(classifyRatePlan("Base Rate")).toBe("transient");
    expect(classifyRatePlan("Book Direct and Save")).toBe("transient");
    expect(classifyRatePlan("Non-refundable")).toBe("transient");
  });
  it("is case-insensitive", () => {
    expect(classifyRatePlan("monthly lease")).toBe("lease-monthly");
  });
  it("multi-plan: any lease present => lease, monthly beats weekly", () => {
    expect(classifyRatePlan("Discounted Weekly Rate, Monthly Lease")).toBe("lease-monthly");
    expect(classifyRatePlan("Base Rate, Weekly Lease")).toBe("lease-weekly");
  });
  it("empty/unknown => transient", () => {
    expect(classifyRatePlan("")).toBe("transient");
    expect(classifyRatePlan(null)).toBe("transient");
    expect(classifyRatePlan(undefined)).toBe("transient");
  });
});
