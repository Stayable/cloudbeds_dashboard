import { describe, it, expect, vi, beforeEach } from "vitest";

const verifyCookie = vi.fn();
const revokeToken = vi.fn();
const cookieGet = vi.fn();

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => cookieGet(n) }),
}));
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, verifyCookie: (...a: unknown[]) => verifyCookie(...a) };
});
vi.mock("@/lib/mcp/tokens", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mcp/tokens")>();
  return { ...actual, revokeToken: (...a: unknown[]) => revokeToken(...a) };
});

import { POST } from "./route";

function post(id: string) {
  return POST(new Request(`http://localhost/api/connectors/${id}/revoke`, { method: "POST" }), {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => {
  verifyCookie.mockReset();
  revokeToken.mockReset();
  cookieGet.mockReset();
  cookieGet.mockReturnValue({ value: "admin.sig" });
  verifyCookie.mockResolvedValue("admin");
});

describe("POST /api/connectors/[id]/revoke", () => {
  it("revokes the token", async () => {
    const res = await post("7");
    expect(res.status).toBe(200);
    expect(revokeToken).toHaveBeenCalledWith(7);
  });

  it("rejects a non-admin session and touches nothing", async () => {
    verifyCookie.mockResolvedValue("exec");
    const res = await post("7");
    expect(res.status).toBe(403);
    expect(revokeToken).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated request", async () => {
    verifyCookie.mockResolvedValue(null);
    const res = await post("7");
    expect(res.status).toBe(403);
    expect(revokeToken).not.toHaveBeenCalled();
  });

  it("rejects a non-numeric id", async () => {
    for (const id of ["abc", "", "1; drop table mcp_tokens", "1.5", "-1"]) {
      const res = await post(id);
      expect(res.status).toBe(400);
    }
    expect(revokeToken).not.toHaveBeenCalled();
  });

  // Idempotent by design: revokeToken's WHERE clause skips an already-revoked
  // row, so a double click is a success, not an error.
  it("succeeds when the token is already revoked", async () => {
    revokeToken.mockResolvedValue(undefined);
    const res = await post("7");
    expect(res.status).toBe(200);
  });

  it("500s when the update fails", async () => {
    revokeToken.mockRejectedValue(new Error("db down"));
    const res = await post("7");
    expect(res.status).toBe(500);
  });
});
