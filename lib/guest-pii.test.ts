import { describe, expect, it } from "vitest";
import { ALL_LEVELS, type Level } from "./auth";
import { GUEST_PII_LEVELS, canViewGuestPii } from "./guest-pii";

describe("canViewGuestPii", () => {
  it("allows every internal staff level", () => {
    for (const level of ["base", "exec", "admin", "crystal", "monica", "bea", "ops"] as Level[]) {
      expect(canViewGuestPii(level), level).toBe(true);
    }
  });

  it("DENIES elise — it is an external vendor level (EliseAI support)", () => {
    // lib/auth.ts puts `elise` in RESTRICTED_LEVELS for external/vendor access.
    // Guest names there would disclose Stayable guest data to a third party.
    expect(canViewGuestPii("elise")).toBe(false);
  });

  it("denies null — unauthenticated, or any token-only path", () => {
    // /report's signFileToken mints PIN-less links. Those resolve to no level.
    expect(canViewGuestPii(null)).toBe(false);
  });

  it("denies undefined the same way, rather than throwing", () => {
    expect(canViewGuestPii(undefined)).toBe(false);
  });

  it("denies a level it has never heard of", () => {
    expect(canViewGuestPii("vendor-x" as Level)).toBe(false);
  });

  it("is an ALLOWLIST, so a future level is denied until decided deliberately", () => {
    // The point of this test: if someone adds a level to ALL_LEVELS and does not
    // add it to GUEST_PII_LEVELS, guest PII stays shut. Fails closed. If this
    // test fails, a new level appeared — decide about it, do not delete the test.
    const undecided = ALL_LEVELS.filter((l) => !GUEST_PII_LEVELS.has(l) && l !== "elise");
    expect(undecided).toEqual([]);
  });

  it("denies everything not in the allowlist, for every level in ALL_LEVELS", () => {
    for (const level of ALL_LEVELS) {
      expect(canViewGuestPii(level), level).toBe(GUEST_PII_LEVELS.has(level));
    }
  });
});
