import { describe, it, expect, beforeAll } from "vitest";
import { requiredLevel, canAccess, homeForLevel, safeNextPath, signLevel, verifyCookie } from "@/lib/auth";

beforeAll(() => {
  process.env.AUTH_SECRET = "test-secret-please-change";
});

describe("safeNextPath", () => {
  it("passes valid same-site paths, rejects external", () => {
    expect(safeNextPath("/crystal")).toBe("/crystal");
    expect(safeNextPath("//evil.com")).toBe("/");
    expect(safeNextPath("https://evil.com")).toBe("/");
    expect(safeNextPath(null)).toBe("/");
    expect(safeNextPath("")).toBe("/");
  });
});

describe("requiredLevel", () => {
  it("maps /rob → exec, each user route → its level, else base", () => {
    expect(requiredLevel("/rob")).toBe("exec");
    expect(requiredLevel("/crystal")).toBe("crystal");
    expect(requiredLevel("/monica")).toBe("monica");
    expect(requiredLevel("/bea")).toBe("bea");
    expect(requiredLevel("/")).toBe("base");
    expect(requiredLevel("/api/feedback")).toBe("base");
    expect(requiredLevel("/ops")).toBe("ops");
  });
});

describe("homeForLevel", () => {
  it("routes each level to its own dashboard", () => {
    expect(homeForLevel("base")).toBe("/");
    expect(homeForLevel("exec")).toBe("/rob");
    expect(homeForLevel("crystal")).toBe("/crystal");
    expect(homeForLevel("monica")).toBe("/monica");
    expect(homeForLevel("bea")).toBe("/bea");
    expect(homeForLevel("ops")).toBe("/ops");
  });
});

describe("canAccess", () => {
  it("exec sees everything", () => {
    expect(canAccess("exec", "/")).toBe(true);
    expect(canAccess("exec", "/crystal")).toBe(true);
    expect(canAccess("exec", "/rob")).toBe(true);
  });
  it("a user level reaches its own route + the shared home, not other users'", () => {
    expect(canAccess("crystal", "/crystal")).toBe(true);
    expect(canAccess("crystal", "/monica")).toBe(false);
    expect(canAccess("crystal", "/")).toBe(true); // shared home visible to any authed level
  });
  it("base (MAIN pin) reaches the home but no per-user route", () => {
    expect(canAccess("base", "/")).toBe(true);
    expect(canAccess("base", "/rob")).toBe(false);
    expect(canAccess("base", "/crystal")).toBe(false);
  });
  it("ops reaches /ops + home, not other users'; exec still sees all", () => {
    expect(canAccess("ops", "/ops")).toBe(true);
    expect(canAccess("ops", "/monica")).toBe(false);
    expect(canAccess("ops", "/")).toBe(true);
    expect(canAccess("exec", "/ops")).toBe(true);
  });
});

describe("signed cookie (signLevel / verifyCookie)", () => {
  it("round-trips a level", async () => {
    const cookie = await signLevel("crystal");
    expect(cookie.startsWith("crystal.")).toBe(true);
    expect(await verifyCookie(cookie)).toBe("crystal");
  });
  it("rejects a tampered signature", async () => {
    const cookie = await signLevel("exec");
    const forged = "exec." + "0".repeat(cookie.split(".")[1].length);
    expect(await verifyCookie(forged)).toBe(null);
  });
  it("rejects a swapped level (signature won't match)", async () => {
    const cookie = await signLevel("bea");
    const swapped = "exec." + cookie.split(".")[1];
    expect(await verifyCookie(swapped)).toBe(null);
  });
  it("rejects missing / malformed / unknown-level cookies", async () => {
    expect(await verifyCookie(undefined)).toBe(null);
    expect(await verifyCookie("garbage")).toBe(null);
    expect(await verifyCookie("nope.deadbeef")).toBe(null);
  });
});
