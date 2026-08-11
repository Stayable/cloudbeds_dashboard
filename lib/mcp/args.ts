// One place tools validate a caller-supplied date argument.
//
// A NEW file rather than adding this to types.ts (which is deliberately kept
// to plain type/shape declarations, no imports from lib/dates or logic that
// runs at call time) — this module has both a runtime predicate and a zod
// schema built on it. Task-9 brief explicitly offers this as the alternative
// to types.ts; picked it to keep "what shape is a tool" separate from "how do
// we validate one specific argument".
//
// Two layers, on purpose, not one:
//  - `ymdArgSchema` documents the format on the tool's inputSchema, for
//    whatever the framework's own schema validation catches before a handler
//    ever runs.
//  - `parseYmdArg` is called EXPLICITLY inside each handler, because this
//    repo's own tests call `tool.handler(args)` directly (see
//    tools-report.test.ts, tools-occupancy.test.ts) — bypassing the
//    framework's schema validation entirely, the same way bucketRange's
//    `assertYmd` (lib/mcp/buckets.ts) already does for get_occupancy. Relying
//    on the schema alone would leave get_daily_report/get_report_file/
//    get_portfolio_summary unvalidated in every unit test, and — if the
//    schema layer is ever swapped or short-circuited — unvalidated for real.

import { z } from "zod";
import { isValidYmd } from "@/lib/dates";
import { McpArgError } from "./types";

/** A date argument's type for a tool's `inputSchema`: format-checked as a
 *  real calendar date, not just an 8-digit-ish string. Chain `.describe(...)`
 *  or `.optional()` per call site same as any zod schema. */
export const ymdArgSchema = z
  .string()
  .refine(isValidYmd, "must be a real calendar date in YYYY-MM-DD form");

/** Validate one caller-supplied date string, throwing the same McpArgError
 *  every other bad argument in this MCP surface becomes — never a raw zod
 *  error, and never a downstream crash inside buildRevenueReport or a SQL
 *  query built from an un-checked string. */
export function parseYmdArg(label: string, value: string): string {
  if (!isValidYmd(value)) {
    throw new McpArgError(`${label} must be a real calendar date in YYYY-MM-DD form, got "${value}".`);
  }
  return value;
}
