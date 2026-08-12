import { describe, it, expect, vi, beforeEach } from "vitest";

// Gate helpers are mocked so these tests exercise the middleware's own routing
// decisions rather than cookie signing. gateEnabled() returns true so the auth
// path is live — otherwise middleware short-circuits and proves nothing.
const verifyCookie = vi.fn();
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    gateEnabled: () => true,
    verifyCookie: (...a: unknown[]) => verifyCookie(...a),
  };
});

import { middleware, OAUTH_DISCOVERY_PREFIX } from "../../middleware";
import type { NextRequest } from "next/server";

function req(pathname: string, cookie?: string): NextRequest {
  const url = new URL(`https://dashboard.rentstayable.com${pathname}`);
  return {
    nextUrl: {
      pathname: url.pathname,
      search: url.search,
      clone: () => new URL(url.toString()),
    },
    cookies: { get: () => (cookie ? { value: cookie } : undefined) },
  } as unknown as NextRequest;
}

beforeEach(() => {
  verifyCookie.mockReset();
  verifyCookie.mockResolvedValue(null); // unauthenticated by default
});

// THE 08/13/26 BUG. These paths used to fall through to the PIN gate, which
// 307s to /login and serves 200 HTML. Claude Desktop read that 200 as proof an
// OAuth authorization server existed, attempted Dynamic Client Registration
// against a login page, and failed with "Couldn't register with <server>'s
// sign-in service". A 404 is what tells the client there is no OAuth here.
describe("OAuth discovery probes", () => {
  const paths = [
    "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-authorization-server",
    "/.well-known/oauth-protected-resource/api/mcp",
  ];

  for (const p of paths) {
    it(`404s ${p} instead of redirecting to the login page`, async () => {
      const res = await middleware(req(p));
      expect(res.status).toBe(404);
      // Specifically NOT a redirect — a 3xx here is the bug returning.
      expect(res.headers.get("location")).toBeNull();
    });
  }

  it("404s them even for an authenticated caller, so the answer never varies", async () => {
    verifyCookie.mockResolvedValue("admin");
    const res = await middleware(req(OAUTH_DISCOVERY_PREFIX + "-protected-resource"));
    expect(res.status).toBe(404);
  });

  // The guard is prefix-scoped on purpose; it must not swallow other
  // .well-known paths that may be served legitimately later.
  it("does not intercept unrelated .well-known paths", async () => {
    const res = await middleware(req("/.well-known/security.txt"));
    expect(res.status).not.toBe(404);
  });
});

describe("the PIN gate still works", () => {
  it("redirects an unauthenticated page request to /login with a next param", async () => {
    const res = await middleware(req("/connectors"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
    expect(res.headers.get("location")).toContain("next=%2Fconnectors");
  });

  it("lets an authorised level through", async () => {
    verifyCookie.mockResolvedValue("admin");
    const res = await middleware(req("/connectors"));
    expect(res.headers.get("location")).toBeNull();
  });

  it("redirects a level that may not see the path", async () => {
    verifyCookie.mockResolvedValue("exec"); // exec is barred from /connectors
    const res = await middleware(req("/connectors"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });
});
