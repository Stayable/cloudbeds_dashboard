import { describe, it, expect } from "vitest";
import { buildFinanceViews } from "@/lib/finance";
import type { PropertyFinance } from "@/lib/cloudbeds";

function fin(code: string, name: string, charges: number): PropertyFinance {
  return {
    property: { code, name } as PropertyFinance["property"],
    configured: true,
    result: {
      ok: true,
      data: {
        charges,
        paymentsCredits: charges * 0.9,
        net: charges * 0.1,
        typeMix: { "Room Rate": charges },
        paymentMethodMix: { Card: charges * 0.9 },
      },
    },
  };
}

describe("buildFinanceViews", () => {
  it("returns [ALL, ...per property] with ALL merged", () => {
    const views = buildFinanceViews([
      fin("DP", "Davenport", 1000),
      fin("OBT", "Orlando OBT", 500),
      { property: { code: "X" } as PropertyFinance["property"], configured: false, result: null },
    ]);
    expect(views.map((v) => v.key)).toEqual(["ALL", "DP", "OBT"]);
    expect(views[0].charges).toBe(1500);
    expect(views[0].typeMix).toEqual({ "Room Rate": 1500 });
    expect(views[1].charges).toBe(1000);
  });

  it("empty when nothing reports", () => {
    expect(
      buildFinanceViews([
        { property: { code: "X" } as PropertyFinance["property"], configured: true, result: { ok: false, status: 0, error: "x" } },
      ]),
    ).toEqual([]);
  });
});
