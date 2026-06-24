import { describe, it, expect } from "vitest";
import { tokenFor, requiredLevel, decideAccess } from "@/lib/auth";

describe("tokenFor", () => {
  it("is deterministic and level-scoped", async () => {
    const base = await tokenFor("base", "1234");
    const exec = await tokenFor("exec", "1234");
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    expect(base).not.toBe(exec); // same PIN, different level => different token
    expect(await tokenFor("base", "1234")).toBe(base);
  });
});

describe("requiredLevel", () => {
  it("requires exec for /exec routes, base otherwise", () => {
    expect(requiredLevel("/exec")).toBe("exec");
    expect(requiredLevel("/exec/anything")).toBe("exec");
    expect(requiredLevel("/")).toBe("base");
    expect(requiredLevel("/api/feedback")).toBe("base");
  });
});

describe("decideAccess", () => {
  const base = "BASE_TOKEN";
  const exec = "EXEC_TOKEN";

  it("allows everything when the gate is disabled (no base pin)", () => {
    expect(decideAccess("/exec", undefined, { base: null, exec: null })).toBe("allow");
  });
  it("base token reaches base routes but not exec", () => {
    expect(decideAccess("/", base, { base, exec })).toBe("allow");
    expect(decideAccess("/exec", base, { base, exec })).toBe("deny");
  });
  it("exec token reaches both base and exec routes", () => {
    expect(decideAccess("/", exec, { base, exec })).toBe("allow");
    expect(decideAccess("/exec", exec, { base, exec })).toBe("allow");
  });
  it("denies unknown/empty token on gated routes", () => {
    expect(decideAccess("/", undefined, { base, exec })).toBe("deny");
    expect(decideAccess("/exec", "garbage", { base, exec })).toBe("deny");
  });
  it("when EXEC_PIN is unset, exec falls back to the base token (never locks out)", () => {
    expect(decideAccess("/exec", base, { base, exec: base })).toBe("allow");
  });
});
