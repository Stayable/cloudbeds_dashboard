import { describe, it, expect } from "vitest";
import { tokenFor, requiredLevel, decideAccess, safeNextPath } from "@/lib/auth";

describe("safeNextPath", () => {
  it('passes through valid same-site paths', () => {
    expect(safeNextPath("/exec")).toBe("/exec");
    expect(safeNextPath("/")).toBe("/");
  });
  it('rejects protocol-relative URLs (//host)', () => {
    expect(safeNextPath("//evil.com")).toBe("/");
  });
  it('rejects absolute URLs', () => {
    expect(safeNextPath("https://evil.com")).toBe("/");
  });
  it('returns "/" for null', () => {
    expect(safeNextPath(null)).toBe("/");
  });
  it('returns "/" for undefined', () => {
    expect(safeNextPath(undefined)).toBe("/");
  });
  it('returns "/" for empty string', () => {
    expect(safeNextPath("")).toBe("/");
  });
});

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
  it("requires exec for /exec routes, crystal for /crystal, base otherwise", () => {
    expect(requiredLevel("/exec")).toBe("exec");
    expect(requiredLevel("/exec/anything")).toBe("exec");
    expect(requiredLevel("/rob")).toBe("exec"); // CEO's own view, exec-gated
    expect(requiredLevel("/crystal")).toBe("crystal");
    expect(requiredLevel("/crystal/anything")).toBe("crystal");
    expect(requiredLevel("/")).toBe("base");
    expect(requiredLevel("/api/feedback")).toBe("base");
  });
});

describe("decideAccess", () => {
  const base = "BASE_TOKEN";
  const exec = "EXEC_TOKEN";
  const crystal = "CRYSTAL_TOKEN";

  it("allows everything when the gate is disabled (no base pin)", () => {
    expect(decideAccess("/exec", undefined, { base: null, exec: null, crystal: null })).toBe("allow");
  });
  it("base token reaches base routes but not exec or crystal", () => {
    expect(decideAccess("/", base, { base, exec, crystal })).toBe("allow");
    expect(decideAccess("/exec", base, { base, exec, crystal })).toBe("deny");
    expect(decideAccess("/crystal", base, { base, exec, crystal })).toBe("deny");
  });
  it("exec token reaches base, exec, and crystal (CEO sees everything)", () => {
    expect(decideAccess("/", exec, { base, exec, crystal })).toBe("allow");
    expect(decideAccess("/exec", exec, { base, exec, crystal })).toBe("allow");
    expect(decideAccess("/crystal", exec, { base, exec, crystal })).toBe("allow");
  });
  it("crystal token reaches /crystal only (not base or exec)", () => {
    expect(decideAccess("/crystal", crystal, { base, exec, crystal })).toBe("allow");
    expect(decideAccess("/", crystal, { base, exec, crystal })).toBe("deny");
    expect(decideAccess("/exec", crystal, { base, exec, crystal })).toBe("deny");
  });
  it("denies unknown/empty token on gated routes", () => {
    expect(decideAccess("/", undefined, { base, exec, crystal })).toBe("deny");
    expect(decideAccess("/exec", "garbage", { base, exec, crystal })).toBe("deny");
    expect(decideAccess("/crystal", "garbage", { base, exec, crystal })).toBe("deny");
  });
  it("when EXEC_PIN is unset, exec falls back to the base token (never locks out)", () => {
    expect(decideAccess("/exec", base, { base, exec: base, crystal })).toBe("allow");
  });
  it("when CRYSTAL_PIN is unset, crystal falls back to exec (only exec/CEO reaches /crystal)", () => {
    expect(decideAccess("/crystal", exec, { base, exec, crystal: exec })).toBe("allow");
    expect(decideAccess("/crystal", base, { base, exec, crystal: exec })).toBe("deny");
  });
});
