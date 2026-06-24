import { describe, it, expect, vi, beforeEach } from "vitest";

const inserted: string[] = [];
vi.mock("@/lib/db", () => ({
  insertFeedback: vi.fn(async (notes: string) => { inserted.push(notes); }),
}));

// Control the cookie + expected tokens.
let cookieToken: string | undefined;
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (_: string) => (cookieToken ? { value: cookieToken } : undefined) }),
}));
vi.mock("@/lib/auth", async (orig) => {
  const actual = await (orig as () => Promise<typeof import("@/lib/auth")>)();
  return { ...actual, expectedTokens: async () => ({ base: "BASE", exec: "EXEC" }) };
});

import { POST } from "@/app/api/feedback/route";

function req(body: unknown) {
  return new Request("http://localhost/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => { inserted.length = 0; cookieToken = undefined; });

describe("POST /api/feedback", () => {
  it("rejects without the exec token", async () => {
    cookieToken = "BASE"; // base session cannot post feedback
    const res = await POST(req({ notes: "hi" }));
    expect(res.status).toBe(401);
    expect(inserted.length).toBe(0);
  });
  it("rejects empty notes", async () => {
    cookieToken = "EXEC";
    const res = await POST(req({ notes: "   " }));
    expect(res.status).toBe(400);
  });
  it("inserts with the exec token", async () => {
    cookieToken = "EXEC";
    const res = await POST(req({ notes: "great dashboard" }));
    expect(res.status).toBe(200);
    expect(inserted).toContain("great dashboard");
  });
});
