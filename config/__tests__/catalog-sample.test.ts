import { describe, it, expect } from "vitest";
import { CATALOG, CATALOG_BY_CATEGORY } from "@/config/catalog-sample";

describe("catalog-sample", () => {
  it("enumerates the full catalog", () => {
    expect(CATALOG.length).toBeGreaterThanOrEqual(90);
  });
  it("every metric has a unique key and a non-empty sample", () => {
    const keys = new Set<string>();
    for (const m of CATALOG) {
      expect(m.key).toMatch(/^[a-z0-9-]+$/);
      expect(keys.has(m.key)).toBe(false);
      keys.add(m.key);
      expect(m.name.length).toBeGreaterThan(0);
      expect(m.sample.length).toBeGreaterThan(0);
    }
  });
  it("groups cover every metric exactly once", () => {
    const grouped = CATALOG_BY_CATEGORY.flatMap((g) => g.metrics);
    expect(grouped.length).toBe(CATALOG.length);
  });
  it("formats samples by type", () => {
    const occ = CATALOG.find((m) => m.key === "occupancy");
    expect(occ?.sample).toMatch(/%$/);
  });
});
