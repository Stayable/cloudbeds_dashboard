import { describe, it, expect } from "vitest";
import { retryDelayMs } from "@/lib/cloudbeds";

describe("retryDelayMs", () => {
  it("backs off exponentially when the server sends no Retry-After", () => {
    expect(retryDelayMs(1, null)).toBe(500);
    expect(retryDelayMs(2, null)).toBe(1_000);
    expect(retryDelayMs(3, null)).toBe(2_000);
  });

  it("caps the exponential backoff at 4s", () => {
    expect(retryDelayMs(10, null)).toBe(4_000);
  });

  it("honours a sane Retry-After header, in seconds", () => {
    expect(retryDelayMs(1, "2")).toBe(2_000);
  });

  it("caps Retry-After at 10s so a bad header cannot stall a cron", () => {
    expect(retryDelayMs(1, "600")).toBe(10_000);
  });

  it("falls back to the exponential schedule for a non-numeric or zero Retry-After", () => {
    // Cloudbeds may send an HTTP-date form, which Number() cannot parse.
    expect(retryDelayMs(2, "Mon, 03 Aug 2026 12:00:00 GMT")).toBe(1_000);
    expect(retryDelayMs(2, "0")).toBe(1_000);
    expect(retryDelayMs(2, undefined)).toBe(1_000);
  });
});
