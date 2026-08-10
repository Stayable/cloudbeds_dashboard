import { describe, it, expect, afterEach } from "vitest";
import { mcpSecretOk } from "./auth";

const REAL = "a".repeat(64);
const original = process.env.MCP_SECRET;
afterEach(() => {
  if (original === undefined) delete process.env.MCP_SECRET;
  else process.env.MCP_SECRET = original;
});

describe("mcpSecretOk", () => {
  it("accepts the configured secret", () => {
    process.env.MCP_SECRET = REAL;
    expect(mcpSecretOk(REAL)).toBe(true);
  });

  it("rejects a wrong secret of the same length", () => {
    process.env.MCP_SECRET = REAL;
    expect(mcpSecretOk("b".repeat(64))).toBe(false);
  });

  it("rejects a prefix of the real secret", () => {
    process.env.MCP_SECRET = REAL;
    expect(mcpSecretOk("a".repeat(63))).toBe(false);
  });

  it("rejects undefined and empty", () => {
    process.env.MCP_SECRET = REAL;
    expect(mcpSecretOk(undefined)).toBe(false);
    expect(mcpSecretOk("")).toBe(false);
  });

  // Fails CLOSED: an unset env var must not make every request valid, and it
  // must not make an empty path segment valid either.
  it("rejects everything when MCP_SECRET is unset", () => {
    delete process.env.MCP_SECRET;
    expect(mcpSecretOk(REAL)).toBe(false);
    expect(mcpSecretOk("")).toBe(false);
    expect(mcpSecretOk(undefined)).toBe(false);
  });

  // A short secret is a typo or a placeholder, not a credential. Refusing it
  // turns "someone pasted 'changeme'" into a dead endpoint rather than a
  // guessable one.
  it("refuses to operate on a secret shorter than 32 characters", () => {
    process.env.MCP_SECRET = "short";
    expect(mcpSecretOk("short")).toBe(false);
  });
});
