import { describe, it, expect, beforeAll } from "vitest";

// The signing secret is read at call time from env, so set it before import.
beforeAll(() => {
  process.env.AUTH_SECRET ??= "test-secret-for-file-tokens";
});

const { signFileToken, verifyFileToken, FILE_TOKEN_DAYS } = await import("@/lib/auth");

const NOW = Date.parse("2026-08-04T12:00:00Z");
const DAY = 86_400_000;

describe("report-file tokens", () => {
  it("round-trips a freshly signed token", async () => {
    expect(await verifyFileToken(await signFileToken(NOW), NOW)).toBe(true);
  });

  it("still verifies just inside the window", async () => {
    const t = await signFileToken(NOW);
    expect(await verifyFileToken(t, NOW + (FILE_TOKEN_DAYS - 1) * DAY)).toBe(true);
  });

  it("rejects a token past its expiry", async () => {
    const t = await signFileToken(NOW);
    expect(await verifyFileToken(t, NOW + (FILE_TOKEN_DAYS + 1) * DAY)).toBe(false);
  });

  it("rejects a tampered signature", async () => {
    const t = await signFileToken(NOW);
    const [exp, sig] = t.split(".");
    const flipped = sig[0] === "a" ? "b" : "a";
    expect(await verifyFileToken(`${exp}.${flipped}${sig.slice(1)}`, NOW)).toBe(false);
  });

  it("rejects an extended expiry carrying the original signature", async () => {
    // The expiry is inside the signed message, so it cannot be moved.
    const t = await signFileToken(NOW);
    const [exp, sig] = t.split(".");
    expect(await verifyFileToken(`${Number(exp) + 10 * 86_400}.${sig}`, NOW)).toBe(false);
  });

  it("rejects junk, empty and missing tokens", async () => {
    expect(await verifyFileToken(null, NOW)).toBe(false);
    expect(await verifyFileToken("", NOW)).toBe(false);
    expect(await verifyFileToken("nodot", NOW)).toBe(false);
    expect(await verifyFileToken("notanumber.abc123", NOW)).toBe(false);
  });
});
