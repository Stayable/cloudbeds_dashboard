import { describe, it, expect } from "vitest";
import { relativeAge } from "./connector-view";

const now = Date.parse("2026-08-12T12:00:00.000Z");

describe("relativeAge", () => {
  // "never" is the signal that a URL was issued and never installed — the
  // single most useful thing on the page, so it must not render as "—".
  it("says never for a token that has not been used", () => {
    expect(relativeAge(null, now)).toBe("never");
  });

  it("renders minutes, hours and days", () => {
    expect(relativeAge(new Date(now - 90_000).toISOString(), now)).toBe("1 minute ago");
    expect(relativeAge(new Date(now - 2 * 3_600_000).toISOString(), now)).toBe("2 hours ago");
    expect(relativeAge(new Date(now - 3 * 86_400_000).toISOString(), now)).toBe("3 days ago");
  });

  it("says just now for the last minute", () => {
    expect(relativeAge(new Date(now - 5_000).toISOString(), now)).toBe("just now");
  });

  it("singularises correctly", () => {
    expect(relativeAge(new Date(now - 3_600_000).toISOString(), now)).toBe("1 hour ago");
    expect(relativeAge(new Date(now - 86_400_000).toISOString(), now)).toBe("1 day ago");
  });

  it("does not render an unparseable timestamp as a fake age", () => {
    expect(relativeAge("not-a-date", now)).toBe("unknown");
  });
});
