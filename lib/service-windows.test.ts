import { describe, it, expect } from "vitest";
import {
  isInService,
  sellableRooms,
  inventoryFor,
  inServiceDays,
  overrideOooNights,
  activeOverrideNotes,
} from "./service-windows";
import { PROPERTIES } from "@/config/properties";
import type { Property } from "@/config/properties";

const JN = PROPERTIES.find((p) => p.code === "JN")!;
const DP = PROPERTIES.find((p) => p.code === "DP")!;
const LL = PROPERTIES.find((p) => p.code === "LL")!;

// NO REAL PROPERTY CARRIES A sellableOverride ANY MORE — JN's was removed
// 08/08/26 once paged block reads made it unnecessary (see config/properties.ts).
// The mechanism is kept and still tested, because the next property whose
// unsellable rooms are genuinely not blocked in Cloudbeds will need it. Tests
// therefore build the override onto JN's real in-service windows rather than
// asserting against live config, which would silently pass forever if the
// mechanism broke.
const JN_WITH_OVERRIDE: Property = {
  ...JN,
  sellableOverrides: [{ from: "2026-04-01", rooms: 20, reason: "Renovation: test fixture" }],
};

describe("isInService", () => {
  it("treats a property with no windows as always in service", () => {
    expect(LL.inServiceWindows).toBeUndefined();
    expect(isInService(LL, "2024-01-01")).toBe(true);
    expect(isInService(LL, "2026-07-26")).toBe(true);
  });

  it("honours JN's two windows and the dark period between them", () => {
    expect(isInService(JN, "2025-01-01")).toBe(true);
    expect(isInService(JN, "2025-04-30")).toBe(true);
    expect(isInService(JN, "2025-05-01")).toBe(false);
    expect(isInService(JN, "2026-03-31")).toBe(false);
    expect(isInService(JN, "2026-04-01")).toBe(true);
    expect(isInService(JN, "2026-07-26")).toBe(true);
  });

  it("honours DP's open-ended window", () => {
    expect(isInService(DP, "2025-05-31")).toBe(false);
    expect(isInService(DP, "2025-06-01")).toBe(true);
    expect(isInService(DP, "2026-07-26")).toBe(true);
  });
});

describe("inventoryFor", () => {
  it("banks zero on out-of-service days and capacity in service", () => {
    expect(inventoryFor(JN, "2026-03-31", 127)).toBe(0);
    expect(inventoryFor(JN, "2026-04-01", 127)).toBe(127);
  });
});

describe("inServiceDays", () => {
  it("reproduces Monica's JN 2026 YTD day count (117 through 7/26)", () => {
    expect(inServiceDays(JN, "2026-01-01", "2026-07-26")).toHaveLength(117);
  });

  it("reproduces Monica's JN 2025 day count (120 through 7/19)", () => {
    expect(inServiceDays(JN, "2025-01-01", "2025-07-19")).toHaveLength(120);
  });

  it("reproduces Monica's DP 2025 day count (49 through 7/19)", () => {
    expect(inServiceDays(DP, "2025-01-01", "2025-07-19")).toHaveLength(49);
  });

  it("counts every day for an always-open property", () => {
    expect(inServiceDays(LL, "2026-01-01", "2026-07-26")).toHaveLength(207);
  });
});

describe("sellableRooms / overrideOooNights", () => {
  it("caps a property at its sellable override once reopened", () => {
    expect(sellableRooms(JN_WITH_OVERRIDE, "2026-07-26", 127)).toBe(20);
    // Before the override window (and while dark) there is nothing sellable.
    expect(sellableRooms(JN_WITH_OVERRIDE, "2026-03-31", 127)).toBe(0);
  });

  it("derives OOO as capacity minus sellable", () => {
    expect(overrideOooNights(JN_WITH_OVERRIDE, "2026-07-26", "2026-07-26", 127)).toBe(107);
    // 26 in-service days in July through the 26th.
    expect(overrideOooNights(JN_WITH_OVERRIDE, "2026-07-01", "2026-07-26", 127)).toBe(107 * 26);
  });

  it("charges no override nights on out-of-service days", () => {
    expect(overrideOooNights(JN_WITH_OVERRIDE, "2026-03-01", "2026-03-31", 127)).toBe(0);
  });

  it("returns zero for properties without an override", () => {
    expect(overrideOooNights(LL, "2026-07-01", "2026-07-26", 157)).toBe(0);
    expect(sellableRooms(LL, "2026-07-26", 157)).toBe(157);
  });

  it("leaves JN's real config with no override, so its OOO comes from Cloudbeds", () => {
    // Guards the 08/08/26 removal: a re-added override would double-count the
    // blocked_dates rooms against the OOO line and push Available negative.
    expect(JN.sellableOverrides).toBeUndefined();
    expect(overrideOooNights(JN, "2026-08-01", "2026-08-06", 127)).toBe(0);
    expect(sellableRooms(JN, "2026-08-06", 127)).toBe(127);
  });

  it("never reports more sellable rooms than physically exist", () => {
    const over: Property = { ...LL, sellableOverrides: [{ from: "2026-01-01", rooms: 999, reason: "typo" }] };
    expect(sellableRooms(over, "2026-07-26", 157)).toBe(157);
  });
});

describe("activeOverrideNotes", () => {
  it("surfaces the reason when an override overlaps the range", () => {
    expect(activeOverrideNotes(JN_WITH_OVERRIDE, "2026-07-01", "2026-07-26")).toHaveLength(1);
    expect(activeOverrideNotes(JN_WITH_OVERRIDE, "2026-07-01", "2026-07-26")[0]).toMatch(/Renovation/);
  });

  it("is empty for a range entirely before the override", () => {
    expect(activeOverrideNotes(JN_WITH_OVERRIDE, "2025-01-01", "2025-04-30")).toEqual([]);
    expect(activeOverrideNotes(LL, "2026-07-01", "2026-07-26")).toEqual([]);
  });

  it("reports no override notes for any live property — the report's badge stays clean", () => {
    for (const p of PROPERTIES) {
      expect(activeOverrideNotes(p, "2026-08-01", "2026-08-06")).toEqual([]);
    }
  });
});
