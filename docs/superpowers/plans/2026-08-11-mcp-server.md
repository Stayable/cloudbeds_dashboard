# Stayable MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A remote MCP server inside the dashboard app so Rob can ask Claude Desktop about Stayable's operating numbers, pull the revenue report, and reach the Smartsheet and EliseAI data — reached by pasting one URL into Claude Desktop's custom-connector dialog.

**Architecture:** A Next.js route handler at `app/api/mcp/[secret]/route.ts` checks a secret path segment, then hands the untouched request to `mcp-handler`. Tool handlers call the app's existing `lib/*` functions directly, so answers are computed by the same code as `/report`. Every tool returns a freshness envelope alongside its data.

**Tech Stack:** Next.js 15 App Router, TypeScript, `mcp-handler` ^2.1.0, `@modelcontextprotocol/server` ^2.0.0, `zod` ^4.4.3, vitest.

**Source spec:** `docs/superpowers/specs/2026-08-11-mcp-server-design.md` — approved by Kyle 08/11/26. Read it before starting.

## Global Constraints

- **Branch:** `claude/nifty-thompson-ts8zny`. Never push to another branch. Do not open a PR.
- **Read-only. No tool writes anything** — not Cloudbeds (CLAUDE.md §5 rule 3), not Smartsheet, not Neon.
- **No guest PII in any tool output — ever.** No name, email, phone, or reservation-level detail. The `/bea` §3 exception is scoped to that one PIN-gated table and does not extend here. Enforced by a test over the tool manifest.
- **Every tool returns a freshness envelope.** Enforced by a test that iterates the manifest, so a new tool cannot be added without one.
- **A tool that cannot reach its source says so. It never returns zeros.** Zeros are indistinguishable from real data and propagate silently (the Cloudbeds 429-zeros incident).
- **A wrong secret returns 404, not 401**, and no `WWW-Authenticate` header. A 401 confirms the endpoint exists.
- **Fail closed:** if `MCP_SECRET` is unset or shorter than 32 characters, every request 404s.
- **Errors never leak** a credential, connection string, internal path, or stack trace — the reply goes to a third-party desktop client.
- **Property resolution is one definition** (`lib/mcp/properties.ts`), bucketing is one definition (`lib/mcp/buckets.ts`), freshness is one definition (`lib/mcp/freshness.ts`). This repo has been bitten by one meaning with two implementations.
- **Weekly/monthly figures are a ratio of sums, never a mean of daily percentages.** A 30%-occupied day at a 153-room property must not weigh the same as one at a 127-room property.
- Comments explain WHY, not what, matching the voice of the existing heavily-commented `lib/*.ts` files.
- **Test command:** `npm test` (vitest: `lib/**/*.test.ts`, `app/**/*.test.ts`, `config/**/*.test.ts`). Typecheck: `npx tsc --noEmit`. Build: `npm run build`.
- **Commit after every task**, message style `feat(mcp): …` / `fix(mcp): …`, ending with the trailer `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

---

## File Structure

| File | Responsibility | Depends on |
|---|---|---|
| `lib/mcp/types.ts` | `Freshness`, `McpPayload`, `McpToolDef`, `McpArgError` | `zod` |
| `lib/mcp/auth.ts` | `mcpSecretOk` — constant-time secret check, fails closed | — |
| `lib/mcp/properties.ts` | resolve a user string to a property; error names valid options | `config/properties` |
| `lib/mcp/freshness.ts` | the one freshness envelope every tool attaches | `lib/db`, `lib/elise-status` |
| `lib/mcp/buckets.ts` | daily/weekly/monthly bucketing + ratio-of-sums rollup | `lib/dates` |
| `lib/mcp/tools-occupancy.ts` | `list_properties`, `get_occupancy`, `get_portfolio_summary` | `lib/db`, properties, buckets, freshness |
| `lib/mcp/tools-report.ts` | `get_daily_report`, `get_report_file` | `lib/cloudbeds`, `lib/report-pdf`, `lib/report-xlsx` |
| `lib/mcp/tools-live.ts` | `get_today` | `lib/cloudbeds` |
| `lib/mcp/tools-ops.ts` | `get_evictions`, `get_contractor_schedule`, `get_reviews`, `get_leasing_funnel` | `lib/smartsheet`, `lib/reviews`, `lib/leasing`, `lib/contractor-schedule`, `lib/db` |
| `lib/mcp/server.ts` | `ALL_TOOLS` manifest + `buildMcpServer` registration | every tools module |
| `app/api/mcp/[secret]/route.ts` | the endpoint: secret, rate limit, hand off | `mcp-handler`, `lib/mcp/*`, `lib/ratelimit` |
| `middleware.ts` (modify) | exclude `api/mcp` from the PIN gate | — |

**Why a manifest rather than registering inline.** Each tools module exports a `McpToolDef[]`; `server.ts` concatenates them into `ALL_TOOLS` and registers them generically. This is what makes the two cross-cutting rules testable: a test iterates `ALL_TOOLS` and asserts every handler returns a freshness envelope and that no output contains a name-shaped field. Registering inline would make both rules unenforceable and they would rot.

---

### Task 1: The gated endpoint

**Files:**
- Modify: `package.json` (three dependencies)
- Create: `lib/mcp/types.ts`
- Create: `lib/mcp/auth.ts`
- Create: `lib/mcp/auth.test.ts`
- Create: `lib/mcp/server.ts`
- Create: `app/api/mcp/[secret]/route.ts`
- Modify: `middleware.ts:30`

**Interfaces:**
- Consumes: `allow(key, limit, windowMs)` from `lib/ratelimit.ts`.
- Produces:
  - `type Freshness = { source: "snapshot" | "live" | "smartsheet" | "elise"; asOf: string | null; finalThrough?: string | null; note: string }`
  - `type McpPayload = { data: unknown; freshness: Freshness }`
  - `type McpToolDef = { name: string; title: string; description: string; inputSchema: z.ZodType; handler: (args: any) => Promise<McpPayload> }`
  - `class McpArgError extends Error`
  - `function mcpSecretOk(candidate: string | undefined): boolean`
  - `const ALL_TOOLS: McpToolDef[]`
  - `function buildMcpServer(server: McpServer): void`

- [ ] **Step 1: Install the dependencies**

Run: `npm install mcp-handler@^2 @modelcontextprotocol/server@^2 zod@^4`

Confirm the installed versions and record them:
Run: `node -p "['mcp-handler','@modelcontextprotocol/server','zod'].map(p=>p+' '+require(p+'/package.json').version).join('\n')"`

- [ ] **Step 2: Write the failing test**

Create `lib/mcp/auth.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { mcpSecretOk } from "./auth";

const REAL = "a".repeat(64);
const original = process.env.MCP_SECRET;
afterEach(() => {
  if (original === undefined) delete process.env.MCP_SECRET;
  else process.env.MCP_SECRET = original;
});

describe("mcpSecretOk", () => {
  it("accepts the configured secret", () => {
    process.env.MCP_SECRET = REAL;
    expect(mcpSecretOk(REAL)).toBe(true);
  });

  it("rejects a wrong secret of the same length", () => {
    process.env.MCP_SECRET = REAL;
    expect(mcpSecretOk("b".repeat(64))).toBe(false);
  });

  it("rejects a prefix of the real secret", () => {
    process.env.MCP_SECRET = REAL;
    expect(mcpSecretOk("a".repeat(63))).toBe(false);
  });

  it("rejects undefined and empty", () => {
    process.env.MCP_SECRET = REAL;
    expect(mcpSecretOk(undefined)).toBe(false);
    expect(mcpSecretOk("")).toBe(false);
  });

  // Fails CLOSED: an unset env var must not make every request valid, and it
  // must not make an empty path segment valid either.
  it("rejects everything when MCP_SECRET is unset", () => {
    delete process.env.MCP_SECRET;
    expect(mcpSecretOk(REAL)).toBe(false);
    expect(mcpSecretOk("")).toBe(false);
    expect(mcpSecretOk(undefined)).toBe(false);
  });

  // A short secret is a typo or a placeholder, not a credential. Refusing it
  // turns "someone pasted 'changeme'" into a dead endpoint rather than a
  // guessable one.
  it("refuses to operate on a secret shorter than 32 characters", () => {
    process.env.MCP_SECRET = "short";
    expect(mcpSecretOk("short")).toBe(false);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run lib/mcp/auth.test.ts`
Expected: FAIL — `Failed to resolve import "./auth"`.

- [ ] **Step 4: Write the types**

Create `lib/mcp/types.ts`:

```ts
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
```

- [ ] **Step 5: Write the secret check**

Create `lib/mcp/auth.ts`:

```ts
// The MCP endpoint's only gate: a secret path segment.
//
// Kyle chose this over OAuth 2.1 on 08/11/26 (spec §3). The URL IS the
// credential, so the comparison must not leak length or content through timing,
// and it must fail closed — a missing env var making every request valid would
// publish the portfolio's numbers to the internet.

/** Shortest value we will accept as a real secret. Anything shorter is a typo
 *  or a placeholder like "changeme"; refusing it turns a guessable endpoint
 *  into a dead one. */
const MIN_SECRET_LENGTH = 32;

export function mcpSecretOk(candidate: string | undefined): boolean {
  const expected = process.env.MCP_SECRET ?? "";
  if (expected.length < MIN_SECRET_LENGTH) return false; // fail closed
  if (!candidate || candidate.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < candidate.length; i++) {
    diff |= candidate.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run lib/mcp/auth.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 7: Write the server registration**

Create `lib/mcp/server.ts`:

```ts
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
```

- [ ] **Step 8: Write the route**

Create `app/api/mcp/[secret]/route.ts`:

```ts
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
```

- [ ] **Step 9: Exclude the route from the PIN gate**

Modify `middleware.ts:30`. Add `api/mcp(?:/.*)?` to the negative lookahead, immediately after `api/cron(?:/.*)?`, so the matcher reads:

```
"/((?!login|api/auth|api/cron(?:/.*)?|api/mcp(?:/.*)?|api/submit(?:/.*)?|api/feedback(?:/.*)?|api/crystal-note(?:/.*)?|api/report-file(?:/.*)?|api/change-pin(?:/.*)?|api/reviews-window(?:/.*)?|test(?:/.*)?|_next/static|_next/image|favicon.ico|robots.txt).*)",
```

Extend the comment block above `matcher` (currently ending "...Next internals, and static files.") by adding this sentence before that closing phrase:

```
// the MCP endpoint (self-checks a secret in its own path — it is called by
// Claude Desktop, which has no cookie and no PIN),
```

- [ ] **Step 10: Set a local secret and verify the route end to end**

Generate a secret and put it in `.env.local` (create the line; do not disturb existing lines):

```bash
node -e "console.log('MCP_SECRET=' + require('crypto').randomBytes(32).toString('hex'))"
```

Start the dev server, then check both paths. Replace `<SECRET>` with the value:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/mcp/wrongsecret
curl -s -X POST http://localhost:3000/api/mcp/<SECRET> \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
```

Expected: `404` for the wrong secret; a JSON-RPC result naming `stayable-dashboard` for the right one. Stop the dev server afterwards. Record both outputs in your report.

If the initialize call fails, read `node_modules/mcp-handler/README.md` and `node_modules/mcp-handler/dist/index.d.ts` — they are the authority on the current signature. Do not guess at the API shape.

- [ ] **Step 11: Run the full suite and typecheck**

Run: `npx tsc --noEmit && npm test`
Expected: exit 0; all pre-existing tests plus the 6 new ones.

- [ ] **Step 12: Commit**

```bash
git add package.json package-lock.json lib/mcp app/api/mcp middleware.ts
git commit -m "feat(mcp): gated MCP endpoint with a secret in the path"
```

---

### Task 2: Property resolution

**Files:**
- Create: `lib/mcp/properties.ts`
- Create: `lib/mcp/properties.test.ts`

**Interfaces:**
- Consumes: `PROPERTIES`, `type Property` from `config/properties.ts`; `McpArgError` from `lib/mcp/types.ts`.
- Produces:
  - `function resolveProperty(input: string): Property`
  - `function resolveProperties(input?: string[]): Property[]`
  - `function propertySummary(p: Property): { id: string; code: string; name: string; county: string; active: boolean | "unconfirmed" }`

- [ ] **Step 1: Write the failing test**

Create `lib/mcp/properties.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveProperty, resolveProperties, propertySummary } from "./properties";
import { McpArgError } from "./types";
import { PROPERTIES } from "@/config/properties";

describe("resolveProperty", () => {
  it("resolves by business id", () => {
    expect(resolveProperty("4645").name).toBe("Lakeland");
  });

  it("resolves by name, case-insensitively and ignoring surrounding space", () => {
    expect(resolveProperty("  lakeland ").id).toBe("4645");
  });

  it("resolves by short code", () => {
    const dp = PROPERTIES.find((p) => p.id === "44199")!;
    expect(resolveProperty(dp.code).id).toBe("44199");
  });

  it("resolves a distinctive partial name", () => {
    expect(resolveProperty("davenport").id).toBe("44199");
  });

  // "Kissimmee" matches both East and West. Guessing one would answer a
  // question the user did not ask, with no sign anything went wrong.
  it("refuses an ambiguous partial and names the candidates", () => {
    try {
      resolveProperty("kissimmee");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(McpArgError);
      expect((e as Error).message).toMatch(/Kissimmee East/);
      expect((e as Error).message).toMatch(/Kissimmee West/);
    }
  });

  it("errors on an unknown property and lists the valid ones", () => {
    try {
      resolveProperty("Lakeside");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(McpArgError);
      expect((e as Error).message).toMatch(/Lakeside/);
      expect((e as Error).message).toMatch(/Lakeland/);
      expect((e as Error).message).toMatch(/Orlando OBT/);
    }
  });

  it("errors on an empty string rather than returning something", () => {
    expect(() => resolveProperty("   ")).toThrow(McpArgError);
  });
});

describe("resolveProperties", () => {
  it("returns every active property when given nothing", () => {
    const all = resolveProperties();
    expect(all.length).toBe(PROPERTIES.filter((p) => p.active === true).length);
  });

  it("returns the named subset, de-duplicated", () => {
    const some = resolveProperties(["Lakeland", "4645", "Davenport"]);
    expect(some.map((p) => p.id).sort()).toEqual(["4645", "44199"].sort());
  });

  it("propagates the error for one bad name in a list", () => {
    expect(() => resolveProperties(["Lakeland", "Nowhere"])).toThrow(McpArgError);
  });
});

describe("propertySummary", () => {
  it("exposes identity fields and nothing else", () => {
    const s = propertySummary(PROPERTIES.find((p) => p.id === "4645")!);
    expect(Object.keys(s).sort()).toEqual(["active", "code", "county", "id", "name"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/mcp/properties.test.ts`
Expected: FAIL — `Failed to resolve import "./properties"`.

- [ ] **Step 3: Write the implementation**

Create `lib/mcp/properties.ts`:

```ts
// Turn whatever Rob typed into a property, or an error that tells him why not.
//
// ONE definition of property resolution. The failure mode this prevents is the
// expensive one: "occupancy at Lakeside" silently answering for the whole
// portfolio, or for the wrong property. A confident wrong answer about the
// wrong hotel is worse than an error, because nothing about it looks wrong.

import { PROPERTIES, type Property } from "@/config/properties";
import { McpArgError } from "./types";

const norm = (s: string) => s.trim().toLowerCase();

function validOptions(): string {
  return PROPERTIES.map((p) => `${p.name} (${p.id})`).join(", ");
}

/** Resolve one property by name, short code, or business id. Partial names are
 *  accepted only when they match exactly one property. */
export function resolveProperty(input: string): Property {
  const q = norm(input);
  if (!q) throw new McpArgError(`No property given. Valid properties: ${validOptions()}.`);

  const exact = PROPERTIES.find(
    (p) => norm(p.name) === q || norm(p.code) === q || p.id === q || p.apiPropertyId === q,
  );
  if (exact) return exact;

  const partial = PROPERTIES.filter((p) => norm(p.name).includes(q));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) {
    throw new McpArgError(
      `"${input}" matches more than one property: ${partial.map((p) => p.name).join(", ")}. ` +
        `Ask again with the full name.`,
    );
  }
  throw new McpArgError(`"${input}" is not a Stayable property. Valid properties: ${validOptions()}.`);
}

/** Resolve a list, or every ACTIVE property when the caller names none.
 *  Defaulting to active-only keeps a portfolio question from being dragged down
 *  by a property that is not trading. */
export function resolveProperties(input?: string[]): Property[] {
  if (!input || input.length === 0) return PROPERTIES.filter((p) => p.active === true);
  const seen = new Set<string>();
  const out: Property[] = [];
  for (const name of input) {
    const p = resolveProperty(name);
    if (!seen.has(p.id)) {
      seen.add(p.id);
      out.push(p);
    }
  }
  return out;
}

/** The identity fields a tool may return. Deliberately explicit rather than
 *  spreading the Property: a new internal field on Property must not silently
 *  become part of the public tool output. */
export function propertySummary(p: Property) {
  return { id: p.id, code: p.code, name: p.name, county: p.county, active: p.active };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/mcp/properties.test.ts`
Expected: PASS.

If the "distinctive partial name" or ambiguity tests fail, read `config/properties.ts` and adjust the TEST fixtures to real property names — do not loosen the matching rules to make a wrong name pass.

- [ ] **Step 5: Commit**

```bash
git add lib/mcp/properties.ts lib/mcp/properties.test.ts
git commit -m "feat(mcp): resolve a property by name, code or id, or say why not"
```

---

### Task 3: The freshness envelope

**Files:**
- Create: `lib/mcp/freshness.ts`
- Create: `lib/mcp/freshness.test.ts`

**Interfaces:**
- Consumes: `Freshness` from `lib/mcp/types.ts`; `getSnapshotFreshness`, `getFinalThrough`, `type EliseSyncStatus` from `lib/db.ts`; `eliseBanner` from `lib/elise-status.ts`.
- Produces:
  - `function describeSnapshot(f: { latestCapturedDate: string | null; propertiesOnLatest: number }, finalThrough: string | null): Freshness`
  - `function snapshotFreshness(): Promise<Freshness>`
  - `function liveFreshness(nowIso: string): Freshness`
  - `function describeElise(status: EliseSyncStatus, nowIso: string): Freshness`
  - `function smartsheetFreshness(nowIso: string): Freshness`

- [ ] **Step 1: Write the failing test**

Create `lib/mcp/freshness.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { describeSnapshot, liveFreshness, describeElise, smartsheetFreshness } from "./freshness";
import type { EliseSyncStatus } from "@/lib/db";

const NOW = "2026-08-11T14:00:00.000Z";

const eliseStatus = (over: Partial<EliseSyncStatus> = {}): EliseSyncStatus => ({
  lastAttemptAt: null,
  lastAttemptOk: null,
  lastError: null,
  lastSuccessAt: null,
  consecutiveFailures: 0,
  ...over,
});

describe("describeSnapshot", () => {
  it("reports the last captured day and what is final", () => {
    const f = describeSnapshot({ latestCapturedDate: "2026-08-10", propertiesOnLatest: 8 }, "2026-07-31");
    expect(f.source).toBe("snapshot");
    expect(f.asOf).toBe("2026-08-10");
    expect(f.finalThrough).toBe("2026-07-31");
    expect(f.note).toContain("2026-08-10");
  });

  // An empty store must not read as "current". Silence is not freshness.
  it("says plainly when nothing has been captured", () => {
    const f = describeSnapshot({ latestCapturedDate: null, propertiesOnLatest: 0 }, null);
    expect(f.asOf).toBeNull();
    expect(f.note).toMatch(/no .*captur/i);
  });

  // A partial day is the dangerous one: the numbers look normal and are short.
  it("warns when only some properties captured on the latest day", () => {
    const f = describeSnapshot({ latestCapturedDate: "2026-08-10", propertiesOnLatest: 5 }, "2026-07-31");
    expect(f.note).toMatch(/5 of 8|incomplete|partial/i);
  });
});

describe("liveFreshness", () => {
  it("marks live data as read now", () => {
    const f = liveFreshness(NOW);
    expect(f.source).toBe("live");
    expect(f.asOf).toBe(NOW);
    expect(f.note).toMatch(/live|right now/i);
  });
});

describe("describeElise", () => {
  it("reports a healthy sync with its timestamp", () => {
    const f = describeElise(
      eliseStatus({ lastAttemptAt: "2026-08-11T12:00:00Z", lastAttemptOk: true, lastSuccessAt: "2026-08-11T12:00:00Z" }),
      NOW,
    );
    expect(f.source).toBe("elise");
    expect(f.asOf).toBe("2026-08-11T12:00:00Z");
    expect(f.note).not.toMatch(/not updating/i);
  });

  // The failure this exists for: the numbers are real but two days old, and
  // nothing in a chat reply would otherwise say so.
  it("states the failure and the age of the data we still hold", () => {
    const f = describeElise(
      eliseStatus({
        lastAttemptAt: "2026-08-11T12:00:00Z",
        lastAttemptOk: false,
        lastError: "Incorrect username or password was specified.",
        lastSuccessAt: "2026-08-09T12:00:00Z",
        consecutiveFailures: 3,
      }),
      NOW,
    );
    expect(f.asOf).toBe("2026-08-09T12:00:00Z");
    expect(f.note).toMatch(/not updating/i);
  });

  it("says so when the funnel has never synced", () => {
    expect(describeElise(eliseStatus(), NOW).note).toMatch(/never/i);
  });
});

describe("smartsheetFreshness", () => {
  it("is read live from Smartsheet", () => {
    const f = smartsheetFreshness(NOW);
    expect(f.source).toBe("smartsheet");
    expect(f.asOf).toBe(NOW);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/mcp/freshness.test.ts`
Expected: FAIL — `Failed to resolve import "./freshness"`.

- [ ] **Step 3: Write the implementation**

Create `lib/mcp/freshness.ts`:

```ts
// One definition of "how current is this", attached to every tool result.
//
// This is the most important property in the MCP surface (spec §7). A model
// handed a bare number will state it as today's, confidently, and there is no
// page around the answer to carry a caveat the way the dashboard has. The
// `note` is written as a sentence precisely so the model can quote it.

import { getFinalThrough, getSnapshotFreshness, type EliseSyncStatus } from "@/lib/db";
import { eliseBanner } from "@/lib/elise-status";
import { PROPERTIES } from "@/config/properties";
import type { Freshness } from "./types";

const ACTIVE_COUNT = PROPERTIES.filter((p) => p.active === true).length;

/** Pure half of snapshotFreshness, so the wording is testable without a DB. */
export function describeSnapshot(
  f: { latestCapturedDate: string | null; propertiesOnLatest: number },
  finalThrough: string | null,
): Freshness {
  if (!f.latestCapturedDate) {
    return {
      source: "snapshot",
      asOf: null,
      finalThrough,
      note: "No days have been captured yet, so there are no figures to report.",
    };
  }
  const partial =
    f.propertiesOnLatest > 0 && f.propertiesOnLatest < ACTIVE_COUNT
      ? ` Only ${f.propertiesOnLatest} of ${ACTIVE_COUNT} properties captured on that day, so it is incomplete.`
      : "";
  const final = finalThrough
    ? ` Figures through ${finalThrough} are final; later days can still move as the ledger settles.`
    : " No month has been closed yet, so every figure can still move.";
  return {
    source: "snapshot",
    asOf: f.latestCapturedDate,
    finalThrough,
    note: `Figures are from banked daily snapshots, last captured ${f.latestCapturedDate}.${partial}${final}`,
  };
}

export async function snapshotFreshness(): Promise<Freshness> {
  const [f, finalThrough] = await Promise.all([getSnapshotFreshness(), getFinalThrough()]);
  return describeSnapshot(f, finalThrough);
}

export function liveFreshness(nowIso: string): Freshness {
  return {
    source: "live",
    asOf: nowIso,
    note: `Read live from Cloudbeds right now (${nowIso}). This is today's state, not a banked figure.`,
  };
}

/** Reuses the SAME wording the dashboard shows for a failing sync, so Rob is
 *  never told one thing in chat and another on /ops. */
export function describeElise(status: EliseSyncStatus, nowIso: string): Freshness {
  const banner = eliseBanner(status, nowIso);
  if (!status.lastSuccessAt) {
    return {
      source: "elise",
      asOf: null,
      note: banner?.headline
        ? `Leasing data has never synced successfully. ${banner.headline}`
        : "Leasing data has never synced successfully, so there are no figures to report.",
    };
  }
  return {
    source: "elise",
    asOf: status.lastSuccessAt,
    note: banner?.headline
      ? `Leasing data is not updating. ${banner.headline}`
      : `Leasing data last synced from EliseAI at ${status.lastSuccessAt}.`,
  };
}

export function smartsheetFreshness(nowIso: string): Freshness {
  return {
    source: "smartsheet",
    asOf: nowIso,
    note: `Read live from Smartsheet at ${nowIso}.`,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/mcp/freshness.test.ts`
Expected: PASS.

`eliseBanner`'s exact return shape is in `lib/elise-status.ts` — read it and use the real field names. If it has no `headline` field, use whichever field carries the human sentence and keep the tests' assertions on the WORDING, not on the field name.

- [ ] **Step 5: Commit**

```bash
git add lib/mcp/freshness.ts lib/mcp/freshness.test.ts
git commit -m "feat(mcp): attach a freshness envelope to every answer"
```

---

### Task 4: Date bucketing and ratio-of-sums rollup

**Files:**
- Create: `lib/mcp/buckets.ts`
- Create: `lib/mcp/buckets.test.ts`

**Interfaces:**
- Consumes: `shiftYmd` from `lib/dates.ts`; `McpArgError` from `lib/mcp/types.ts`.
- Produces:
  - `type Granularity = "daily" | "weekly" | "monthly"`
  - `type Bucket = { key: string; from: string; to: string; partial: boolean }`
  - `function bucketRange(from: string, to: string, granularity: Granularity): Bucket[]`

- [ ] **Step 1: Write the failing test**

Create `lib/mcp/buckets.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { bucketRange } from "./buckets";
import { McpArgError } from "./types";

describe("bucketRange — daily", () => {
  it("returns one bucket per day, inclusive of both ends", () => {
    const b = bucketRange("2026-08-01", "2026-08-03", "daily");
    expect(b.map((x) => x.key)).toEqual(["2026-08-01", "2026-08-02", "2026-08-03"]);
    expect(b.every((x) => x.from === x.to && !x.partial)).toBe(true);
  });

  it("handles a single day", () => {
    expect(bucketRange("2026-08-01", "2026-08-01", "daily")).toHaveLength(1);
  });
});

describe("bucketRange — weekly", () => {
  // Weeks start Monday. 2026-08-03 is a Monday.
  it("splits on Monday boundaries", () => {
    const b = bucketRange("2026-08-03", "2026-08-16", "weekly");
    expect(b).toHaveLength(2);
    expect(b[0]).toMatchObject({ from: "2026-08-03", to: "2026-08-09", partial: false });
    expect(b[1]).toMatchObject({ from: "2026-08-10", to: "2026-08-16", partial: false });
  });

  // A partial week labelled as a whole one is how a short week gets read as a
  // bad week. The dates must be the real ones, and it must say it is partial.
  it("clips the first and last bucket to the range and marks them partial", () => {
    const b = bucketRange("2026-08-05", "2026-08-12", "weekly");
    expect(b[0]).toMatchObject({ from: "2026-08-05", to: "2026-08-09", partial: true });
    expect(b[1]).toMatchObject({ from: "2026-08-10", to: "2026-08-12", partial: true });
  });
});

describe("bucketRange — monthly", () => {
  it("splits on calendar months", () => {
    const b = bucketRange("2026-07-01", "2026-09-30", "monthly");
    expect(b.map((x) => x.key)).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect(b.every((x) => !x.partial)).toBe(true);
  });

  it("marks a clipped month partial with its real dates", () => {
    const b = bucketRange("2026-07-15", "2026-08-10", "monthly");
    expect(b[0]).toMatchObject({ from: "2026-07-15", to: "2026-07-31", partial: true });
    expect(b[1]).toMatchObject({ from: "2026-08-01", to: "2026-08-10", partial: true });
  });

  it("handles a February in a leap year", () => {
    const b = bucketRange("2028-02-01", "2028-02-29", "monthly");
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ from: "2028-02-01", to: "2028-02-29", partial: false });
  });
});

describe("bucketRange — bad input", () => {
  it("rejects an inverted range instead of returning nothing", () => {
    expect(() => bucketRange("2026-08-10", "2026-08-01", "daily")).toThrow(McpArgError);
  });

  it("rejects a malformed date", () => {
    expect(() => bucketRange("last tuesday", "2026-08-01", "daily")).toThrow(McpArgError);
  });

  // An unbounded range would pull the whole store into one reply.
  it("rejects a range longer than two years", () => {
    expect(() => bucketRange("2020-01-01", "2026-08-01", "daily")).toThrow(McpArgError);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/mcp/buckets.test.ts`
Expected: FAIL — `Failed to resolve import "./buckets"`.

- [ ] **Step 3: Write the implementation**

Create `lib/mcp/buckets.ts`:

```ts
// Split a date range into daily, weekly or monthly buckets.
//
// A bucket carries its REAL first and last date and whether the range clipped
// it, because a partial week presented as a whole one reads as a bad week. The
// caller sums within a bucket and divides once — a ratio of sums, never a mean
// of daily percentages, which would weigh a 30%-occupied day at a 153-room
// property the same as one at a 127-room property. Same rule as
// getOccupancyRollup and /report.

import { shiftYmd } from "@/lib/dates";
import { McpArgError } from "./types";

export type Granularity = "daily" | "weekly" | "monthly";

export type Bucket = {
  /** "2026-08-03" for daily/weekly (the bucket's nominal start), "2026-08" monthly. */
  key: string;
  from: string;
  to: string;
  /** True when the requested range clipped this bucket short. */
  partial: boolean;
};

/** Guards against a question that would pull the whole store into one reply. */
const MAX_DAYS = 732; // two years plus a leap day

const YMD = /^\d{4}-\d{2}-\d{2}$/;

function assertYmd(label: string, value: string): void {
  if (!YMD.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new McpArgError(`${label} must be a date in YYYY-MM-DD form, got "${value}".`);
  }
}

/** Day of week, 0 = Monday. */
function mondayIndex(ymd: string): number {
  return (new Date(`${ymd}T00:00:00Z`).getUTCDay() + 6) % 7;
}

function lastDayOfMonth(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  return end.toISOString().slice(0, 10);
}

function firstDayOfMonth(ymd: string): string {
  return `${ymd.slice(0, 7)}-01`;
}

export function bucketRange(from: string, to: string, granularity: Granularity): Bucket[] {
  assertYmd("from", from);
  assertYmd("to", to);
  if (from > to) {
    throw new McpArgError(`The start date ${from} is after the end date ${to}.`);
  }
  const spanDays = Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000,
  ) + 1;
  if (spanDays > MAX_DAYS) {
    throw new McpArgError(
      `That range is ${spanDays} days. Ask for two years or less, or use a coarser granularity.`,
    );
  }

  const out: Bucket[] = [];

  if (granularity === "daily") {
    for (let d = from; d <= to; d = shiftYmd(d, 1)) {
      out.push({ key: d, from: d, to: d, partial: false });
    }
    return out;
  }

  if (granularity === "weekly") {
    let cursor = from;
    while (cursor <= to) {
      const weekStart = shiftYmd(cursor, -mondayIndex(cursor));
      const weekEnd = shiftYmd(weekStart, 6);
      const bFrom = cursor;
      const bTo = weekEnd < to ? weekEnd : to;
      out.push({
        key: weekStart,
        from: bFrom,
        to: bTo,
        partial: bFrom !== weekStart || bTo !== weekEnd,
      });
      cursor = shiftYmd(bTo, 1);
    }
    return out;
  }

  let cursor = from;
  while (cursor <= to) {
    const monthStart = firstDayOfMonth(cursor);
    const monthEnd = lastDayOfMonth(cursor);
    const bFrom = cursor;
    const bTo = monthEnd < to ? monthEnd : to;
    out.push({
      key: cursor.slice(0, 7),
      from: bFrom,
      to: bTo,
      partial: bFrom !== monthStart || bTo !== monthEnd,
    });
    cursor = shiftYmd(bTo, 1);
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/mcp/buckets.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/mcp/buckets.ts lib/mcp/buckets.test.ts
git commit -m "feat(mcp): bucket a date range, marking clipped buckets partial"
```

---

### Task 5: Occupancy tools

**Files:**
- Create: `lib/mcp/tools-occupancy.ts`
- Create: `lib/mcp/tools-occupancy.test.ts`
- Modify: `lib/mcp/server.ts` (register)

**Interfaces:**
- Consumes: `resolveProperties`, `propertySummary`; `bucketRange`, `type Granularity`; `snapshotFreshness`; `getOccupancyRollup(from, to): Promise<OccupancyRollup[]>` from `lib/db.ts`; `McpToolDef`.
- Produces:
  - `function rollupToRows(rollups: OccupancyRollup[], buckets: Bucket[], codes: string[]): PropertyBucketRow[]`
  - `type PropertyBucketRow = { code: string; bucket: string; from: string; to: string; partial: boolean; occupiedNights: number; inventoryNights: number; occupancyPct: number | null; roomRevenue: number; adr: number | null; revpar: number | null; oooNights: number }`
  - `const OCCUPANCY_TOOLS: McpToolDef[]`

- [ ] **Step 1: Write the failing test**

Create `lib/mcp/tools-occupancy.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { rollupToRows } from "./tools-occupancy";
import { bucketRange } from "./buckets";
import type { OccupancyRollup } from "@/lib/db";

const rollup = (code: string, days: { day: string; occ: number; inv: number }[]): OccupancyRollup => ({
  code,
  occupied: days.reduce((n, d) => n + d.occ, 0),
  inventory: days.reduce((n, d) => n + d.inv, 0),
  transientNights: 0,
  leaseNights: 0,
  roomRev: 1000,
  ooo: 2,
  days: days.map((d) => ({ day: d.day, pOcc: d.occ / d.inv })),
});

describe("rollupToRows", () => {
  it("computes occupancy as a ratio of sums, not a mean of daily rates", () => {
    // 60/100 on day one, 20/50 on day two. Ratio of sums = 80/150 = 53.3%.
    // Mean of rates would be (60% + 40%) / 2 = 50% — the wrong answer.
    const r = rollup("LL", [
      { day: "2026-08-01", occ: 60, inv: 100 },
      { day: "2026-08-02", occ: 20, inv: 50 },
    ]);
    const rows = rollupToRows([r], bucketRange("2026-08-01", "2026-08-02", "weekly"), ["LL"]);
    expect(rows[0].occupancyPct).toBeCloseTo(80 / 150, 6);
    expect(rows[0].occupancyPct).not.toBeCloseTo(0.5, 3);
  });

  it("splits days across daily buckets", () => {
    const r = rollup("LL", [
      { day: "2026-08-01", occ: 60, inv: 100 },
      { day: "2026-08-02", occ: 20, inv: 50 },
    ]);
    const rows = rollupToRows([r], bucketRange("2026-08-01", "2026-08-02", "daily"), ["LL"]);
    expect(rows).toHaveLength(2);
    expect(rows[0].occupancyPct).toBeCloseTo(0.6, 6);
    expect(rows[1].occupancyPct).toBeCloseTo(0.4, 6);
  });

  it("carries the bucket's real dates and its partial flag", () => {
    const r = rollup("LL", [{ day: "2026-08-05", occ: 50, inv: 100 }]);
    const rows = rollupToRows([r], bucketRange("2026-08-05", "2026-08-09", "weekly"), ["LL"]);
    expect(rows[0]).toMatchObject({ from: "2026-08-05", to: "2026-08-09", partial: true });
  });

  // A day with no banked capture must not become a zero-occupancy day.
  it("returns null occupancy for a bucket with no data, never 0", () => {
    const r = rollup("LL", [{ day: "2026-08-01", occ: 60, inv: 100 }]);
    const rows = rollupToRows([r], bucketRange("2026-08-01", "2026-08-02", "daily"), ["LL"]);
    expect(rows[1].occupancyPct).toBeNull();
    expect(rows[1].inventoryNights).toBe(0);
  });

  it("emits a row per requested property even when one has no data at all", () => {
    const r = rollup("LL", [{ day: "2026-08-01", occ: 60, inv: 100 }]);
    const rows = rollupToRows([r], bucketRange("2026-08-01", "2026-08-01", "daily"), ["LL", "DP"]);
    expect(rows.map((x) => x.code).sort()).toEqual(["DP", "LL"]);
    expect(rows.find((x) => x.code === "DP")!.occupancyPct).toBeNull();
  });

  it("returns no guest-identifying field", () => {
    const r = rollup("LL", [{ day: "2026-08-01", occ: 60, inv: 100 }]);
    const rows = rollupToRows([r], bucketRange("2026-08-01", "2026-08-01", "daily"), ["LL"]);
    expect(Object.keys(rows[0]).join(" ")).not.toMatch(/name|guest|email|phone/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/mcp/tools-occupancy.test.ts`
Expected: FAIL — `Failed to resolve import "./tools-occupancy"`.

- [ ] **Step 3: Write the implementation**

Create `lib/mcp/tools-occupancy.ts`:

```ts
// Occupancy, rate and revenue tools.
//
// Reads the banked snapshot store through getOccupancyRollup — the same source
// /report and /rob use — so an answer in Claude Desktop and a figure on the
// dashboard are the same number, not two derivations that can drift. Data
// Insights is deliberately NOT consulted: it returns Cloudbeds' own derivation
// over a capacity figure we know to be wrong (CLAUDE.md §6).

import { z } from "zod";
import { getOccupancyRollup, type OccupancyRollup } from "@/lib/db";
import { easternToday, monthStart } from "@/lib/dates";
import { PROPERTIES } from "@/config/properties";
import { bucketRange, type Bucket, type Granularity } from "./buckets";
import { propertySummary, resolveProperties } from "./properties";
import { snapshotFreshness } from "./freshness";
import type { McpToolDef } from "./types";

export type PropertyBucketRow = {
  code: string;
  bucket: string;
  from: string;
  to: string;
  partial: boolean;
  occupiedNights: number;
  inventoryNights: number;
  /** Null when the bucket has no banked inventory — NEVER 0, which would read
   *  as an empty hotel rather than as a day we did not capture. */
  occupancyPct: number | null;
  roomRevenue: number;
  adr: number | null;
  revpar: number | null;
  oooNights: number;
};

/** Fold per-day rollups into buckets. Ratio of sums, once, at the end. */
export function rollupToRows(
  rollups: OccupancyRollup[],
  buckets: Bucket[],
  codes: string[],
): PropertyBucketRow[] {
  const byCode = new Map(rollups.map((r) => [r.code, r]));
  const rows: PropertyBucketRow[] = [];

  for (const code of codes) {
    const r = byCode.get(code);
    for (const b of buckets) {
      const days = (r?.days ?? []).filter((d) => d.day >= b.from && d.day <= b.to);
      // OccupancyRollup carries per-day percentages plus period totals. Rebuild
      // the per-day occupied/inventory pair from the whole-period ratio only
      // when a single bucket covers the whole period; otherwise sum the days we
      // have. Both paths end in one division.
      const share = r && r.days.length > 0 ? days.length / r.days.length : 0;
      const inventoryNights = r ? r.inventory * share : 0;
      const occupiedNights = days.reduce(
        (n, d) => n + d.pOcc * (r && r.days.length ? r.inventory / r.days.length : 0),
        0,
      );
      const roomRevenue = r ? r.roomRev * share : 0;
      const oooNights = r ? r.ooo * share : 0;
      rows.push({
        code,
        bucket: b.key,
        from: b.from,
        to: b.to,
        partial: b.partial,
        occupiedNights: round(occupiedNights),
        inventoryNights: round(inventoryNights),
        occupancyPct: inventoryNights > 0 ? occupiedNights / inventoryNights : null,
        roomRevenue: round(roomRevenue),
        adr: occupiedNights > 0 ? round(roomRevenue / occupiedNights) : null,
        revpar: inventoryNights > 0 ? round(roomRevenue / inventoryNights) : null,
        oooNights: round(oooNights),
      });
    }
  }
  return rows;
}

const round = (n: number) => Math.round(n * 100) / 100;

const propertiesArg = z
  .array(z.string())
  .optional()
  .describe("Property names, codes or IDs. Omit for every active property.");

export const OCCUPANCY_TOOLS: McpToolDef[] = [
  {
    name: "list_properties",
    title: "List Stayable properties",
    description:
      "The eight Stayable properties with their IDs, codes and counties. Call this first if you are unsure how a property is named.",
    inputSchema: z.object({}),
    handler: async () => ({
      data: { properties: PROPERTIES.map(propertySummary) },
      freshness: {
        source: "snapshot" as const,
        asOf: null,
        note: "The property list is configuration, not measured data; it changes only when a property is acquired or sold.",
      },
    }),
  },
  {
    name: "get_occupancy",
    title: "Occupancy, ADR and RevPAR",
    description:
      "Occupancy %, rooms sold, out-of-order nights, room revenue, ADR and RevPAR for a date range, per property. Weekly and monthly figures are a ratio of sums over the bucket.",
    inputSchema: z.object({
      from: z.string().describe("Start date, YYYY-MM-DD (inclusive)."),
      to: z.string().describe("End date, YYYY-MM-DD (inclusive)."),
      granularity: z.enum(["daily", "weekly", "monthly"]).default("daily"),
      properties: propertiesArg,
    }),
    handler: async (args: { from: string; to: string; granularity?: Granularity; properties?: string[] }) => {
      const props = resolveProperties(args.properties);
      const buckets = bucketRange(args.from, args.to, args.granularity ?? "daily");
      const rollups = await getOccupancyRollup(args.from, args.to);
      const rows = rollupToRows(rollups, buckets, props.map((p) => p.code));
      return {
        data: { range: { from: args.from, to: args.to }, granularity: args.granularity ?? "daily", rows },
        freshness: await snapshotFreshness(),
      };
    },
  },
  {
    name: "get_portfolio_summary",
    title: "Portfolio month-to-date and year-to-date",
    description:
      "One call for 'how are we doing': MTD and YTD occupancy, room revenue, ADR and RevPAR for every active property and the portfolio.",
    inputSchema: z.object({
      asOf: z.string().optional().describe("Date to measure to, YYYY-MM-DD. Defaults to today (Eastern)."),
    }),
    handler: async (args: { asOf?: string }) => {
      const asOf = args.asOf ?? easternToday();
      const codes = resolveProperties().map((p) => p.code);
      const [mtd, ytd] = await Promise.all([
        getOccupancyRollup(monthStart(asOf), asOf),
        getOccupancyRollup(`${asOf.slice(0, 4)}-01-01`, asOf),
      ]);
      return {
        data: {
          asOf,
          mtd: rollupToRows(mtd, [{ key: "mtd", from: monthStart(asOf), to: asOf, partial: true }], codes),
          ytd: rollupToRows(ytd, [{ key: "ytd", from: `${asOf.slice(0, 4)}-01-01`, to: asOf, partial: true }], codes),
        },
        freshness: await snapshotFreshness(),
      };
    },
  },
];
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/mcp/tools-occupancy.test.ts`
Expected: PASS.

**If the ratio-of-sums test fails**, the fold in `rollupToRows` is wrong. `OccupancyRollup.days` carries a per-day *percentage*, not raw counts, so reconstructing per-day occupied nights requires the period's average inventory. If that reconstruction proves lossy for a real range, change `lib/db.ts`'s `getOccupancyRollup` to also return per-day `occupied` and `inventory` — that is a better fix than approximating here, and it is a small additive change to the SELECT that already reads both columns. Report which route you took.

- [ ] **Step 5: Register the tools**

Modify `lib/mcp/server.ts`: import `OCCUPANCY_TOOLS` and make the manifest read:

```ts
import { OCCUPANCY_TOOLS } from "./tools-occupancy";

export const ALL_TOOLS: McpToolDef[] = [...OCCUPANCY_TOOLS];
```

- [ ] **Step 6: Run the full suite and typecheck**

Run: `npx tsc --noEmit && npm test`
Expected: exit 0, all green.

- [ ] **Step 7: Commit**

```bash
git add lib/mcp/tools-occupancy.ts lib/mcp/tools-occupancy.test.ts lib/mcp/server.ts
git commit -m "feat(mcp): occupancy, ADR and RevPAR tools over the snapshot store"
```

---

### Task 6: Report tools

**Files:**
- Create: `lib/mcp/tools-report.ts`
- Create: `lib/mcp/tools-report.test.ts`
- Modify: `lib/mcp/server.ts` (register)

**Interfaces:**
- Consumes: `buildRevenueReport(asOf?: string)` from `lib/cloudbeds.ts`; `renderReportPdf(report)` from `lib/report-pdf.ts`; `renderReportXlsx(report)` from `lib/report-xlsx.ts`; `easternToday`, `shiftYmd` from `lib/dates.ts`.
- Produces:
  - `function reportFilename(asOf: string, format: "pdf" | "xlsx"): string`
  - `const REPORT_TOOLS: McpToolDef[]`

- [ ] **Step 1: Write the failing test**

Create `lib/mcp/tools-report.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { reportFilename } from "./tools-report";

describe("reportFilename", () => {
  // Monica's convention, already used by the report export: the filename
  // carries the day AFTER the stay date, because the report is published the
  // next morning. Matching it means a file pulled through MCP and a file pulled
  // from the dashboard have the same name.
  it("names the file for the day after the stay date", () => {
    expect(reportFilename("2026-08-10", "pdf")).toBe("Occupancy Report as of August 11, 2026.pdf");
  });

  it("rolls over a month boundary", () => {
    expect(reportFilename("2026-08-31", "pdf")).toBe("Occupancy Report as of September 1, 2026.pdf");
  });

  it("uses the xlsx extension for the workbook", () => {
    expect(reportFilename("2026-08-10", "xlsx")).toBe("Occupancy Report as of August 11, 2026.xlsx");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/mcp/tools-report.test.ts`
Expected: FAIL — `Failed to resolve import "./tools-report"`.

- [ ] **Step 3: Write the implementation**

Create `lib/mcp/tools-report.ts`:

```ts
// The daily revenue report, as data or as the actual file.
//
// Both call buildRevenueReport, the same function /api/report-file and the
// Teams cron use, so what Rob reads in Claude Desktop is the report that was
// published — not a re-derivation of it.

import { z } from "zod";
import { buildRevenueReport } from "@/lib/cloudbeds";
import { renderReportPdf } from "@/lib/report-pdf";
import { renderReportXlsx } from "@/lib/report-xlsx";
import { easternToday, shiftYmd } from "@/lib/dates";
import { snapshotFreshness } from "./freshness";
import type { McpToolDef } from "./types";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Monica's naming convention: the file is named for the day AFTER the stay
 *  date, because the report is published the next morning. Keeping it identical
 *  means a file pulled here and one pulled from the dashboard are the same file
 *  by name as well as by content. */
export function reportFilename(asOf: string, format: "pdf" | "xlsx"): string {
  const published = shiftYmd(asOf, 1);
  const [y, m, d] = published.split("-");
  return `Occupancy Report as of ${MONTHS[Number(m) - 1]} ${Number(d)}, ${y}.${format}`;
}

export const REPORT_TOOLS: McpToolDef[] = [
  {
    name: "get_daily_report",
    title: "Daily revenue report (data)",
    description:
      "The daily revenue report as structured data — per-property occupancy, room revenue, ADR, out-of-order and on-the-books figures. Use this to answer questions; use get_report_file only when the actual PDF or Excel file is wanted.",
    inputSchema: z.object({
      asOf: z.string().optional().describe("Stay date, YYYY-MM-DD. Defaults to yesterday (Eastern), which is the most recent published report."),
    }),
    handler: async (args: { asOf?: string }) => {
      const asOf = args.asOf ?? shiftYmd(easternToday(), -1);
      const report = await buildRevenueReport(asOf);
      return { data: { asOf, report }, freshness: await snapshotFreshness() };
    },
  },
  {
    name: "get_report_file",
    title: "Daily revenue report (file)",
    description:
      "The daily revenue report as a PDF or Excel file, so its contents can be read directly.",
    inputSchema: z.object({
      asOf: z.string().optional().describe("Stay date, YYYY-MM-DD. Defaults to yesterday (Eastern)."),
      format: z.enum(["pdf", "xlsx"]).default("pdf"),
    }),
    handler: async (args: { asOf?: string; format?: "pdf" | "xlsx" }) => {
      const asOf = args.asOf ?? shiftYmd(easternToday(), -1);
      const format = args.format ?? "pdf";
      const report = await buildRevenueReport(asOf);
      const buffer = format === "xlsx" ? await renderReportXlsx(report) : renderReportPdf(report);
      return {
        data: {
          asOf,
          filename: reportFilename(asOf, format),
          mimeType:
            format === "xlsx"
              ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              : "application/pdf",
          base64: buffer.toString("base64"),
        },
        freshness: await snapshotFreshness(),
      };
    },
  },
];
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/mcp/tools-report.test.ts`
Expected: PASS.

Check `lib/report-pdf.ts` and the existing export path for the real filename convention before trusting the test's expected strings — `outputs/` in this repo contains files named `Occupancy Report as of August 1, 2026.pdf`, which is the format to match. If the real convention differs, fix the TEST to match the repo's actual files, and say so.

- [ ] **Step 5: Register the tools**

Modify `lib/mcp/server.ts`:

```ts
import { REPORT_TOOLS } from "./tools-report";

export const ALL_TOOLS: McpToolDef[] = [...OCCUPANCY_TOOLS, ...REPORT_TOOLS];
```

- [ ] **Step 6: Run the full suite and typecheck**

Run: `npx tsc --noEmit && npm test`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add lib/mcp/tools-report.ts lib/mcp/tools-report.test.ts lib/mcp/server.ts
git commit -m "feat(mcp): daily revenue report as data or as a file"
```

---

### Task 7: Live state tool

**Files:**
- Create: `lib/mcp/tools-live.ts`
- Create: `lib/mcp/tools-live.test.ts`
- Modify: `lib/mcp/server.ts` (register)

**Interfaces:**
- Consumes: `getPortfolio(): Promise<PropertyDashboard[]>` and `getPortfolioOoo(asOf): Promise<PropertyOoo[]>` from `lib/cloudbeds.ts`; `easternToday` from `lib/dates.ts`; `resolveProperties`.
- Produces:
  - `function liveRows(portfolio: any[], ooo: any[], codes: string[]): LiveRow[]`
  - `type LiveRow = { code: string; arrivals: number | null; departures: number | null; inHouse: number | null; roomsSold: number | null; oooRooms: number | null; unavailable: boolean; note?: string }`
  - `const LIVE_TOOLS: McpToolDef[]`

- [ ] **Step 1: Write the failing test**

Create `lib/mcp/tools-live.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { liveRows } from "./tools-live";

describe("liveRows", () => {
  it("pairs dashboard counts with out-of-order rooms per property", () => {
    const rows = liveRows(
      [{ code: "LL", arrivals: 3, departures: 5, inHouse: 90, roomsSold: 92 }],
      [{ code: "LL", ooo: 4 }],
      ["LL"],
    );
    expect(rows[0]).toMatchObject({ code: "LL", arrivals: 3, departures: 5, inHouse: 90, oooRooms: 4 });
    expect(rows[0].unavailable).toBe(false);
  });

  // The 429-zeros lesson: a property whose fetch failed must not report zero
  // arrivals, because zero is a perfectly plausible number.
  it("marks a property unavailable rather than reporting zeros", () => {
    const rows = liveRows([], [], ["LL"]);
    expect(rows[0].unavailable).toBe(true);
    expect(rows[0].arrivals).toBeNull();
    expect(rows[0].note).toMatch(/could not be read/i);
  });

  it("still reports counts when only the out-of-order read failed", () => {
    const rows = liveRows([{ code: "LL", arrivals: 3, departures: 5, inHouse: 90, roomsSold: 92 }], [], ["LL"]);
    expect(rows[0].arrivals).toBe(3);
    expect(rows[0].oooRooms).toBeNull();
  });

  it("returns no guest-identifying field", () => {
    const rows = liveRows([{ code: "LL", arrivals: 3, departures: 5, inHouse: 90, roomsSold: 92 }], [{ code: "LL", ooo: 4 }], ["LL"]);
    expect(Object.keys(rows[0]).join(" ")).not.toMatch(/name|guest|email|phone/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/mcp/tools-live.test.ts`
Expected: FAIL — `Failed to resolve import "./tools-live"`.

- [ ] **Step 3: Write the implementation**

Create `lib/mcp/tools-live.ts`:

```ts
// Today's state, read live from Cloudbeds.
//
// COUNTS ONLY. Arrivals and departures are numbers here, never a list of who
// is arriving — CLAUDE.md §5 rule 2, and the /bea guest-name exception does not
// extend to this surface (spec §6).
//
// A property whose fetch failed reports `unavailable`, never zeros. Zero
// arrivals is a completely plausible Tuesday, so a failed read that returns 0
// is indistinguishable from a real quiet day. That exact confusion cost this
// project a week of wrong out-of-order figures.

import { z } from "zod";
import { getPortfolio, getPortfolioOoo } from "@/lib/cloudbeds";
import { easternToday } from "@/lib/dates";
import { resolveProperties } from "./properties";
import { liveFreshness } from "./freshness";
import type { McpToolDef } from "./types";

export type LiveRow = {
  code: string;
  arrivals: number | null;
  departures: number | null;
  inHouse: number | null;
  roomsSold: number | null;
  oooRooms: number | null;
  unavailable: boolean;
  note?: string;
};

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function liveRows(portfolio: any[], ooo: any[], codes: string[]): LiveRow[] {
  const byCode = new Map(portfolio.map((p) => [p.code, p]));
  const oooByCode = new Map(ooo.map((o) => [o.code, o]));

  return codes.map((code) => {
    const p = byCode.get(code);
    const o = oooByCode.get(code);
    if (!p) {
      return {
        code,
        arrivals: null,
        departures: null,
        inHouse: null,
        roomsSold: null,
        oooRooms: o ? num(o.ooo) : null,
        unavailable: true,
        note: `Today's figures for ${code} could not be read from Cloudbeds.`,
      };
    }
    return {
      code,
      arrivals: num(p.arrivals),
      departures: num(p.departures),
      inHouse: num(p.inHouse),
      roomsSold: num(p.roomsSold),
      oooRooms: o ? num(o.ooo) : null,
      unavailable: false,
    };
  });
}

export const LIVE_TOOLS: McpToolDef[] = [
  {
    name: "get_today",
    title: "Today's live state",
    description:
      "Arrivals, departures, in-house, rooms sold and out-of-order rooms for today, read live from Cloudbeds. Counts only — no guest details are available through this tool.",
    inputSchema: z.object({
      properties: z
        .array(z.string())
        .optional()
        .describe("Property names, codes or IDs. Omit for every active property."),
    }),
    handler: async (args: { properties?: string[] }) => {
      const codes = resolveProperties(args.properties).map((p) => p.code);
      const asOf = easternToday();
      const [portfolio, ooo] = await Promise.all([
        getPortfolio().catch(() => []),
        getPortfolioOoo(asOf).catch(() => []),
      ]);
      return {
        data: { asOf, rows: liveRows(portfolio as any[], ooo as any[], codes) },
        freshness: liveFreshness(new Date().toISOString()),
      };
    },
  },
];
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/mcp/tools-live.test.ts`
Expected: PASS.

Read `lib/cloudbeds.ts` for the real field names on `PropertyDashboard` and `PropertyOoo` — the test fixtures above use `arrivals`, `departures`, `inHouse`, `roomsSold` and `ooo`. If the real names differ, fix `liveRows` AND the fixtures to the real ones, and drop the `any[]` in favour of the real exported types.

- [ ] **Step 5: Register the tools**

Modify `lib/mcp/server.ts`:

```ts
import { LIVE_TOOLS } from "./tools-live";

export const ALL_TOOLS: McpToolDef[] = [...OCCUPANCY_TOOLS, ...REPORT_TOOLS, ...LIVE_TOOLS];
```

- [ ] **Step 6: Run the full suite and typecheck**

Run: `npx tsc --noEmit && npm test`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add lib/mcp/tools-live.ts lib/mcp/tools-live.test.ts lib/mcp/server.ts
git commit -m "feat(mcp): today's live state, counts only, unavailable never zero"
```

---

### Task 8: Operations tools

**Files:**
- Create: `lib/mcp/tools-ops.ts`
- Create: `lib/mcp/tools-ops.test.ts`
- Modify: `lib/mcp/server.ts` (register)

**Interfaces:**
- Consumes: `getEvictions()`, `getOneStarReviews()` from `lib/smartsheet.ts`; `buildEvictionsViews`, `buildReviewsView`, `buildLeasingViews`; `getContractorSchedule`; `getEliseFunnel`, `getElisePipeline`, `getEliseSyncStatus`, `getSetting` from `lib/db.ts`; `easternToday`, `shiftYmd`.
- Produces: `const OPS_TOOLS: McpToolDef[]`, `function defaultReviewWindow(asOf: string, saved: string | null): { from: string; to: string }`

**Follow the existing call pattern at `app/ops/page.tsx:66-95`** — that block already fetches every one of these sources and threads them into the same builders. Read it before writing; do not invent a second way to call them.

- [ ] **Step 1: Write the failing test**

Create `lib/mcp/tools-ops.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { defaultReviewWindow } from "./tools-ops";

describe("defaultReviewWindow", () => {
  // /ops uses a lockable window stored in Neon so everyone sees the same set of
  // reviews. The MCP tool must honour it, or Rob and the dashboard disagree
  // about how many 1-star reviews there were.
  it("uses the saved window when one is stored", () => {
    const w = defaultReviewWindow("2026-08-11", JSON.stringify({ from: "2026-07-01", to: "2026-07-31" }));
    expect(w).toEqual({ from: "2026-07-01", to: "2026-07-31" });
  });

  it("falls back to the last 30 days when nothing is saved", () => {
    expect(defaultReviewWindow("2026-08-11", null)).toEqual({ from: "2026-07-13", to: "2026-08-11" });
  });

  it("falls back when the stored value is not valid JSON", () => {
    expect(defaultReviewWindow("2026-08-11", "{not json")).toEqual({ from: "2026-07-13", to: "2026-08-11" });
  });

  it("falls back when the stored JSON is missing a bound", () => {
    expect(defaultReviewWindow("2026-08-11", JSON.stringify({ from: "2026-07-01" }))).toEqual({
      from: "2026-07-13",
      to: "2026-08-11",
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/mcp/tools-ops.test.ts`
Expected: FAIL — `Failed to resolve import "./tools-ops"`.

- [ ] **Step 3: Write the implementation**

Create `lib/mcp/tools-ops.ts`:

```ts
// The non-Cloudbeds sections of Rob's dashboard: evictions, contractors,
// 1-star reviews and the EliseAI leasing funnel.
//
// Each calls the SAME builder the dashboard page calls (see app/ops/page.tsx
// and app/rob/page.tsx), so a figure quoted in chat matches the figure on the
// page. Where the dashboard applies a stored setting — the lockable reviews
// window — this honours it too, or the two surfaces would silently be counting
// different sets of reviews.

import { z } from "zod";
import { getEvictions, getOneStarReviews } from "@/lib/smartsheet";
import { buildEvictionsViews } from "@/lib/evictions";
import { buildReviewsView } from "@/lib/reviews";
import { buildLeasingViews } from "@/lib/leasing";
import { getContractorSchedule } from "@/lib/contractor-schedule";
import { getEliseFunnel, getElisePipeline, getEliseSyncStatus, getSetting } from "@/lib/db";
import { easternToday, shiftYmd } from "@/lib/dates";
import { describeElise, smartsheetFreshness } from "./freshness";
import type { McpToolDef } from "./types";

/** The 1-star review window: the locked one from Neon if set, else 30 days.
 *  Mirrors app/ops/page.tsx so both surfaces count the same reviews. */
export function defaultReviewWindow(asOf: string, saved: string | null): { from: string; to: string } {
  const fallback = { from: shiftYmd(asOf, -29), to: asOf };
  if (!saved) return fallback;
  try {
    const parsed = JSON.parse(saved) as { from?: string; to?: string };
    return parsed.from && parsed.to ? { from: parsed.from, to: parsed.to } : fallback;
  } catch {
    return fallback;
  }
}

export const OPS_TOOLS: McpToolDef[] = [
  {
    name: "get_evictions",
    title: "Eviction pipeline",
    description: "Open, closed and total eviction cases per property, with average days to file, from Smartsheet.",
    inputSchema: z.object({}),
    handler: async () => {
      const payload = await getEvictions();
      return {
        data: { evictions: buildEvictionsViews(payload) },
        freshness: smartsheetFreshness(new Date().toISOString()),
      };
    },
  },
  {
    name: "get_contractor_schedule",
    title: "This week's contractor schedule",
    description:
      "The contractor schedule for the current week. The source sheet holds only the current week — there is no history and no forward view.",
    inputSchema: z.object({}),
    handler: async () => ({
      data: { schedule: await getContractorSchedule(easternToday()) },
      freshness: smartsheetFreshness(new Date().toISOString()),
    }),
  },
  {
    name: "get_reviews",
    title: "One-star reviews",
    description:
      "One-star review counts and response rate per property. Defaults to the same locked date window the Operations dashboard uses.",
    inputSchema: z.object({
      from: z.string().optional().describe("Start date, YYYY-MM-DD."),
      to: z.string().optional().describe("End date, YYYY-MM-DD."),
    }),
    handler: async (args: { from?: string; to?: string }) => {
      const asOf = easternToday();
      const [payload, saved] = await Promise.all([getOneStarReviews(), getSetting("ops_reviews_window")]);
      const win =
        args.from && args.to ? { from: args.from, to: args.to } : defaultReviewWindow(asOf, saved);
      return {
        data: { window: win, reviews: buildReviewsView(payload.rows, win.from, win.to) },
        freshness: smartsheetFreshness(new Date().toISOString()),
      };
    },
  },
  {
    name: "get_leasing_funnel",
    title: "EliseAI leasing funnel",
    description:
      "Leasing funnel stages and the current prospect pipeline from EliseAI. Check the freshness note — this feed has failed before, and stale figures look identical to current ones.",
    inputSchema: z.object({
      from: z.string().optional().describe("Start date, YYYY-MM-DD. Defaults to the last 30 days."),
      to: z.string().optional().describe("End date, YYYY-MM-DD."),
    }),
    handler: async (args: { from?: string; to?: string }) => {
      const asOf = easternToday();
      const from = args.from ?? shiftYmd(asOf, -29);
      const to = args.to ?? asOf;
      const [funnel, pipeline, status] = await Promise.all([
        getEliseFunnel(from, to),
        getElisePipeline(),
        getEliseSyncStatus(),
      ]);
      return {
        data: { range: { from, to }, leasing: buildLeasingViews(funnel, pipeline) },
        freshness: describeElise(status, new Date().toISOString()),
      };
    },
  },
];
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/mcp/tools-ops.test.ts`
Expected: PASS.

`buildEvictionsViews`, `buildReviewsView`, `getContractorSchedule` and `buildLeasingViews` all have real signatures in their modules — read each one and match it exactly. `app/ops/page.tsx:66-95` and `app/rob/page.tsx` show every call in context. If a builder needs an argument this code does not pass, pass it the way the page does rather than inventing a default.

**Check `buildEvictionsViews` and `buildReviewsView` output for guest names before returning them.** These come from Smartsheet rows that may carry tenant identifiers. If either view contains a name field, strip it here and note it — the no-PII rule binds this surface regardless of what the dashboard shows behind its PIN.

- [ ] **Step 5: Register the tools**

Modify `lib/mcp/server.ts`:

```ts
import { OPS_TOOLS } from "./tools-ops";

export const ALL_TOOLS: McpToolDef[] = [
  ...OCCUPANCY_TOOLS, ...REPORT_TOOLS, ...LIVE_TOOLS, ...OPS_TOOLS,
];
```

- [ ] **Step 6: Run the full suite and typecheck**

Run: `npx tsc --noEmit && npm test`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add lib/mcp/tools-ops.ts lib/mcp/tools-ops.test.ts lib/mcp/server.ts
git commit -m "feat(mcp): evictions, contractors, reviews and the leasing funnel"
```

---

### Task 9: The manifest guarantees

**Files:**
- Create: `lib/mcp/server.test.ts`

**Interfaces:**
- Consumes: `ALL_TOOLS` from `lib/mcp/server.ts`.
- Produces: nothing consumed by later tasks.

This task is the reason tools are declared as data. These two tests are what stop a future tool from quietly shipping without freshness or with a guest name in it.

- [ ] **Step 1: Write the failing test**

Create `lib/mcp/server.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ALL_TOOLS } from "./server";

const EXPECTED = [
  "list_properties",
  "get_occupancy",
  "get_portfolio_summary",
  "get_daily_report",
  "get_report_file",
  "get_today",
  "get_evictions",
  "get_contractor_schedule",
  "get_reviews",
  "get_leasing_funnel",
];

describe("the tool manifest", () => {
  it("exposes exactly the tools the spec lists", () => {
    expect(ALL_TOOLS.map((t) => t.name).sort()).toEqual([...EXPECTED].sort());
  });

  it("has no duplicate tool names", () => {
    expect(new Set(ALL_TOOLS.map((t) => t.name)).size).toBe(ALL_TOOLS.length);
  });

  it("gives every tool a title, a description and a schema", () => {
    for (const t of ALL_TOOLS) {
      expect(t.title, t.name).toBeTruthy();
      expect(t.description.length, t.name).toBeGreaterThan(20);
      expect(t.inputSchema, t.name).toBeTruthy();
    }
  });

  // Every tool name is snake_case: mixed conventions make the model guess.
  it("names every tool in snake_case", () => {
    for (const t of ALL_TOOLS) expect(t.name, t.name).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  // The two cross-cutting rules. These iterate the manifest deliberately, so a
  // tool added later cannot skip them.
  it("declares no guest-identifying argument", () => {
    for (const t of ALL_TOOLS) {
      expect(JSON.stringify(t.inputSchema.description ?? ""), t.name).not.toMatch(/guest|surname/i);
      expect(t.name, t.name).not.toMatch(/guest|balance_due|who_owes/i);
    }
  });

  it("describes a freshness expectation in the payload type of every handler", () => {
    // Structural check: every handler is an async function of arity <= 1.
    for (const t of ALL_TOOLS) {
      expect(typeof t.handler, t.name).toBe("function");
      expect(t.handler.length, t.name).toBeLessThanOrEqual(1);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/mcp/server.test.ts`
Expected: FAIL if any tool is missing from the manifest or misnamed. If it passes immediately, that is acceptable here — this task's tests are guards over work already done, not a driver for new code.

- [ ] **Step 3: Add the runtime freshness and PII guard**

The structural test above cannot prove a handler *returns* freshness without calling it, and calling every handler needs live data sources. Add the guarantee at the point where it can be enforced without I/O — in `buildMcpServer`. Modify `lib/mcp/server.ts`'s handler wrapper so that immediately after `const payload = await tool.handler(args);` it validates the payload:

```ts
        if (!payload || typeof payload !== "object" || !("freshness" in payload) || !payload.freshness?.note) {
          // A tool that answers without stating how current its data is will be
          // quoted as current. Refuse rather than mislead — spec §7.
          throw new Error(`${tool.name} returned no freshness envelope`);
        }
```

And add a test to `lib/mcp/server.test.ts` proving the guard fires:

```ts
import { buildMcpServer } from "./server";

describe("the freshness guard", () => {
  it("turns a tool that omits freshness into an error rather than an answer", async () => {
    const registered: Record<string, (a: unknown) => Promise<any>> = {};
    const fakeServer = {
      registerTool: (name: string, _cfg: unknown, handler: (a: unknown) => Promise<any>) => {
        registered[name] = handler;
      },
    };
    const { ALL_TOOLS: manifest } = await import("./server");
    const original = manifest.length;
    manifest.push({
      name: "test_no_freshness",
      title: "t",
      description: "a tool that forgets its freshness envelope entirely",
      inputSchema: (await import("zod")).z.object({}),
      handler: async () => ({ data: { x: 1 } }) as any,
    });
    buildMcpServer(fakeServer as any);
    const res = await registered["test_no_freshness"]({});
    manifest.length = original; // leave the manifest as we found it
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/could not complete/i);
  });
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/mcp/server.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full suite, typecheck and build**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: exit 0; `/api/mcp/[secret]` appears in the route output.

- [ ] **Step 6: Commit**

```bash
git add lib/mcp/server.ts lib/mcp/server.test.ts
git commit -m "feat(mcp): refuse to answer without a freshness envelope"
```

---

### Task 10: Ship and deliver

**Files:** none — deployment and verification.

- [ ] **Step 1: Generate the production secret**

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Set it as `MCP_SECRET` in Vercel (Production). **Do not print the value into a report file or a commit message.** There is no Vercel CLI in this environment, so if it cannot be set programmatically, hand the value to Kyle with instructions and stop there rather than guessing at a substitute.

- [ ] **Step 2: Push and deploy**

```bash
git push -u origin claude/nifty-thompson-ts8zny
```

Deploy to production. Do not open a pull request.

- [ ] **Step 3: Verify on the deployment**

Run each and record the actual result:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://dashboard.rentstayable.com/api/mcp/wrongsecret
curl -s -X POST https://dashboard.rentstayable.com/api/mcp/<SECRET> \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
curl -s -X POST https://dashboard.rentstayable.com/api/mcp/<SECRET> \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
```

Expected: `404`; an initialize result naming `stayable-dashboard`; and all ten tools listed.

**If the wrong-secret call returns anything other than 404** — particularly a Vercel bot-check or SSO page — Deployment Protection is in front of the path. That must be resolved before Rob can connect, because Claude Desktop will see the same wall.

- [ ] **Step 4: Prove the numbers match the dashboard**

Call `get_occupancy` for one property over a week that `/report` also covers, and compare the occupancy percentage to the dashboard's figure for the same property and range.

They must match. **If they do not, that is a release blocker, not a rounding note** — the entire argument for putting the MCP server inside the app (spec §2) is that there is exactly one derivation. A mismatch means there are now two.

- [ ] **Step 5: Deliver to Kyle**

Put the URL on the clipboard and save a backup file:

```bash
node -e "process.stdout.write('https://dashboard.rentstayable.com/api/mcp/' + process.env.MCP_SECRET)" > outputs/mcp-connector-url.txt
powershell -c "Set-Clipboard -Value (Get-Content -Raw outputs/mcp-connector-url.txt)"
```

Then tell Kyle in chat:
- **Name:** `Stayable Dashboard`
- **Remote MCP server URL:** on his clipboard, backup at `outputs/mcp-connector-url.txt`
- Leave OAuth Client ID and Client Secret **empty**
- The URL is a password — send it to Rob as a credential, not in a group chat
- If `MCP_SECRET` is ever rotated, Rob's connector breaks silently and he needs the new URL

Add `outputs/mcp-connector-url.txt` to `.gitignore` if `outputs/` is not already ignored — **the secret must never be committed.** Check before writing the file.

- [ ] **Step 6: Update TODO.md**

Record: what shipped, the deployment id, the test count, every live check result from Step 3, the dashboard-parity result from Step 4, and anything that differed from this plan — particularly the `mcp-handler` API, since it was read from the published package at plan time and may have moved.

- [ ] **Step 7: Commit**

```bash
git add TODO.md .gitignore
git commit -m "docs: record the MCP server release"
git push
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| §1 remote connector, read-only | 1, 10 |
| §2 inside the app, one derivation | 5–8; proven in 10 step 4 |
| §3 secret URL, 404 not 401, fail closed, middleware, rate limit | 1 |
| §4 `mcp-handler` stateless, three deps, no basePath | 1 |
| §5 the ten tools, property resolution, granularity | 2, 4, 5, 6, 7, 8 |
| §6 no guest PII | 5, 7, 8, 9 |
| §7 freshness on every answer | 3, 9 |
| §8 error wording, no leaks | 1 (wrapper), 7 |
| §9 testing | every task |
| §10 out of scope | nothing built for it |
| §11 modules | file structure table |
| §12 ship criteria | 10 |
| §13 delivery to Kyle | 10 step 5 |

**Two known-weak points, flagged rather than hidden:**

1. **`rollupToRows` reconstructs per-day counts from `OccupancyRollup`, which carries per-day *percentages* and period *totals*.** That reconstruction is exact only when inventory is constant across the period. Task 5 Step 4 names the better fix — return per-day `occupied`/`inventory` from `getOccupancyRollup`, which already selects both columns — and asks the implementer to report which route they took. This is the most likely place for the dashboard-parity check in Task 10 to fail.

2. **Field names on `PropertyDashboard` and `PropertyOoo` in Task 7 are assumed**, not verified against `lib/cloudbeds.ts`. The task says so and instructs the implementer to read the real types and fix both code and fixtures. The `any[]` in `liveRows` exists only to keep the plan honest about that gap; it should not survive the task.

**Type consistency:** `Freshness`, `McpPayload`, `McpToolDef`, `McpArgError` are defined once in Task 1 and used unchanged in Tasks 3, 5, 6, 7, 8, 9. `Bucket`/`Granularity` are defined in Task 4 and consumed in Task 5. `resolveProperties`/`propertySummary` are defined in Task 2 and consumed in Tasks 5 and 7. `ALL_TOOLS` grows by concatenation in Tasks 5–8 and is asserted whole in Task 9.
