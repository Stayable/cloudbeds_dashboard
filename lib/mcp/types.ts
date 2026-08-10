// Shared types for the MCP tool surface.
//
// Every tool returns an McpPayload — data PLUS the freshness of that data.
// That pairing is the point: a model handed a bare number states it as current,
// confidently, with no page around it to carry a caveat. See the spec §7.

import type { z } from "zod";

/** Where a figure came from and how current it is. */
export type Freshness = {
  source: "snapshot" | "live" | "smartsheet" | "elise";
  /** Newest data point we hold — YYYY-MM-DD, or an ISO timestamp for live/sync. */
  asOf: string | null;
  /** Snapshot only: the last stay date frozen as final. */
  finalThrough?: string | null;
  /** One human sentence the model can quote back to Rob verbatim. */
  note: string;
};

export type McpPayload = { data: unknown; freshness: Freshness };

export type McpToolDef = {
  name: string;
  title: string;
  description: string;
  /** A FULL schema object (z.object({...})), not a raw shape — changed in
   *  mcp-handler 2.x and an easy silent mistake. */
  inputSchema: z.ZodType;
  handler: (args: any) => Promise<McpPayload>;
};

/** A bad argument from the caller, not a server fault. `server.ts` turns this
 *  into a tool error the model can read and correct, rather than a 500. */
export class McpArgError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpArgError";
  }
}
