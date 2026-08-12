import { describe, it, expect, vi, beforeEach } from "vitest";

const verifyCookie = vi.fn();
const insertToken = vi.fn();
const countLiveTokens = vi.fn();
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
  return {
    ...actual,
    insertToken: (...a: unknown[]) => insertToken(...a),
    countLiveTokens: (...a: unknown[]) => countLiveTokens(...a),
  };
});

import { POST } from "./route";
import { hashToken, MAX_LIVE_TOKENS } from "@/lib/mcp/tokens";

function post(body: unknown, host = "localhost") {
  return POST(
    new Request(`http://${host}/api/connectors`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  verifyCookie.mockReset();
  insertToken.mockReset();
  countLiveTokens.mockReset();
  cookieGet.mockReset();
  cookieGet.mockReturnValue({ value: "admin.sig" });
  verifyCookie.mockResolvedValue("admin");
  countLiveTokens.mockResolvedValue(0);
});

describe("POST /api/connectors", () => {
  it("mints a token and returns its URL once", async () => {
    const res = await post({ email: "kate@rentstayable.com", label: "Desktop" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.url).toMatch(
      /^https:\/\/dashboard\.rentstayable\.com\/api\/mcp\/[0-9a-f]{64}$/,
    );
  });

  // THE REGRESSION TEST FOR SESSIONS 9n/9o. A host-derived URL would produce a
  // *.vercel.app address that returns Vercel's SSO page — indistinguishable
  // from a broken connector in Claude Desktop.
  it("uses the custom domain even when the request host is a preview URL", async () => {
    const res = await post(
      { email: "kate@rentstayable.com", label: null },
      "cloudbeds-dashboard-git-abc.vercel.app",
    );
    const body = await res.json();
    expect(body.url).toContain("https://dashboard.rentstayable.com/");
    expect(body.url).not.toContain("vercel.app");
  });

  it("stores the hash, never the token", async () => {
    const res = await post({ email: "kate@rentstayable.com", label: "Desktop" });
    const { url } = await res.json();
    const token = url.split("/").pop() as string;
    expect(insertToken).toHaveBeenCalledWith({
      email: "kate@rentstayable.com",
      label: "Desktop",
      tokenHash: hashToken(token),
    });
    const stored = insertToken.mock.calls[0][0] as { tokenHash: string };
    expect(stored.tokenHash).not.toBe(token);
  });

  it("rejects a non-admin session and writes nothing", async () => {
    verifyCookie.mockResolvedValue("exec");
    const res = await post({ email: "kate@rentstayable.com", label: null });
    expect(res.status).toBe(403);
    expect(insertToken).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated request", async () => {
    verifyCookie.mockResolvedValue(null);
    const res = await post({ email: "kate@rentstayable.com", label: null });
    expect(res.status).toBe(403);
    expect(insertToken).not.toHaveBeenCalled();
  });

  it("rejects a missing or malformed email", async () => {
    for (const email of [undefined, "", "not-an-email", "a@b", "x@y.", 42]) {
      const res = await post({ email, label: null });
      expect(res.status).toBe(400);
    }
    expect(insertToken).not.toHaveBeenCalled();
  });

  it("lowercases and trims the email", async () => {
    await post({ email: "  Kate@RentStayable.com  ", label: null });
    expect(insertToken).toHaveBeenCalledWith(
      expect.objectContaining({ email: "kate@rentstayable.com" }),
    );
  });

  it("treats a blank label as null rather than an empty string", async () => {
    await post({ email: "kate@rentstayable.com", label: "   " });
    expect(insertToken).toHaveBeenCalledWith(
      expect.objectContaining({ label: null }),
    );
  });

  it("refuses once the live-token cap is reached", async () => {
    countLiveTokens.mockResolvedValue(MAX_LIVE_TOKENS);
    const res = await post({ email: "kate@rentstayable.com", label: null });
    expect(res.status).toBe(400);
    expect(insertToken).not.toHaveBeenCalled();
  });

  it("does not leak the token in an error when the insert fails", async () => {
    insertToken.mockRejectedValue(new Error("db down"));
    const res = await post({ email: "kate@rentstayable.com", label: null });
    expect(res.status).toBe(500);
    const text = JSON.stringify(await res.json());
    expect(text).not.toMatch(/[0-9a-f]{64}/);
  });
});
