import { describe, it, expect, vi, beforeEach } from "vitest";

// Mirrors the neon mock in lib/__tests__/db.test.ts: `neon(url)` returns a
// tagged-template function. We don't care what SQL is sent — only what rows
// come back — so the mock ignores its template-tag arguments entirely.
let rows: { level: string; pin: string }[] = [];
let shouldThrow = false;

vi.mock("@neondatabase/serverless", () => ({
  neon: () => () => {
    if (shouldThrow) return Promise.reject(new Error("DB down"));
    return Promise.resolve(rows);
  },
}));

import { findLevelByPin } from "./pins";
import { ALL_LEVELS } from "./auth";

beforeEach(() => {
  rows = [];
  shouldThrow = false;
  process.env.DATABASE_URL = "postgresql://test";
});

describe("findLevelByPin", () => {
  // THE LOAD-BEARING ONE. findLevelByPin walks a hardcoded `order` array that
  // must contain every member of ALL_LEVELS. This test derives its expectation
  // from ALL_LEVELS itself — never a hardcoded list of level names — so if a
  // future level is added to ALL_LEVELS and forgotten in pins.ts's `order`,
  // this test fails instead of silently locking that level out (Finding 1:
  // "admin" was added to ALL_LEVELS but missing from `order`, so ILLUSTRIOUS
  // 401'd and nobody could open /connectors).
  it("resolves every level in ALL_LEVELS when that level has a PIN row", async () => {
    rows = ALL_LEVELS.map((level, i) => ({ level, pin: `pin-${i}` }));
    for (let i = 0; i < ALL_LEVELS.length; i++) {
      expect(await findLevelByPin(`pin-${i}`)).toBe(ALL_LEVELS[i]);
    }
  });

  // Proves the actual admin PIN string resolves to "admin", not just that the
  // generic loop above happens to cover it.
  it("resolves ILLUSTRIOUS to admin", async () => {
    rows = [{ level: "admin", pin: "ILLUSTRIOUS" }];
    expect(await findLevelByPin("ILLUSTRIOUS")).toBe("admin");
  });

  it("returns null for an unknown PIN", async () => {
    rows = [{ level: "base", pin: "MAIN" }];
    expect(await findLevelByPin("definitely-not-a-pin")).toBeNull();
  });

  it("returns null for an empty PIN", async () => {
    rows = [{ level: "base", pin: "MAIN" }];
    expect(await findLevelByPin("")).toBeNull();
  });

  it("returns null rather than throwing when the DB fails", async () => {
    shouldThrow = true;
    await expect(findLevelByPin("MAIN")).resolves.toBeNull();
  });
});
