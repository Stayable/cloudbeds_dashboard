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
    expect(await verifyFileToken(await signFileToken(null, NOW), null, NOW)).toBe(true);
  });

  it("still verifies just inside the window", async () => {
    const t = await signFileToken(null, NOW);
    expect(await verifyFileToken(t, null, NOW + (FILE_TOKEN_DAYS - 1) * DAY)).toBe(true);
  });

  it("rejects a token past its expiry", async () => {
    const t = await signFileToken(null, NOW);
    expect(await verifyFileToken(t, null, NOW + (FILE_TOKEN_DAYS + 1) * DAY)).toBe(false);
  });

  it("rejects a tampered signature", async () => {
    const t = await signFileToken(null, NOW);
    const [exp, sig] = t.split(".");
    const flipped = sig[0] === "a" ? "b" : "a";
    expect(await verifyFileToken(`${exp}.${flipped}${sig.slice(1)}`, null, NOW)).toBe(false);
  });

  it("rejects an extended expiry carrying the original signature", async () => {
    // The expiry is inside the signed message, so it cannot be moved.
    const t = await signFileToken(null, NOW);
    const [exp, sig] = t.split(".");
    expect(await verifyFileToken(`${Number(exp) + 10 * 86_400}.${sig}`, null, NOW)).toBe(false);
  });

  it("rejects junk, empty and missing tokens", async () => {
    expect(await verifyFileToken(null, null, NOW)).toBe(false);
    expect(await verifyFileToken("", null, NOW)).toBe(false);
    expect(await verifyFileToken("nodot", null, NOW)).toBe(false);
    expect(await verifyFileToken("notanumber.abc123", null, NOW)).toBe(false);
  });

  // --- stay-date binding: Monica's 08/07/26 bug (yesterday's card and today's
  //     card downloaded the identical file) ---

  it("round-trips a token bound to a stay date", async () => {
    const t = await signFileToken("2026-08-05", NOW);
    expect(await verifyFileToken(t, "2026-08-05", NOW)).toBe(true);
  });

  it("REFUSES a bound token presented for a different stay date", async () => {
    // This is the fix: a link can only ever yield the report it was minted for.
    const t = await signFileToken("2026-08-05", NOW);
    expect(await verifyFileToken(t, "2026-08-06", NOW)).toBe(false);
  });

  it("refuses a bound token with the stay date stripped off the URL", async () => {
    // Otherwise dropping &asOf= would fall back to "latest" and reopen the bug.
    const t = await signFileToken("2026-08-05", NOW);
    expect(await verifyFileToken(t, null, NOW)).toBe(false);
  });

  it("refuses a legacy unbound token presented with a stay date", async () => {
    const t = await signFileToken(null, NOW);
    expect(await verifyFileToken(t, "2026-08-05", NOW)).toBe(false);
  });

  it("keeps verifying legacy unbound tokens, so already-posted cards still work", async () => {
    // ~2 weeks of cards are live in the Revenue chat. They render latest (their
    // intended date is not recoverable — see verifyFileToken); breaking them
    // would trade one wrong file for a dead button.
    const t = await signFileToken(null, NOW);
    expect(await verifyFileToken(t, null, NOW + 10 * DAY)).toBe(true);
  });

  it("still honours expiry on a bound token", async () => {
    const t = await signFileToken("2026-08-05", NOW);
    expect(await verifyFileToken(t, "2026-08-05", NOW + (FILE_TOKEN_DAYS + 1) * DAY)).toBe(false);
  });
});
