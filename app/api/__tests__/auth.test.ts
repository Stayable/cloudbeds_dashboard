import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

const findLevelByPin = vi.fn();
vi.mock("@/lib/pins", () => ({
  findLevelByPin: (...a: unknown[]) => findLevelByPin(...a),
}));

import { POST } from "@/app/api/auth/route";

beforeAll(() => {
  process.env.AUTH_SECRET = "test-secret-please-change";
});

function req(body: unknown, ip: string) {
  return new Request("http://localhost/api/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  findLevelByPin.mockReset();
  findLevelByPin.mockResolvedValue("base");
});

// Finding 3: /api/auth had no rate limit. A guessed PIN mints a connector URL
// (via /connectors) that outlives the PIN it was minted from once rotated, so
// this endpoint needs the same abuse guard /api/submit already has — just a
// looser one (10/60s vs 5/60s), because it's a shared team login where a
// failed attempt is more likely a typo than an attack.
describe("POST /api/auth", () => {
  it("logs in normally, well under the rate limit", async () => {
    const res = await POST(req({ pin: "MAIN" }, "10.0.0.1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("401s an invalid PIN when under the rate limit", async () => {
    findLevelByPin.mockResolvedValue(null);
    const res = await POST(req({ pin: "wrong" }, "10.0.0.4"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false });
  });

  it("429s the 11th attempt from one IP inside the 60s window", async () => {
    const ip = "10.0.0.2";
    for (let i = 0; i < 10; i++) {
      const res = await POST(req({ pin: "MAIN" }, ip));
      expect(res.status).toBe(200);
    }
    const res = await POST(req({ pin: "MAIN" }, ip));
    expect(res.status).toBe(429);
  });

  // The 429 body must be indistinguishable from the 401 body — otherwise the
  // rate limit itself leaks whether the PIN was ever going to be valid.
  it("the 429 response does not reveal whether the submitted PIN was valid", async () => {
    const ip = "10.0.0.5";
    for (let i = 0; i < 10; i++) {
      await POST(req({ pin: "MAIN" }, ip));
    }
    findLevelByPin.mockResolvedValue(null); // would have been a 401 if not throttled
    const res = await POST(req({ pin: "would-have-been-invalid" }, ip));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ ok: false });
    expect(findLevelByPin).not.toHaveBeenCalledWith("would-have-been-invalid");
  });

  it("does not rate-limit a different IP", async () => {
    const res = await POST(req({ pin: "MAIN" }, "10.0.0.3"));
    expect(res.status).toBe(200);
  });
});
