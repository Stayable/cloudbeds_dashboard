import { describe, it, expect, vi, beforeEach } from "vitest";

const resolveMcpToken = vi.fn();
const allow = vi.fn();

vi.mock("@/lib/mcp/auth", () => ({
  resolveMcpToken: (...a: unknown[]) => resolveMcpToken(...a),
}));
vi.mock("@/lib/ratelimit", () => ({
  allow: (...a: unknown[]) => allow(...a),
}));

import { POST } from "./route";

// The ONLY test that exercises the real route — everything else in lib/mcp is
// unit-tested against pure functions. This locks in the access-control promise:
// an unresolvable token 404s (never 401 — see route.ts), a resolvable one
// actually reaches the MCP handler and completes a JSON-RPC handshake, and the
// rate limiter is keyed PER TOKEN rather than globally (TODO 9q).

const TOKEN = "a".repeat(64);

const INITIALIZE = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "route-test", version: "1.0.0" },
  },
};

function post(secretInPath: string) {
  const request = new Request(`http://localhost/api/mcp/${secretInPath}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // Streamable HTTP requires the client to accept both; without this the
      // SDK would reject the request for reasons unrelated to what we test.
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(INITIALIZE),
  });
  return POST(request, { params: Promise.resolve({ secret: secretInPath }) });
}

beforeEach(() => {
  resolveMcpToken.mockReset();
  allow.mockReset();
  allow.mockReturnValue(true);
});

describe("POST /api/mcp/[secret]", () => {
  it("404s an unresolvable token rather than confirming the endpoint exists", async () => {
    resolveMcpToken.mockResolvedValue(null);
    const res = await post("the-wrong-token-entirely");
    expect(res.status).toBe(404);
  });

  it("404s an empty secret segment", async () => {
    resolveMcpToken.mockResolvedValue(null);
    const res = await post("");
    expect(res.status).toBe(404);
  });

  it("does not consult the rate limiter for a rejected token", async () => {
    resolveMcpToken.mockResolvedValue(null);
    await post("nope");
    expect(allow).not.toHaveBeenCalled();
  });

  // THE TODO 9q FIX. One global bucket meant four users throttled each other.
  it("keys the rate limiter on the resolved token id", async () => {
    resolveMcpToken.mockResolvedValue({ id: 7, email: "rb@rise8companies.com", label: null });
    await post(TOKEN);
    expect(allow).toHaveBeenCalledWith("mcp:7", 120, 60_000);
  });

  it("gives two tokens two different buckets", async () => {
    resolveMcpToken.mockResolvedValue({ id: 7, email: null, label: null });
    await post(TOKEN);
    resolveMcpToken.mockResolvedValue({ id: 8, email: null, label: null });
    await post(TOKEN);
    const keys = allow.mock.calls.map((c) => c[0]);
    expect(keys).toEqual(["mcp:7", "mcp:8"]);
  });

  it("429s when that token's bucket is exhausted", async () => {
    resolveMcpToken.mockResolvedValue({ id: 7, email: null, label: null });
    allow.mockReturnValue(false);
    const res = await post(TOKEN);
    expect(res.status).toBe(429);
  });

  it("completes an MCP initialize handshake for a resolvable token", async () => {
    resolveMcpToken.mockResolvedValue({ id: 7, email: null, label: null });
    const res = await post(TOKEN);
    expect(res.status).toBe(200);

    const contentType = res.headers.get("content-type") ?? "";
    expect(contentType).toMatch(/application\/json|text\/event-stream/);

    // Read the JSON-RPC response back out, whichever transport encoding the
    // handler chose, and confirm it is a real response to OUR initialize call
    // — not just "some 200".
    const text = await res.text();
    const payload = contentType.includes("text/event-stream")
      ? JSON.parse(text.split("data: ")[1]?.split("\n")[0] ?? "null")
      : JSON.parse(text);
    expect(payload.jsonrpc).toBe("2.0");
    expect(payload.id).toBe(1);
    expect(payload.result?.serverInfo?.name).toBe("stayable-dashboard");
  });
});
