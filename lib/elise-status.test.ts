import { describe, it, expect } from "vitest";
import { eliseBanner, daysBetween, tidyError, formatWhen, BLOCKED_NOTE } from "./elise-status";
import type { EliseSyncStatus } from "./db";

const NOW = "2026-08-08T17:00:00.000Z";

const status = (over: Partial<EliseSyncStatus> = {}): EliseSyncStatus => ({
  lastAttemptAt: null,
  lastAttemptOk: null,
  lastError: null,
  lastSuccessAt: null,
  consecutiveFailures: 0,
  ...over,
});

describe("daysBetween", () => {
  it("floors to whole days and never goes negative", () => {
    expect(daysBetween("2026-08-06T17:07:00Z", NOW)).toBe(2);
    expect(daysBetween("2026-08-08T01:00:00Z", NOW)).toBe(0);
    // A clock skew that puts the timestamp in the future must not render as "-1 days ago".
    expect(daysBetween("2026-08-09T00:00:00Z", NOW)).toBe(0);
  });

  it("returns 0 for an unparseable timestamp rather than NaN", () => {
    expect(daysBetween("not a date", NOW)).toBe(0);
  });
});

describe("formatWhen", () => {
  it("renders ISO input as a UTC stamp", () => {
    expect(formatWhen("2026-08-06T17:07:00.000Z", NOW)).toBe("2026-08-06 17:07 UTC (2 days ago)");
  });

  // REGRESSION: Neon returns timestamptz as a JS Date, and String(date) gives
  // "Sun Aug 09 2026 00:50:00 GMT+0800". Slicing that produced
  // "Sun Aug 09 2026  UTC" on the real dashboard and leaked the server's zone.
  it("parses a JS-Date-style string instead of slicing it", () => {
    const out = formatWhen("Fri Aug 07 2026 01:07:00 GMT+0800", NOW);
    expect(out).toContain("UTC");
    expect(out).not.toContain("Aug");
    expect(out).not.toContain("GMT");
    expect(out.startsWith("2026-08-06 17:07 UTC")).toBe(true); // same instant, in UTC
  });

  it("says 'unknown time' rather than 'Invalid Date' for junk", () => {
    expect(formatWhen("not a date", NOW)).toContain("unknown time");
  });

  it("uses the singular for one day", () => {
    expect(formatWhen("2026-08-07T10:00:00Z", NOW)).toContain("(1 day ago)");
  });
});

describe("tidyError", () => {
  it("drops Snowflake's correlation id and keeps the first sentence", () => {
    expect(
      tidyError("Incorrect username or password was specified. [9b7e8233-22e6-49e9-b617-f837621278ff]"),
    ).toBe("Incorrect username or password was specified.");
  });

  it("keeps a bare message untouched", () => {
    expect(tidyError("Your user account has been temporarily locked.")).toBe(
      "Your user account has been temporarily locked.",
    );
  });

  it("truncates something pathological rather than filling the banner", () => {
    const out = tidyError("x".repeat(500));
    expect(out.length).toBeLessThanOrEqual(200);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("eliseBanner", () => {
  it("reports a failing sync with the real error, the last good data, and the human note", () => {
    const b = eliseBanner(
      status({
        lastAttemptAt: "2026-08-08T12:00:21.000Z",
        lastAttemptOk: false,
        lastError: "Incorrect username or password was specified. [9b7e8233-22e6]",
        lastSuccessAt: "2026-08-06T17:07:00.000Z",
        consecutiveFailures: 2,
      }),
      NOW,
    );
    expect(b.kind).toBe("failing");
    expect(b.headline).toBe("Leasing data is not updating.");
    expect(b.details.join(" ")).toContain("Incorrect username or password");
    expect(b.details.join(" ")).toContain("2 days ago");
    expect(b.details.join(" ")).toContain("2 consecutive failed attempts");
    expect(b.note).toContain(BLOCKED_NOTE.note);
  });

  it("does not claim a run of failures when there has only been one", () => {
    const b = eliseBanner(
      status({
        lastAttemptAt: "2026-08-08T12:00:00.000Z",
        lastAttemptOk: false,
        lastError: "boom",
        lastSuccessAt: "2026-08-07T12:00:00.000Z",
        consecutiveFailures: 1,
      }),
      NOW,
    );
    expect(b.details.join(" ")).not.toContain("consecutive");
  });

  it("says so plainly when a failing sync has never once succeeded", () => {
    const b = eliseBanner(
      status({ lastAttemptAt: "2026-08-08T12:00:00.000Z", lastAttemptOk: false, lastError: "boom" }),
      NOW,
    );
    expect(b.details.join(" ")).toContain("No sync has ever succeeded");
  });

  it("distinguishes 'never run' from 'failing'", () => {
    const b = eliseBanner(status(), NOW);
    expect(b.kind).toBe("never");
    expect(b.details.join(" ")).toContain("No sync attempt has been recorded");
  });

  // THE POINT OF THE WHOLE DESIGN: one success and the hardcoded sentence is gone.
  it("CLEARS ITSELF once a sync succeeds — note and banner both disappear", () => {
    const b = eliseBanner(
      status({
        lastAttemptAt: NOW,
        lastAttemptOk: true,
        lastSuccessAt: NOW,
        consecutiveFailures: 0,
      }),
      NOW,
    );
    expect(b.kind).toBeNull();
    expect(b.note).toBeNull();
    expect(b.headline).toBe("");
  });

  it("warns about staleness after a success without blaming credentials", () => {
    const b = eliseBanner(
      status({
        lastAttemptAt: "2026-08-04T12:00:00.000Z",
        lastAttemptOk: true,
        lastSuccessAt: "2026-08-04T12:00:00.000Z",
      }),
      NOW,
    );
    expect(b.kind).toBe("stale");
    expect(b.note).toBeNull();
    expect(b.details.join(" ")).toContain("4 days ago");
  });

  it("stays quiet when a recent success is within the stale window", () => {
    const b = eliseBanner(
      status({
        lastAttemptAt: "2026-08-07T12:00:00.000Z",
        lastAttemptOk: true,
        lastSuccessAt: "2026-08-07T12:00:00.000Z",
      }),
      NOW,
    );
    expect(b.kind).toBeNull();
  });

  it("reports a failing sync regardless of how recent the last success was", () => {
    const b = eliseBanner(
      status({
        lastAttemptAt: NOW,
        lastAttemptOk: false,
        lastError: "boom",
        lastSuccessAt: NOW,
        consecutiveFailures: 1,
      }),
      NOW,
    );
    expect(b.kind).toBe("failing");
  });
});
