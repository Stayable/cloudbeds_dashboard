import { describe, it, expect, beforeAll } from "vitest";
import {
  requiredLevel,
  canAccess,
  homeForLevel,
  safeNextPath,
  signLevel,
  verifyCookie,
  accessiblePages,
} from "@/lib/auth";

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
    expect(requiredLevel("/elise")).toBe("elise");
  });
});

describe("homeForLevel", () => {
  it("everyone lands on the shared Home after login, except elise → /elise", () => {
    expect(homeForLevel("base")).toBe("/");
    expect(homeForLevel("exec")).toBe("/");
    expect(homeForLevel("crystal")).toBe("/");
    expect(homeForLevel("monica")).toBe("/");
    expect(homeForLevel("bea")).toBe("/");
    expect(homeForLevel("ops")).toBe("/");
    expect(homeForLevel("elise")).toBe("/elise");
  });
});

describe("canAccess", () => {
  it("exec sees everything except /elise", () => {
    expect(canAccess("exec", "/")).toBe(true);
    expect(canAccess("exec", "/crystal")).toBe(true);
    expect(canAccess("exec", "/monica")).toBe(true);
    expect(canAccess("exec", "/rob")).toBe(true);
    expect(canAccess("exec", "/elise")).toBe(false); // /elise reserved for the ELISE pin — not even exec
  });
  it("a user level reaches its own route + the shared home, not other users'", () => {
    expect(canAccess("crystal", "/crystal")).toBe(true);
    expect(canAccess("crystal", "/monica")).toBe(false);
    expect(canAccess("crystal", "/")).toBe(true); // shared home visible to any authed level
    expect(canAccess("crystal", "/ops")).toBe(true);
  });
  it("base (MAIN pin) reaches shared pages but no per-user or exec route", () => {
    expect(canAccess("base", "/")).toBe(true);
    expect(canAccess("base", "/ops")).toBe(true);
    expect(canAccess("base", "/report")).toBe(true);
    expect(canAccess("base", "/rob")).toBe(false);
    expect(canAccess("base", "/crystal")).toBe(false);
    expect(canAccess("base", "/elise")).toBe(false);
  });
  it("ops reaches shared pages, not other users'; exec still sees all", () => {
    expect(canAccess("ops", "/ops")).toBe(true);
    expect(canAccess("ops", "/monica")).toBe(false);
    expect(canAccess("ops", "/")).toBe(true);
    expect(canAccess("exec", "/ops")).toBe(true);
  });
  it("elise is fully isolated: reaches ONLY /elise, not even the shared home; exec is denied /elise", () => {
    expect(canAccess("elise", "/elise")).toBe(true);
    expect(canAccess("elise", "/")).toBe(false);
    expect(canAccess("elise", "/ops")).toBe(false);
    expect(canAccess("crystal", "/")).toBe(true); // unrestricted per-user levels unaffected
    expect(canAccess("exec", "/elise")).toBe(false); // reserved for the ELISE pin only
  });
});

describe("accessiblePages", () => {
  it("base/ops see only the shared pages", () => {
    const shared = [
      { href: "/", label: "Home" },
      { href: "/ops", label: "Operations" },
      { href: "/report", label: "Revenue Report" },
      { href: "/kb", label: "Knowledgebase" },
    ];
    expect(accessiblePages("base")).toEqual(shared);
    expect(accessiblePages("ops")).toEqual(shared);
  });
  it("a personal level sees shared pages + its own dashboard, not others'", () => {
    const hrefs = accessiblePages("monica").map((p) => p.href);
    expect(hrefs).toContain("/monica");
    expect(hrefs).not.toContain("/crystal");
    expect(hrefs).not.toContain("/bea");
    expect(hrefs).not.toContain("/rob");
  });
  it("exec sees shared + every personal dashboard + /rob", () => {
    const hrefs = accessiblePages("exec").map((p) => p.href);
    expect(hrefs).toEqual(expect.arrayContaining(["/", "/ops", "/report", "/crystal", "/monica", "/bea", "/rob"]));
  });
  it("elise sees only /elise", () => {
    expect(accessiblePages("elise")).toEqual([{ href: "/elise", label: "EliseAI Leasing" }]);
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
