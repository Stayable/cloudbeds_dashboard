import { describe, it, expect } from "vitest";
import { resolveProperty, resolveProperties, propertySummary } from "./properties";
import { McpArgError } from "./types";
import { PROPERTIES, type Property } from "@/config/properties";

describe("resolveProperty", () => {
  it("resolves by business id", () => {
    expect(resolveProperty("4645").name).toBe("Lakeland");
  });

  it("resolves by name, case-insensitively and ignoring surrounding space", () => {
    expect(resolveProperty("  lakeland ").id).toBe("4645");
  });

  it("resolves by short code", () => {
    const dp = PROPERTIES.find((p) => p.id === "44199")!;
    expect(resolveProperty(dp.code).id).toBe("44199");
  });

  it("resolves a distinctive partial name", () => {
    expect(resolveProperty("davenport").id).toBe("44199");
  });

  // "ke" is Kissimmee East's exact code AND a substring of "Lakeland". Pins
  // exact-before-partial so a future reordering cannot silently regress it.
  it("resolves an exact code even when it is also a substring of another property's name", () => {
    expect(resolveProperty("ke").name).toBe("Kissimmee East");
  });

  it("resolves by the Cloudbeds API property id", () => {
    const dp = PROPERTIES.find((p) => p.id === "44199")!;
    expect(dp.apiPropertyId).not.toBeNull();
    expect(resolveProperty(dp.apiPropertyId!).id).toBe("44199");
  });

  // "Kissimmee" matches both East and West. Guessing one would answer a
  // question the user did not ask, with no sign anything went wrong.
  it("refuses an ambiguous partial and names the candidates", () => {
    try {
      resolveProperty("kissimmee");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(McpArgError);
      expect((e as Error).message).toMatch(/Kissimmee East/);
      expect((e as Error).message).toMatch(/Kissimmee West/);
    }
  });

  it("errors on an unknown property and lists the valid ones", () => {
    try {
      resolveProperty("Lakeside");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(McpArgError);
      expect((e as Error).message).toMatch(/Lakeside/);
      expect((e as Error).message).toMatch(/Lakeland/);
      expect((e as Error).message).toMatch(/Orlando OBT/);
    }
  });

  it("errors on an empty string rather than returning something", () => {
    expect(() => resolveProperty("   ")).toThrow(McpArgError);
  });
});

describe("resolveProperties", () => {
  it("returns every active property when given nothing, with nothing excluded (today's real data)", () => {
    const { properties, excluded } = resolveProperties();
    expect(properties.length).toBe(PROPERTIES.filter((p) => p.active === true).length);
    expect(excluded).toEqual([]);
  });

  it("returns the named subset, de-duplicated, with excluded always empty", () => {
    const { properties, excluded } = resolveProperties(["Lakeland", "4645", "Davenport"]);
    expect(properties.map((p) => p.id).sort()).toEqual(["4645", "44199"].sort());
    expect(excluded).toEqual([]);
  });

  it("propagates the error for one bad name in a list", () => {
    expect(() => resolveProperties(["Lakeland", "Nowhere"])).toThrow(McpArgError);
  });

  // The real PROPERTIES list has all 8 at active:true today, so a test against
  // it alone would still pass with the active-filter deleted entirely. This
  // points resolveProperties at a fixture to prove the filter is actually
  // doing something: a property short of active:true must land in `excluded`,
  // not silently vanish from `properties`.
  it("excludes anything short of active:true rather than dropping it silently", () => {
    const fixture: Property[] = [
      { id: "1", code: "AA", apiPropertyId: null, name: "Alpha", county: "X", active: true },
      { id: "2", code: "BB", apiPropertyId: null, name: "Beta", county: "Y", active: "unconfirmed" },
      { id: "3", code: "CC", apiPropertyId: null, name: "Gamma", county: "Z", active: false },
    ];
    const { properties, excluded } = resolveProperties(undefined, fixture);
    expect(properties.map((p) => p.id)).toEqual(["1"]);
    expect(excluded.map((p) => p.id).sort()).toEqual(["2", "3"]);
  });
});

describe("propertySummary", () => {
  it("exposes identity fields and nothing else", () => {
    const s = propertySummary(PROPERTIES.find((p) => p.id === "4645")!);
    expect(Object.keys(s).sort()).toEqual(["active", "code", "county", "id", "name"]);
  });
});
