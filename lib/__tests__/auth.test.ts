import { describe, it, expect } from "vitest";
import { tokenFor, requiredLevel, decideAccess, safeNextPath, homeForLevel, canAccess } from "@/lib/auth";

describe("homeForLevel", () => {
  it("routes each level to its own dashboard", () => {
    expect(homeForLevel("base")).toBe("/");
    expect(homeForLevel("exec")).toBe("/rob");
    expect(homeForLevel("crystal")).toBe("/crystal");
    expect(homeForLevel("monica")).toBe("/monica");
    expect(homeForLevel("bea")).toBe("/bea");
  });
});

describe("canAccess", () => {
  it("exec sees everything", () => {
    expect(canAccess("exec", "/")).toBe(true);
    expect(canAccess("exec", "/crystal")).toBe(true);
    expect(canAccess("exec", "/rob")).toBe(true);
  });
  it("a user level reaches only its own route", () => {
    expect(canAccess("crystal", "/crystal")).toBe(true);
    expect(canAccess("crystal", "/monica")).toBe(false);
    expect(canAccess("crystal", "/")).toBe(false); // user levels don't reach base
  });
  it("base reaches base only", () => {
    expect(canAccess("base", "/")).toBe(true);
    expect(canAccess("base", "/rob")).toBe(false);
  });
});

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
  it("requires exec for /rob, each user's level for their route, base otherwise", () => {
    expect(requiredLevel("/rob")).toBe("exec"); // CEO's own view, exec-gated
    expect(requiredLevel("/crystal")).toBe("crystal");
    expect(requiredLevel("/crystal/anything")).toBe("crystal");
    expect(requiredLevel("/monica")).toBe("monica");
    expect(requiredLevel("/bea")).toBe("bea");
    expect(requiredLevel("/")).toBe("base");
    expect(requiredLevel("/api/feedback")).toBe("base");
  });
});

describe("decideAccess", () => {
  const base = "BASE_TOKEN";
  const exec = "EXEC_TOKEN";
  const crystal = "CRYSTAL_TOKEN";
  const monica = "MONICA_TOKEN";
  const tok = (over = {}) => ({ base, exec, users: { crystal, monica, ...over } });

  it("allows everything when the gate is disabled (no base pin)", () => {
    expect(decideAccess("/rob", undefined, { base: null, exec: null, users: {} })).toBe("allow");
  });
  it("base token reaches base routes but not rob or a user route", () => {
    expect(decideAccess("/", base, tok())).toBe("allow");
    expect(decideAccess("/rob", base, tok())).toBe("deny");
    expect(decideAccess("/crystal", base, tok())).toBe("deny");
  });
  it("exec token reaches base, rob, and every user route (CEO sees everything)", () => {
    expect(decideAccess("/", exec, tok())).toBe("allow");
    expect(decideAccess("/rob", exec, tok())).toBe("allow");
    expect(decideAccess("/crystal", exec, tok())).toBe("allow");
    expect(decideAccess("/monica", exec, tok())).toBe("allow");
  });
  it("a user token reaches only that user's route", () => {
    expect(decideAccess("/crystal", crystal, tok())).toBe("allow");
    expect(decideAccess("/monica", crystal, tok())).toBe("deny");
    expect(decideAccess("/", crystal, tok())).toBe("deny");
    expect(decideAccess("/rob", crystal, tok())).toBe("deny");
  });
  it("denies unknown/empty token on gated routes", () => {
    expect(decideAccess("/", undefined, tok())).toBe("deny");
    expect(decideAccess("/rob", "garbage", tok())).toBe("deny");
    expect(decideAccess("/crystal", "garbage", tok())).toBe("deny");
  });
  it("when a user PIN is unset, that route falls back to exec only", () => {
    expect(decideAccess("/bea", exec, tok({ bea: exec }))).toBe("allow");
    expect(decideAccess("/bea", base, tok({ bea: exec }))).toBe("deny");
  });
});
