import { describe, it, expect } from "vitest";
import { allow } from "@/lib/ratelimit";

describe("allow", () => {
  it("permits up to the limit then blocks within the window", () => {
    const key = "test-ip";
    expect(allow(key, 2, 60_000)).toBe(true);
    expect(allow(key, 2, 60_000)).toBe(true);
    expect(allow(key, 2, 60_000)).toBe(false);
  });
});
