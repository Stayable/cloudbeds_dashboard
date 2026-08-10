import { createMcpHandler } from "mcp-handler";
import { buildMcpServer } from "@/lib/mcp/server";
import { mcpSecretOk } from "@/lib/mcp/auth";
import { allow } from "@/lib/ratelimit";

// Remote MCP server for Rob's Claude Desktop connector (spec 2026-08-11).
//
// The secret lives in the PATH, which is why this route has a dynamic segment.
// mcp-handler does not inspect the pathname — it serves every request it is
// handed — so we check the secret first and pass the request through untouched.
//
// Gated here rather than in middleware, the same way /api/report-file is: the
// route self-checks its own credential and is excluded from the PIN matcher.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const handler = createMcpHandler(buildMcpServer, {
  serverInfo: { name: "stayable-dashboard", version: "1.0.0" },
});

async function guard(req: Request, params: Promise<{ secret: string }>): Promise<Response> {
  const { secret } = await params;
  // 404, not 401: a 401 confirms something exists at this path and invites a
  // guess at the credential's shape. A stranger should see an empty universe.
  if (!mcpSecretOk(secret)) return new Response("Not found", { status: 404 });
  if (!allow("mcp", 120, 60_000)) return new Response("Too many requests", { status: 429 });
  return handler(req);
}

export async function POST(req: Request, ctx: { params: Promise<{ secret: string }> }) {
  return guard(req, ctx.params);
}

export async function GET(req: Request, ctx: { params: Promise<{ secret: string }> }) {
  return guard(req, ctx.params);
}
