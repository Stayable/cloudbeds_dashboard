import { describe, it, expect, vi, beforeEach } from "vitest";

// Capture the SQL tag calls from a mocked neon client.
const calls: { strings: string[]; values: unknown[] }[] = [];
vi.mock("@neondatabase/serverless", () => ({
  neon: () => (strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ strings: Array.from(strings), values });
    return Promise.resolve([]);
  },
}));

import { insertSubmission, insertFeedback } from "@/lib/db";

beforeEach(() => {
  calls.length = 0;
  process.env.DATABASE_URL = "postgresql://test";
});

describe("insertSubmission", () => {
  it("inserts an intake row with the metrics array", async () => {
    await insertSubmission({ name: "Ana", role: "PM", team: "Crystal", metrics: ["occupancy"], notes: "hi" });
    expect(calls.length).toBe(1);
    expect(calls[0].values).toContain("team-intake");
    expect(calls[0].values).toContain("Ana");
    // metrics serialized as JSON string for jsonb
    expect(calls[0].values).toContain(JSON.stringify(["occupancy"]));
  });
});

describe("insertFeedback", () => {
  it("inserts an exec-feedback row attributed to Rob", async () => {
    await insertFeedback("dashboard looks great");
    expect(calls[0].values).toContain("exec-feedback");
    expect(calls[0].values).toContain("Rob");
    expect(calls[0].values).toContain("dashboard looks great");
  });
});

describe("guards", () => {
  it("throws when DATABASE_URL is unset", async () => {
    delete process.env.DATABASE_URL;
    await expect(insertFeedback("x")).rejects.toThrow();
  });
});
