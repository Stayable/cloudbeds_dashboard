import { describe, it, expect } from "vitest";
import { isValidYmd } from "./dates";

// The single definition of "is this a real calendar date" (see the function's
// own comment). lib/kb-parse.ts and lib/mcp/buckets.ts each used to carry a
// private copy of this exact check; both now import this one. These cases are
// the ones that bit this repo before consolidation — kept here so the
// canonical home has its own direct coverage, not just the two consumers'.
describe("isValidYmd", () => {
  it("accepts a real calendar date", () => {
    expect(isValidYmd("2026-08-10")).toBe(true);
  });

  it("accepts a leap day", () => {
    expect(isValidYmd("2028-02-29")).toBe(true);
  });

  it("rejects a shape that is not YYYY-MM-DD", () => {
    expect(isValidYmd("08/10/2026")).toBe(false);
    expect(isValidYmd("2026-8-10")).toBe(false);
    expect(isValidYmd("last tuesday")).toBe(false);
    expect(isValidYmd("")).toBe(false);
  });

  // Date.parse silently rolls Feb 30 forward to March 2 instead of returning
  // NaN, so shape-only validation would let this through.
  it("rejects a day-of-month overflow (Feb 30)", () => {
    expect(isValidYmd("2026-02-30")).toBe(false);
  });

  it("rejects a day-of-month overflow (Apr 31)", () => {
    expect(isValidYmd("2026-04-31")).toBe(false);
  });

  it("rejects a non-leap Feb 29", () => {
    expect(isValidYmd("2026-02-29")).toBe(false);
  });

  it("rejects a month overflow", () => {
    expect(isValidYmd("2026-13-01")).toBe(false);
  });
});
