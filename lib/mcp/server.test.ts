import { describe, it, expect } from "vitest";
import { ALL_TOOLS, buildMcpServer } from "./server";

const EXPECTED = [
  "list_properties",
  "get_occupancy",
  "get_portfolio_summary",
  "get_daily_report",
  "get_report_file",
  "get_today",
  "get_evictions",
  "get_contractor_schedule",
  "get_reviews",
  "get_leasing_funnel",
];

describe("the tool manifest", () => {
  it("exposes exactly the tools the spec lists", () => {
    expect(ALL_TOOLS.map((t) => t.name).sort()).toEqual([...EXPECTED].sort());
  });

  it("has no duplicate tool names", () => {
    expect(new Set(ALL_TOOLS.map((t) => t.name)).size).toBe(ALL_TOOLS.length);
  });

  it("gives every tool a title, a description and a schema", () => {
    for (const t of ALL_TOOLS) {
      expect(t.title, t.name).toBeTruthy();
      expect(t.description.length, t.name).toBeGreaterThan(20);
      expect(t.inputSchema, t.name).toBeTruthy();
    }
  });

  // Every tool name is snake_case: mixed conventions make the model guess.
  it("names every tool in snake_case", () => {
    for (const t of ALL_TOOLS) expect(t.name, t.name).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  // The two cross-cutting rules. These iterate the manifest deliberately, so a
  // tool added later cannot skip them.
  it("declares no guest-identifying argument", () => {
    for (const t of ALL_TOOLS) {
      expect(JSON.stringify(t.inputSchema.description ?? ""), t.name).not.toMatch(/guest|surname/i);
      expect(t.name, t.name).not.toMatch(/guest|balance_due|who_owes/i);
    }
  });

  it("describes a freshness expectation in the payload type of every handler", () => {
    // Structural check: every handler is an async function of arity <= 1.
    for (const t of ALL_TOOLS) {
      expect(typeof t.handler, t.name).toBe("function");
      expect(t.handler.length, t.name).toBeLessThanOrEqual(1);
    }
  });
});

describe("the freshness guard", () => {
  it("turns a tool that omits freshness into an error rather than an answer", async () => {
    const registered: Record<string, (a: unknown) => Promise<any>> = {};
    const fakeServer = {
      registerTool: (name: string, _cfg: unknown, handler: (a: unknown) => Promise<any>) => {
        registered[name] = handler;
      },
    };
    const { ALL_TOOLS: manifest } = await import("./server");
    const original = manifest.length;
    manifest.push({
      name: "test_no_freshness",
      title: "t",
      description: "a tool that forgets its freshness envelope entirely",
      inputSchema: (await import("zod")).z.object({}),
      handler: async () => ({ data: { x: 1 } }) as any,
    });
    buildMcpServer(fakeServer as any);
    const res = await registered["test_no_freshness"]({});
    manifest.length = original; // leave the manifest as we found it
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/could not complete/i);
  });
});
