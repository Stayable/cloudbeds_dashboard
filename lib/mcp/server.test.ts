import { describe, it, expect } from "vitest";
import { z } from "zod";
import { ALL_TOOLS, buildMcpServer } from "./server";
import type { McpToolDef } from "./types";

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

// Words that show up in a field name or a field's .describe() text when a
// tool has drifted into carrying guest/tenant identity or contact detail —
// the realistic mistakes, not just the literal word "guest": a field named
// `guestName` or `email` is just as much a leak as one named `guest`.
// Defensible set: guest/surname (name), email/phone (contact), reservation/
// folio (guest-scoped Cloudbeds objects), occupant/tenant (the other names
// this repo uses for the same person). Widen this list if a future PII
// review finds another synonym slipping through.
//
// `(?<!port)folio` — found while adding the Important-4 OUTPUT sweep below,
// which reuses this same pattern: get_occupancy/get_portfolio_summary's new
// `portfolio` field (Critical 2) contains "folio" as a bare substring
// ("port" + "folio"), so the un-anchored pattern flagged a legitimate,
// PII-free field name as a leak. The lookbehind excludes exactly that one
// collision without weakening the real check — "folioNumber", "guestFolio"
// etc. still match, because none of them are preceded by "port".
const PII_FIELD_PATTERN = /guest|surname|email|phone|reservation|(?<!port)folio|occupant|tenant/i;

/**
 * Walks every tool's inputSchema field-by-field — names AND each field's
 * .describe() text — checking for PII_FIELD_PATTERN. Throws (via a failed
 * `expect`, or directly) rather than returning a boolean, so a caller cannot
 * accidentally ignore the result the way review found the old inline check
 * effectively did.
 *
 * A schema that isn't a z.object (or one with no readable `.shape`) throws
 * outright instead of being skipped — an unintrospectable schema is exactly
 * where a guest field could hide, so "cannot check" must fail loudly, not
 * pass by default.
 *
 * Review finding (2026-08-11): the previous version of this check read
 * `t.inputSchema.description` — the description of the SCHEMA OBJECT itself.
 * No tool calls `.describe()` on its top-level `z.object({...})`, only on
 * individual fields, so that value was `undefined` for all ten tools and the
 * regex could never fire. Only the tool-NAME half of the old check ever did
 * anything. This version walks `.shape` instead, so a field like `guestName`
 * or one described as "the guest to look up" is caught even when the tool's
 * own name is innocuous.
 */
function assertNoGuestPii(tools: McpToolDef[]): void {
  for (const t of tools) {
    expect(t.name, t.name).not.toMatch(/guest|balance_due|who_owes/i);

    const shape = (t.inputSchema as unknown as { shape?: unknown })?.shape;
    if (!shape || typeof shape !== "object") {
      throw new Error(
        `${t.name}: inputSchema is not an introspectable z.object (no .shape) — ` +
          `refusing to skip the guest-PII field check rather than passing it by default.`,
      );
    }
    for (const [field, fieldSchema] of Object.entries(shape as Record<string, unknown>)) {
      const description = (fieldSchema as { description?: string })?.description ?? "";
      expect(field, `${t.name}.${field} (field name)`).not.toMatch(PII_FIELD_PATTERN);
      expect(description, `${t.name}.${field} (field description)`).not.toMatch(PII_FIELD_PATTERN);
    }
  }
}

/** Minimal valid McpToolDef for the regression tests below — only the shape
 *  assertNoGuestPii actually reads (name, inputSchema) needs to be real. */
function fakeTool(overrides: Partial<McpToolDef>): McpToolDef {
  return {
    name: "get_something_harmless",
    title: "t",
    description: "a fake tool built only to exercise assertNoGuestPii",
    inputSchema: z.object({}),
    handler: async () => ({ data: {}, freshness: { source: "config" as const, asOf: null, note: "x" } }),
    ...overrides,
  };
}

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
    assertNoGuestPii(ALL_TOOLS);
  });

  it("describes a freshness expectation in the payload type of every handler", () => {
    // Structural check: every handler is an async function of arity <= 1.
    for (const t of ALL_TOOLS) {
      expect(typeof t.handler, t.name).toBe("function");
      expect(t.handler.length, t.name).toBeLessThanOrEqual(1);
    }
  });
});

// Regression coverage for the 2026-08-11 review finding: proves
// assertNoGuestPii actually catches a schema-level leak, not just a
// suspicious tool name. Each "catches" case is the RED the review asked for
// — run against the pre-fix inline check (t.inputSchema.description, the
// schema object's own description) these would all have passed silently.
describe("the guest-PII field check", () => {
  it("catches a guest-identifying FIELD NAME even when the tool's own name is innocent", () => {
    const bad = fakeTool({ inputSchema: z.object({ guestName: z.string() }) });
    expect(() => assertNoGuestPii([bad])).toThrow(/guestName/);
  });

  it("catches a PII word in a field's .describe() text, not just its name", () => {
    const bad = fakeTool({
      inputSchema: z.object({ who: z.string().describe("the guest to look up") }),
    });
    expect(() => assertNoGuestPii([bad])).toThrow(/who/);
  });

  it("catches the widened synonyms (email, phone, reservation, folio, occupant, tenant)", () => {
    for (const field of ["email", "phone", "reservationId", "folioNumber", "occupantName", "tenantId"]) {
      const bad = fakeTool({ inputSchema: z.object({ [field]: z.string() }) });
      expect(() => assertNoGuestPii([bad]), field).toThrow();
    }
  });

  it("fails loudly on a schema it cannot introspect, rather than passing it by default", () => {
    // z.string() has no .shape — the exact case a future non-object
    // inputSchema (or a mocking mistake) would produce.
    const bad = fakeTool({ inputSchema: z.string() as any });
    expect(() => assertNoGuestPii([bad])).toThrow(/introspectable/);
  });

  it("still passes a tool with an ordinary date/property schema", () => {
    const fine = fakeTool({
      inputSchema: z.object({
        from: z.string().describe("Start date, YYYY-MM-DD."),
        properties: z.array(z.string()).optional(),
      }),
    });
    expect(() => assertNoGuestPii([fine])).not.toThrow();
  });
});

/**
 * Final review, Important 4: `assertNoGuestPii` only ever walked each tool's
 * INPUT schema — spec §6 promised a test asserting no tool's OUTPUT contains
 * a name-shaped field, and that half was never built. Critical 3 (the
 * contractor schedule forwarding a WhatsApp free-text column) is exactly the
 * shape of leak this gap let through: an input-schema sweep can never see it,
 * because the leak lives entirely in what a handler RETURNS.
 *
 * Calls every handler through the SAME wrapped path a real MCP request takes
 * (buildMcpServer's registerTool callback — mirroring "the freshness guard"
 * block below), with a minimal valid argument set, and regexes the serialized
 * response text against PII_FIELD_PATTERN. Every I/O boundary in this surface
 * already degrades to a safe default or a scrubbed error on a dead
 * DB/Cloudbeds/Smartsheet (freshness.ts, error-mapper.ts, and the try/catch on
 * every lib/db.ts query) — verified by running this with none of
 * DATABASE_URL / CLOUDBEDS_API_KEY_* / SMARTSHEET_API_TOKEN set, exactly this
 * repo's default local/CI environment.
 */
describe("the tool manifest's OUTPUT (Important 4)", () => {
  const MINIMAL_ARGS: Record<string, unknown> = {
    list_properties: {},
    get_occupancy: { from: "2026-08-01", to: "2026-08-01" },
    get_portfolio_summary: {},
    get_daily_report: {},
    get_report_file: {},
    get_today: {},
    get_evictions: {},
    get_contractor_schedule: {},
    get_reviews: {},
    get_leasing_funnel: {},
  };

  it("has an argument set for every tool currently in the manifest", () => {
    // A tool added later with no entry above would otherwise be silently
    // skipped by the sweep below rather than failing loudly.
    expect(Object.keys(MINIMAL_ARGS).sort()).toEqual(ALL_TOOLS.map((t) => t.name).sort());
  });

  it("no tool's output contains a name-shaped field, called end to end with no live credentials", async () => {
    const registered: Record<string, (a: unknown) => Promise<any>> = {};
    const fakeServer = {
      registerTool: (name: string, _cfg: unknown, handler: (a: unknown) => Promise<any>) => {
        registered[name] = handler;
      },
    };
    buildMcpServer(fakeServer as any);

    for (const tool of ALL_TOOLS) {
      const res = await registered[tool.name](MINIMAL_ARGS[tool.name]);
      const text = res.content?.[0]?.text as string;
      expect(text, `${tool.name} returned no text content`).toBeTruthy();
      expect(text, `${tool.name} output`).not.toMatch(PII_FIELD_PATTERN);
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
