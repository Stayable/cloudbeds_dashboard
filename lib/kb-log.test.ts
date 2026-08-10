import { describe, it, expect, vi, beforeEach } from "vitest";

const insertKbQuery = vi.fn();
vi.mock("./db", () => ({ insertKbQuery: (...a: unknown[]) => insertKbQuery(...a) }));

import { logKbQuery, normaliseQuery, KB_QUERY_MAX } from "./kb-log";

beforeEach(() => insertKbQuery.mockReset());

describe("normaliseQuery", () => {
  it("collapses whitespace and trims", () => {
    expect(normaliseQuery("  eviction   process  ")).toBe("eviction process");
  });

  it("returns null for an empty or whitespace-only query", () => {
    expect(normaliseQuery("")).toBeNull();
    expect(normaliseQuery("   ")).toBeNull();
  });

  it("truncates an absurdly long query rather than storing it whole", () => {
    expect(normaliseQuery("x".repeat(5_000))).toHaveLength(KB_QUERY_MAX);
  });
});

describe("logKbQuery", () => {
  it("records the query and its result count", async () => {
    await logKbQuery(" eviction ", 3);
    expect(insertKbQuery).toHaveBeenCalledWith("eviction", 3);
  });

  it("does not record an empty query", async () => {
    await logKbQuery("   ", 0);
    expect(insertKbQuery).not.toHaveBeenCalled();
  });

  // A logging failure must never take the search page down with it. This
  // path deliberately writes to console.error (logKbQuery's only trace of a
  // failure), so the spy exists to keep that expected noise out of test
  // output, not to assert anything about it.
  it("swallows a database error", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    insertKbQuery.mockRejectedValueOnce(new Error("DATABASE_URL is not set"));
    await expect(logKbQuery("eviction", 1)).resolves.toBeUndefined();
    errSpy.mockRestore();
  });
});
