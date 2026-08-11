import { describe, it, expect, vi, afterEach } from "vitest";
import { mapUpstreamError } from "./error-mapper";

describe("mapUpstreamError", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("never returns the raw text — the literal env-var leak this exists to close", () => {
    const out = mapUpstreamError("smartsheet", "SMARTSHEET_API_TOKEN is not set");
    expect(out).not.toMatch(/SMARTSHEET_API_TOKEN/);
    expect(out).toMatch(/not configured/i);
  });

  it("classifies 'is not configured' the same as 'is not set'", () => {
    expect(mapUpstreamError("cloudbeds", "CLOUDBEDS_API_KEY_LL is not configured")).toMatch(/not configured/i);
  });

  it("never leaks a network exception's text (hostnames, stack fragments) — falls to the generic 'not reachable'", () => {
    const raw = "Network error reaching Cloudbeds: TypeError: fetch failed at 10.0.4.2:443";
    const out = mapUpstreamError("cloudbeds", raw);
    expect(out).not.toMatch(/10\.0\.4\.2|TypeError|fetch failed/);
    expect(out).toMatch(/not reachable/i);
  });

  it("never leaks an HTTP-status detail string", () => {
    const out = mapUpstreamError("elise", "Snowflake returned HTTP 403: invalid warehouse SF_WH_RISE8");
    expect(out).not.toMatch(/SF_WH_RISE8|403/);
  });

  it("says the source did not respond when there is no error text at all", () => {
    expect(mapUpstreamError("smartsheet", null)).toBe("Smartsheet did not respond.");
    expect(mapUpstreamError("smartsheet", undefined)).toBe("Smartsheet did not respond.");
    expect(mapUpstreamError("smartsheet", "")).toBe("Smartsheet did not respond.");
  });

  it("logs the raw text server-side rather than discarding it entirely", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mapUpstreamError("smartsheet", "SMARTSHEET_API_TOKEN is not set");
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("smartsheet"), "SMARTSHEET_API_TOKEN is not set");
  });

  it("uses each source's own label", () => {
    expect(mapUpstreamError("smartsheet", "x is not set")).toMatch(/^Smartsheet /);
    expect(mapUpstreamError("cloudbeds", "x is not set")).toMatch(/^Cloudbeds /);
    expect(mapUpstreamError("elise", "x is not set")).toMatch(/^EliseAI /);
  });
});
