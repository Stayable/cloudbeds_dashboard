import { describe, it, expect, vi, beforeEach } from "vitest";

const findLiveTokenByHash = vi.fn();
const touchToken = vi.fn();

// Mock only the DB functions; keep hashToken/shouldTouch real so the test
// exercises the actual hashing and throttle decision.
vi.mock("./tokens", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./tokens")>();
  return {
    ...actual,
    findLiveTokenByHash: (...a: unknown[]) => findLiveTokenByHash(...a),
    touchToken: (...a: unknown[]) => touchToken(...a),
  };
});

import { resolveMcpToken, MIN_TOKEN_LENGTH } from "./auth";
import { hashToken, TOUCH_WINDOW_MS } from "./tokens";

const TOKEN = "a".repeat(64);

function row(over: Partial<{ lastUsedAt: string | null }> = {}) {
  return {
    id: 7,
    email: "rb@rise8companies.com",
    label: "Claude Desktop",
    createdAt: "2026-08-12T00:00:00.000Z",
    lastUsedAt: null,
    revokedAt: null,
    ...over,
  };
}

beforeEach(() => {
  findLiveTokenByHash.mockReset();
  touchToken.mockReset();
});

describe("resolveMcpToken", () => {
  it("returns the caller for a live token", async () => {
    findLiveTokenByHash.mockResolvedValue(row());
    await expect(resolveMcpToken(TOKEN)).resolves.toEqual({
      id: 7,
      email: "rb@rise8companies.com",
      label: "Claude Desktop",
    });
  });

  it("looks the token up by its hash, never by the token itself", async () => {
    findLiveTokenByHash.mockResolvedValue(row());
    await resolveMcpToken(TOKEN);
    expect(findLiveTokenByHash).toHaveBeenCalledWith(hashToken(TOKEN));
    expect(findLiveTokenByHash).not.toHaveBeenCalledWith(TOKEN);
  });

  // findLiveTokenByHash excludes revoked rows in SQL, so "revoked" and
  // "unknown" both arrive here as null. This pins the caller-visible result.
  it("returns null when the token is unknown or revoked", async () => {
    findLiveTokenByHash.mockResolvedValue(null);
    await expect(resolveMcpToken(TOKEN)).resolves.toBeNull();
  });

  it("returns null for undefined", async () => {
    await expect(resolveMcpToken(undefined)).resolves.toBeNull();
    expect(findLiveTokenByHash).not.toHaveBeenCalled();
  });

  it("rejects a too-short candidate without querying the database", async () => {
    await expect(resolveMcpToken("x".repeat(MIN_TOKEN_LENGTH - 1))).resolves.toBeNull();
    expect(findLiveTokenByHash).not.toHaveBeenCalled();
  });

  // Fail closed: a dead database must make every request dead, never every
  // request valid. Same rule lib/pins.ts documents for login.
  it("returns null when the database throws", async () => {
    findLiveTokenByHash.mockRejectedValue(new Error("DATABASE_URL is not set"));
    await expect(resolveMcpToken(TOKEN)).resolves.toBeNull();
  });

  it("records last_used_at on a token that has never been used", async () => {
    findLiveTokenByHash.mockResolvedValue(row({ lastUsedAt: null }));
    await resolveMcpToken(TOKEN);
    expect(touchToken).toHaveBeenCalledWith(7);
  });

  it("does not write last_used_at again inside the throttle window", async () => {
    findLiveTokenByHash.mockResolvedValue(
      row({ lastUsedAt: new Date(Date.now() - 1_000).toISOString() }),
    );
    await resolveMcpToken(TOKEN);
    expect(touchToken).not.toHaveBeenCalled();
  });

  it("writes last_used_at once the window has passed", async () => {
    findLiveTokenByHash.mockResolvedValue(
      row({ lastUsedAt: new Date(Date.now() - TOUCH_WINDOW_MS - 1_000).toISOString() }),
    );
    await resolveMcpToken(TOKEN);
    expect(touchToken).toHaveBeenCalledWith(7);
  });

  // Bookkeeping must never break a legitimate call.
  it("still resolves when recording last_used_at fails", async () => {
    findLiveTokenByHash.mockResolvedValue(row());
    touchToken.mockRejectedValue(new Error("write failed"));
    await expect(resolveMcpToken(TOKEN)).resolves.toMatchObject({ id: 7 });
  });
});
