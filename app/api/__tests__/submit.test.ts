import { describe, it, expect, vi, beforeEach } from "vitest";

const inserted: unknown[] = [];
vi.mock("@/lib/db", () => ({
  insertSubmission: vi.fn(async (input: unknown) => { inserted.push(input); }),
}));
// Default: not a bot. Individual tests can override.
const checkBotId = vi.fn(async () => ({ isBot: false }));
vi.mock("botid/server", () => ({ checkBotId: () => checkBotId() }));

import { POST } from "@/app/api/submit/route";

function req(body: unknown) {
  return new Request("http://localhost/api/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": "1.2.3.4" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  inserted.length = 0;
  checkBotId.mockResolvedValue({ isBot: false });
});

describe("POST /api/submit", () => {
  it("rejects missing required fields", async () => {
    const res = await POST(req({ name: "", role: "", team: "", metrics: [] }));
    expect(res.status).toBe(400);
    expect(inserted.length).toBe(0);
  });
  it("rejects zero metrics", async () => {
    const res = await POST(req({ name: "A", role: "PM", team: "Crystal", metrics: [] }));
    expect(res.status).toBe(400);
  });
  it("rejects bots", async () => {
    checkBotId.mockResolvedValue({ isBot: true });
    const res = await POST(req({ name: "A", role: "PM", team: "Crystal", metrics: ["occupancy"] }));
    expect(res.status).toBe(403);
    expect(inserted.length).toBe(0);
  });
  it("inserts on the happy path", async () => {
    const res = await POST(req({ name: "A", role: "PM", team: "Crystal", metrics: ["occupancy"], notes: "x" }));
    expect(res.status).toBe(200);
    expect(inserted.length).toBe(1);
  });
});
