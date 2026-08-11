import { describe, it, expect } from "vitest";
import { parseYmdArg, ymdArgSchema } from "./args";
import { McpArgError } from "./types";

describe("parseYmdArg", () => {
  it("returns a real calendar date unchanged", () => {
    expect(parseYmdArg("asOf", "2026-08-10")).toBe("2026-08-10");
  });

  it("names the argument and the bad value in the error, as McpArgError", () => {
    expect(() => parseYmdArg("asOf", "not-a-date")).toThrow(McpArgError);
    expect(() => parseYmdArg("asOf", "not-a-date")).toThrow(/asOf.*not-a-date/);
  });

  // Date.parse rolls Feb 30 forward to March 2 instead of erroring — the same
  // trap bucketRange and kb-parse guard against, via the same isValidYmd.
  it("rejects a calendar-impossible date (Feb 30), not just a malformed shape", () => {
    expect(() => parseYmdArg("from", "2026-02-30")).toThrow(McpArgError);
  });

  // Review finding (2026-08-11): this used to collapse both failure tiers
  // into one "must be a real calendar date" message, while bucketRange's
  // assertYmd (lib/mcp/buckets.ts) kept two distinct ones — same mistake,
  // different wording depending on which tool Rob called. Now aligned: a
  // shape failure and a calendar-impossible date get different, matching
  // wording in both places.
  it("distinguishes a malformed shape from a calendar-impossible date, matching assertYmd's wording", () => {
    expect(() => parseYmdArg("asOf", "last tuesday")).toThrow(/asOf must be a date in YYYY-MM-DD form/);
    expect(() => parseYmdArg("asOf", "2026-02-30")).toThrow(/asOf must be a real calendar date in YYYY-MM-DD form/);
  });
});

describe("ymdArgSchema", () => {
  it("accepts a real calendar date", () => {
    expect(ymdArgSchema.safeParse("2026-08-10").success).toBe(true);
  });

  it("rejects a calendar-impossible date", () => {
    expect(ymdArgSchema.safeParse("2026-02-30").success).toBe(false);
  });

  it("rejects a non-date string", () => {
    expect(ymdArgSchema.safeParse("last tuesday").success).toBe(false);
  });
});
