import { describe, it, expect } from "vitest";
import {
  generateToken,
  hashToken,
  connectorUrl,
  shouldTouch,
  tokenPreview,
  CONNECTOR_BASE_URL,
  TOUCH_WINDOW_MS,
  PREVIEW_EDGE,
} from "./tokens";

describe("generateToken", () => {
  it("is 64 hex characters (32 random bytes)", () => {
    expect(generateToken()).toMatch(/^[0-9a-f]{64}$/);
  });

  it("does not repeat", () => {
    const seen = new Set(Array.from({ length: 50 }, () => generateToken()));
    expect(seen.size).toBe(50);
  });
});

describe("hashToken", () => {
  it("is deterministic", () => {
    expect(hashToken("abc")).toBe(hashToken("abc"));
  });

  it("differs for different tokens", () => {
    expect(hashToken("abc")).not.toBe(hashToken("abd"));
  });

  it("returns 64 hex characters and never the input", () => {
    const h = hashToken("a".repeat(64));
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toBe("a".repeat(64));
  });
});

describe("connectorUrl", () => {
  // THE REGRESSION TEST FOR SESSIONS 9n/9o. A host-derived URL would hand out a
  // *.vercel.app address that returns Vercel's SSO page, which in Claude Desktop
  // is indistinguishable from a broken connector.
  it("always uses the custom domain", () => {
    expect(connectorUrl("deadbeef")).toBe(
      "https://dashboard.rentstayable.com/api/mcp/deadbeef",
    );
  });

  it("pins the base URL to the one domain exempt from Vercel Auth", () => {
    expect(CONNECTOR_BASE_URL).toBe("https://dashboard.rentstayable.com");
  });

  it("ignores any host-shaped string a caller passes as the token", () => {
    // Guards the shape of the bug, not just its value: even if a caller tried
    // to smuggle an origin in, the output origin is still ours.
    expect(connectorUrl("evil.vercel.app/x")).toBe(
      "https://dashboard.rentstayable.com/api/mcp/evil.vercel.app/x",
    );
  });
});

describe("tokenPreview", () => {
  it("shows the first and last PREVIEW_EDGE characters of a real token", () => {
    const token = generateToken();
    const preview = tokenPreview(token);
    expect(preview).toBe(`${token.slice(0, 6)}…${token.slice(-6)}`);
    expect(preview).toHaveLength(PREVIEW_EDGE * 2 + 1);
  });

  it("reveals only a fraction of the token", () => {
    const token = generateToken();
    const revealed = tokenPreview(token).replace("…", "");
    expect(revealed).toHaveLength(PREVIEW_EDGE * 2);
    // 12 of 64 hex chars — the other 52 (~208 bits) stay unknown.
    expect(revealed.length).toBeLessThan(token.length / 4);
    expect(tokenPreview(token)).not.toBe(token);
  });

  it("distinguishes two tokens", () => {
    expect(tokenPreview(generateToken())).not.toBe(tokenPreview(generateToken()));
  });

  // Guards the failure mode where masking a short value reveals nearly all of
  // it: at or below 2*PREVIEW_EDGE we emit nothing but the ellipsis.
  it("masks a short token entirely rather than mostly revealing it", () => {
    expect(tokenPreview("a".repeat(PREVIEW_EDGE * 2))).toBe("…");
    expect(tokenPreview("abc")).toBe("…");
    expect(tokenPreview("")).toBe("…");
  });
});

describe("shouldTouch", () => {
  const now = Date.parse("2026-08-12T12:00:00.000Z");

  it("writes when the token has never been used", () => {
    expect(shouldTouch(null, now)).toBe(true);
  });

  it("does not write again inside the window", () => {
    const oneMinuteAgo = new Date(now - 60_000).toISOString();
    expect(shouldTouch(oneMinuteAgo, now)).toBe(false);
  });

  it("writes once the window has passed", () => {
    const stale = new Date(now - TOUCH_WINDOW_MS - 1).toISOString();
    expect(shouldTouch(stale, now)).toBe(true);
  });

  // Err toward writing: a bad stored value must not freeze last_used_at forever,
  // because "never used" is the signal that a token was issued and not installed.
  it("writes when the stored timestamp is unparseable", () => {
    expect(shouldTouch("not-a-date", now)).toBe(true);
  });
});
