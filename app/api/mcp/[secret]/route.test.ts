import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { POST } from "./route";

// M3 (final review): the ONLY test that exercises the real route — everything
// else in lib/mcp is unit-tested against pure functions and never touches
// mcp-handler or the secret check. This is what locks in the access-control
// behaviour spec §3/§9 promise: a wrong secret 404s (never 401 — see route.ts's
// comment on why), and a correct one actually reaches the MCP handler and
// completes a JSON-RPC handshake, not just "didn't throw".

const SECRET = "s".repeat(64);
let originalSecret: string | undefined;

beforeEach(() => {
  originalSecret = process.env.MCP_SECRET;
  process.env.MCP_SECRET = SECRET;
});

afterEach(() => {
  if (originalSecret === undefined) delete process.env.MCP_SECRET;
  else process.env.MCP_SECRET = originalSecret;
});

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
      // Streamable HTTP requires the client to accept both; a request lacking
      // this would be rejected by the SDK for reasons unrelated to the secret
      // check this test exists to prove.
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(INITIALIZE),
  });
  return POST(request, { params: Promise.resolve({ secret: secretInPath }) });
}

describe("POST /api/mcp/[secret]", () => {
  it("404s a wrong secret rather than confirming the endpoint exists", async () => {
    const res = await post("the-wrong-secret-entirely");
    expect(res.status).toBe(404);
  });

  it("404s an empty secret segment", async () => {
    const res = await post("");
    expect(res.status).toBe(404);
  });

  it("completes an MCP initialize handshake for the correct secret", async () => {
    const res = await post(SECRET);
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
