// Assembles the tool manifest and registers it with the MCP server.
//
// Tools are declared as data (McpToolDef) rather than registered inline, so the
// two cross-cutting rules — every tool carries freshness, no tool emits guest
// PII — can be enforced by a test that iterates ALL_TOOLS. Inline registration
// would make both rules unenforceable, and unenforceable rules rot.

import type { McpServer } from "@modelcontextprotocol/server";
import { McpArgError, type McpToolDef } from "./types";

/** Every tool the server exposes. Tools modules are appended here as they land. */
export const ALL_TOOLS: McpToolDef[] = [];

export function buildMcpServer(server: McpServer): void {
  for (const tool of ALL_TOOLS) {
    server.registerTool(
      tool.name,
      { title: tool.title, description: tool.description, inputSchema: tool.inputSchema },
      async (args: unknown) => {
        try {
          const payload = await tool.handler(args);
          return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
        } catch (e) {
          // A caller mistake gets its own message so the model can correct
          // itself. Anything else is reported WITHOUT its detail: this reply
          // leaves our infrastructure for a third-party desktop client, and a
          // stack trace or connection string must never ride along.
          const message =
            e instanceof McpArgError
              ? e.message
              : `The ${tool.name} tool could not complete. The data source did not respond as expected.`;
          if (!(e instanceof McpArgError)) console.error(`[mcp] ${tool.name} failed:`, e);
          return { content: [{ type: "text" as const, text: message }], isError: true };
        }
      },
    );
  }
}
