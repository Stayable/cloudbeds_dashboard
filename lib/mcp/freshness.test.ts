import { describe, it, expect } from "vitest";
import { describeSnapshot, liveFreshness, describeElise, smartsheetFreshness } from "./freshness";
import type { EliseSyncStatus } from "@/lib/db";

const NOW = "2026-08-11T14:00:00.000Z";

const eliseStatus = (over: Partial<EliseSyncStatus> = {}): EliseSyncStatus => ({
  lastAttemptAt: null,
  lastAttemptOk: null,
  lastError: null,
  lastSuccessAt: null,
  consecutiveFailures: 0,
  ...over,
});

describe("describeSnapshot", () => {
  it("reports the last captured day and what is final", () => {
    const f = describeSnapshot({ latestCapturedDate: "2026-08-10", propertiesOnLatest: 8 }, "2026-07-31");
    expect(f.source).toBe("snapshot");
    expect(f.asOf).toBe("2026-08-10");
    expect(f.finalThrough).toBe("2026-07-31");
    expect(f.note).toContain("2026-08-10");
  });

  // An empty store must not read as "current". Silence is not freshness.
  it("says plainly when nothing has been captured", () => {
    const f = describeSnapshot({ latestCapturedDate: null, propertiesOnLatest: 0 }, null);
    expect(f.asOf).toBeNull();
    expect(f.note).toMatch(/no .*captur/i);
  });

  // A partial day is the dangerous one: the numbers look normal and are short.
  it("warns when only some properties captured on the latest day", () => {
    const f = describeSnapshot({ latestCapturedDate: "2026-08-10", propertiesOnLatest: 5 }, "2026-07-31");
    expect(f.note).toMatch(/5 of 8|incomplete|partial/i);
  });
});

describe("liveFreshness", () => {
  it("marks live data as read now", () => {
    const f = liveFreshness(NOW);
    expect(f.source).toBe("live");
    expect(f.asOf).toBe(NOW);
    expect(f.note).toMatch(/live|right now/i);
  });
});

describe("describeElise", () => {
  it("reports a healthy sync with its timestamp", () => {
    const f = describeElise(
      eliseStatus({ lastAttemptAt: "2026-08-11T12:00:00Z", lastAttemptOk: true, lastSuccessAt: "2026-08-11T12:00:00Z" }),
      NOW,
    );
    expect(f.source).toBe("elise");
    expect(f.asOf).toBe("2026-08-11T12:00:00Z");
    expect(f.note).not.toMatch(/not updating/i);
  });

  // The failure this exists for: the numbers are real but two days old, and
  // nothing in a chat reply would otherwise say so.
  it("states the failure and the age of the data we still hold", () => {
    const f = describeElise(
      eliseStatus({
        lastAttemptAt: "2026-08-11T12:00:00Z",
        lastAttemptOk: false,
        lastError: "Incorrect username or password was specified.",
        lastSuccessAt: "2026-08-09T12:00:00Z",
        consecutiveFailures: 3,
      }),
      NOW,
    );
    expect(f.asOf).toBe("2026-08-09T12:00:00Z");
    expect(f.note).toMatch(/not updating/i);
  });

  it("says so when the funnel has never synced", () => {
    expect(describeElise(eliseStatus(), NOW).note).toMatch(/never/i);
  });
});

describe("smartsheetFreshness", () => {
  it("is read live from Smartsheet", () => {
    const f = smartsheetFreshness(NOW);
    expect(f.source).toBe("smartsheet");
    expect(f.asOf).toBe(NOW);
  });
});
