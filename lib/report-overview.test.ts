import { describe, it, expect } from "vitest";
import { derive, periodBlockFor, portfolioRollup } from "./revenue-report";
import type { PeriodBlock, PropertyActual, RowInputs } from "./revenue-report";

/** A one-day-ish RowInputs with only the fields a test cares about set. */
function inputs(p: Partial<RowInputs> = {}): RowInputs {
  return {
    transientNights: 0, leaseNights: 0, otherBlocks: 0, ooo: 0,
    inventory: 0, transientRev: 0, leaseRev: 0, ...p,
  };
}

function block(p: Partial<RowInputs>, countsPartial = false): PeriodBlock {
  return { actual: derive(inputs(p)), lastYear: null, countsPartial };
}

function property(
  code: string,
  yesterday: PeriodBlock,
  mtd: PeriodBlock,
  ytd: PeriodBlock = block({}),
): PropertyActual {
  return { code, name: code, yesterday, mtd, ytd };
}

describe("periodBlockFor", () => {
  const p = property(
    "DP",
    block({ transientNights: 10, inventory: 100 }),
    block({ transientNights: 300, inventory: 700 }),
  );

  it("selects the yesterday block", () => {
    expect(periodBlockFor(p, "yesterday").actual.occupied).toBe(10);
  });
  it("selects the mtd block", () => {
    expect(periodBlockFor(p, "mtd").actual.occupied).toBe(300);
  });
});

describe("portfolioRollup", () => {
  it("sums occupied/inventory/revenue/ooo across properties for the period", () => {
    const props = [
      property(
        "LL",
        block({ transientNights: 60, inventory: 100, transientRev: 4000, ooo: 3 }),
        block({ transientNights: 420, inventory: 700, transientRev: 28000, ooo: 21 }),
      ),
      property(
        "DP",
        block({ transientNights: 40, inventory: 100, transientRev: 2000, ooo: 1 }),
        block({ transientNights: 280, inventory: 700, transientRev: 14000, ooo: 7 }),
      ),
    ];

    const y = portfolioRollup(props, "yesterday");
    expect(y.pOcc).toBeCloseTo(100 / 200, 6);
    expect(y.adr).toBeCloseTo(6000 / 100, 6);
    expect(y.revpar).toBeCloseTo(6000 / 200, 6);
    expect(y.ooo).toBe(4);
    expect(y.roomRev).toBe(6000);
    expect(y.reporting).toBe(2);
    expect(y.total).toBe(2);
    expect(y.countsPartial).toBe(false);

    const m = portfolioRollup(props, "mtd");
    expect(m.pOcc).toBeCloseTo(700 / 1400, 6);
    expect(m.adr).toBeCloseTo(42000 / 700, 6);
    expect(m.revpar).toBeCloseTo(42000 / 1400, 6);
    expect(m.ooo).toBe(28);
    expect(m.roomRev).toBe(42000);
  });

  it("counts only properties that reported a percentage", () => {
    const props = [
      property("LL", block({ transientNights: 60, inventory: 100 }), block({})),
      // No inventory at all — derive() guards the divide and yields pOcc 0.
      property("XX", block({}), block({})),
    ];
    expect(portfolioRollup(props, "yesterday").reporting).toBe(1);
    expect(portfolioRollup(props, "yesterday").total).toBe(2);
  });

  it("taints the whole roll-up when ANY property's block has partial counts", () => {
    const props = [
      property(
        "LL",
        block({ transientNights: 60, inventory: 100 }),
        block({ transientNights: 420, inventory: 700 }, false),
      ),
      property(
        "DP",
        block({ transientNights: 40, inventory: 100 }),
        block({ transientNights: 280, inventory: 700 }, true),
      ),
    ];
    expect(portfolioRollup(props, "mtd").countsPartial).toBe(true);
    expect(portfolioRollup(props, "yesterday").countsPartial).toBe(false);
  });

  it("keeps revenue and RevPAR even when counts are partial, and nulls the rest", () => {
    const props = [
      property(
        "LL",
        block({}),
        block({ transientNights: 420, inventory: 700, transientRev: 28000, ooo: 21 }, true),
      ),
    ];
    const m = portfolioRollup(props, "mtd");
    // Exact, never accumulated from counts.
    expect(m.roomRev).toBe(28000);
    expect(m.revpar).toBeCloseTo(28000 / 700, 6);
    // Count-dependent — undermined by the partial accumulation.
    expect(m.pOcc).toBeNull();
    expect(m.adr).toBeNull();
    expect(m.ooo).toBeNull();
  });

  it("returns nulls rather than dividing by zero on an empty portfolio", () => {
    const r = portfolioRollup([], "mtd");
    expect(r.pOcc).toBeNull();
    expect(r.adr).toBeNull();
    expect(r.revpar).toBeNull();
    expect(r.roomRev).toBe(0);
    expect(r.reporting).toBe(0);
    expect(r.total).toBe(0);
  });
});
