import { describe, it, expect } from "vitest";
import { resolveProperty, resolveProperties, propertySummary } from "./properties";
import { McpArgError } from "./types";
import { PROPERTIES } from "@/config/properties";

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
  it("returns every active property when given nothing", () => {
    const all = resolveProperties();
    expect(all.length).toBe(PROPERTIES.filter((p) => p.active === true).length);
  });

  it("returns the named subset, de-duplicated", () => {
    const some = resolveProperties(["Lakeland", "4645", "Davenport"]);
    expect(some.map((p) => p.id).sort()).toEqual(["4645", "44199"].sort());
  });

  it("propagates the error for one bad name in a list", () => {
    expect(() => resolveProperties(["Lakeland", "Nowhere"])).toThrow(McpArgError);
  });
});

describe("propertySummary", () => {
  it("exposes identity fields and nothing else", () => {
    const s = propertySummary(PROPERTIES.find((p) => p.id === "4645")!);
    expect(Object.keys(s).sort()).toEqual(["active", "code", "county", "id", "name"]);
  });
});
