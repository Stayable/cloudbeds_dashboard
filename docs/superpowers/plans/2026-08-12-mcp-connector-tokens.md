# MCP Connector Tokens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single shared `MCP_SECRET` with per-person, revocable connector URLs issued by Kyle from a new PIN-gated `/connectors` page.

**Architecture:** A new Neon table `mcp_tokens` stores a SHA-256 hash per issued URL alongside the email it was given to. `resolveMcpToken` looks a candidate up by hash on every MCP request, replacing the env-var comparison, and the rate limiter keys on the resolved row id instead of one global bucket. A new `admin` level (PIN `ILLUSTRIOUS`) gates `/connectors`, where Kyle mints, tracks and revokes. The existing shared secret is seeded as an ordinary row so Rob's and Kate's connectors keep working and retire with a click.

**Tech Stack:** Next.js App Router (server components + route handlers), TypeScript, Neon serverless Postgres (`@neondatabase/serverless`), vitest, `node:crypto`, Tailwind with the repo's design tokens.

**Spec:** `docs/superpowers/specs/2026-08-12-mcp-connector-tokens-design.md`

## Global Constraints

Every task's requirements implicitly include all of these.

- **The connector URL is built from a hardcoded `https://dashboard.rentstayable.com`.** Never from the request host, `req.url`, `headers().host`, or an env var. Vercel Auth is `all_except_custom_domains`, so a `*.vercel.app` URL returns an SSO page that looks exactly like a broken connector (sessions 9n, 9o).
- **Never log a raw token.** Not in `console.log`, not in an error message, not in a thrown `Error`. Only the hash is ever persisted or printed.
- **Fail closed.** A dead database, a missing env var, or an unparseable input makes MCP requests fail, never succeed. Matches the rule `lib/pins.ts` already documents for login.
- **404, never 401**, for a bad MCP token. A 401 confirms something exists at that path. Preserve the existing behaviour and its comment.
- **Neon returns `timestamptz` as a JS `Date`.** `String(date)` yields `"Sun Aug 09 2026 00:50:00 GMT+0800"` and leaks the server's zone — this exact bug shipped once (session 9j). Normalise every timestamp to an ISO string at the DB boundary.
- **No middleware matcher change.** `/connectors` and `/api/connectors` must stay gated. The MCP exclusion is `api/mcp/.*`, which requires the slash and so does not match `api/connectors`.
- **No guest PII anywhere in this work.** `mcp_tokens.email` holds employee addresses only.
- **Run `npx tsc --noEmit` before every commit.** The repo expects exit 0.

---

### Task 1: `mcp_tokens` table and the token module

**Files:**
- Create: `lib/mcp/tokens.ts`
- Create: `lib/mcp/tokens.test.ts`
- Modify: `scripts/db-init.mjs` (append a new `create table` block after the `dashboard_pins` block, ~line 49)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `CONNECTOR_BASE_URL: string`
  - `TOUCH_WINDOW_MS: number`
  - `MAX_LIVE_TOKENS: number`
  - `type McpTokenRow = { id: number; email: string | null; label: string | null; createdAt: string; lastUsedAt: string | null; revokedAt: string | null }`
  - `generateToken(): string`
  - `hashToken(token: string): string`
  - `connectorUrl(token: string): string`
  - `shouldTouch(lastUsedAt: string | null, nowMs: number): boolean`
  - `findLiveTokenByHash(hash: string): Promise<McpTokenRow | null>`
  - `insertToken(input: { email: string; label: string | null; tokenHash: string }): Promise<void>`
  - `listTokens(): Promise<McpTokenRow[]>`
  - `revokeToken(id: number): Promise<void>`
  - `touchToken(id: number): Promise<void>`
  - `countLiveTokens(): Promise<number>`

- [ ] **Step 1: Write the failing test**

Create `lib/mcp/tokens.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  generateToken,
  hashToken,
  connectorUrl,
  shouldTouch,
  CONNECTOR_BASE_URL,
  TOUCH_WINDOW_MS,
} from "./tokens";

describe("generateToken", () => {
  it("is 64 hex characters (32 random bytes)", () => {
    expect(generateToken()).toMatch(/^[0-9a-f]{64}$/);
  });

  it("does not repeat", () => {
    const seen = new Set(Array.from({ length: 50 }, () => generateToken()));
    expect(seen.size).toBe(50);
  });
});

describe("hashToken", () => {
  it("is deterministic", () => {
    expect(hashToken("abc")).toBe(hashToken("abc"));
  });

  it("differs for different tokens", () => {
    expect(hashToken("abc")).not.toBe(hashToken("abd"));
  });

  it("returns 64 hex characters and never the input", () => {
    const h = hashToken("a".repeat(64));
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toBe("a".repeat(64));
  });
});

describe("connectorUrl", () => {
  // THE REGRESSION TEST FOR SESSIONS 9n/9o. A host-derived URL would hand out a
  // *.vercel.app address that returns Vercel's SSO page, which in Claude Desktop
  // is indistinguishable from a broken connector.
  it("always uses the custom domain", () => {
    expect(connectorUrl("deadbeef")).toBe(
      "https://dashboard.rentstayable.com/api/mcp/deadbeef",
    );
  });

  it("takes no host input at all, so no caller can influence the origin", () => {
    expect(connectorUrl.length).toBe(1);
    expect(CONNECTOR_BASE_URL).toBe("https://dashboard.rentstayable.com");
    expect(CONNECTOR_BASE_URL).not.toContain("vercel.app");
  });
});

describe("shouldTouch", () => {
  const now = Date.parse("2026-08-12T12:00:00.000Z");

  it("writes when the token has never been used", () => {
    expect(shouldTouch(null, now)).toBe(true);
  });

  it("does not write again inside the window", () => {
    const oneMinuteAgo = new Date(now - 60_000).toISOString();
    expect(shouldTouch(oneMinuteAgo, now)).toBe(false);
  });

  it("writes once the window has passed", () => {
    const stale = new Date(now - TOUCH_WINDOW_MS - 1).toISOString();
    expect(shouldTouch(stale, now)).toBe(true);
  });

  // Err toward writing: a bad stored value must not freeze last_used_at forever,
  // because "never used" is the signal that a token was issued and not installed.
  it("writes when the stored timestamp is unparseable", () => {
    expect(shouldTouch("not-a-date", now)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/mcp/tokens.test.ts`
Expected: FAIL — `Failed to resolve import "./tokens"`.

- [ ] **Step 3: Write the implementation**

Create `lib/mcp/tokens.ts`:

```ts
// Storage and helpers for MCP connector tokens (spec 2026-08-12).
//
// Replaces the single MCP_SECRET env var. One row per issued URL, recorded
// against the email it was given to, revocable individually.
//
// Server-only (Node runtime): reaches for node:crypto and Neon. Never imported
// by middleware — the MCP route runs in the Node runtime, unlike lib/auth.ts
// which is edge-safe because middleware imports it.
//
// Queries live here rather than in lib/db.ts on purpose: lib/db.ts is already
// ~1,100 lines, and keeping these beside the rest of lib/mcp/ gives one module
// one responsibility.
import { randomBytes, createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";

/** HARDCODED, never derived from the request host. Vercel Auth on this project
 *  is `all_except_custom_domains`: only this domain is exempt, so a
 *  host-derived *.vercel.app URL returns an SSO login page — which in Claude
 *  Desktop looks exactly like a broken connector (sessions 9n, 9o). */
export const CONNECTOR_BASE_URL = "https://dashboard.rentstayable.com";

/** How stale last_used_at may get before we write it again. Bounds writes to
 *  one per window per token instead of one per tool call. The cost is that
 *  "last used" is accurate to within five minutes, far finer than any decision
 *  made from it. */
export const TOUCH_WINDOW_MS = 5 * 60_000;

/** Not a security control — a guard against the page filling with dead rows. */
export const MAX_LIVE_TOKENS = 20;

export type McpTokenRow = {
  id: number;
  email: string | null;
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

/** A fresh connector token: 32 random bytes as 64 hex characters. */
export function generateToken(): string {
  return randomBytes(32).toString("hex");
}

/** What we store. The token itself is NEVER persisted, so a lost URL is
 *  re-minted rather than recovered. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** The full URL handed to a person. Takes only the token — there is
 *  deliberately no host parameter for a caller to get wrong. */
export function connectorUrl(token: string): string {
  return `${CONNECTOR_BASE_URL}/api/mcp/${token}`;
}

/** Should we write last_used_at? True when never used, when the stored value
 *  is unparseable, or when the window has passed. */
export function shouldTouch(lastUsedAt: string | null, nowMs: number): boolean {
  if (!lastUsedAt) return true;
  const t = Date.parse(lastUsedAt);
  if (!Number.isFinite(t)) return true;
  return nowMs - t >= TOUCH_WINDOW_MS;
}

function db() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return neon(url);
}

/** Neon hands back `timestamptz` as a JS Date. Stringifying one leaks the
 *  server's zone ("Sun Aug 09 2026 00:50:00 GMT+0800") — that exact bug shipped
 *  once in session 9j. Normalise at the boundary so nothing downstream sees a
 *  Date or a zone-stamped string. */
function iso(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function mapRow(r: Record<string, unknown>): McpTokenRow {
  return {
    id: Number(r.id),
    email: r.email == null ? null : String(r.email),
    label: r.label == null ? null : String(r.label),
    createdAt: iso(r.created_at) ?? new Date(0).toISOString(),
    lastUsedAt: iso(r.last_used_at),
    revokedAt: iso(r.revoked_at),
  };
}

/** The LIVE token matching this hash, or null. Revoked rows are excluded here,
 *  in SQL — that is the mechanism by which a revoked URL stops working. */
export async function findLiveTokenByHash(hash: string): Promise<McpTokenRow | null> {
  const rows = (await db()`
    select id, email, label, created_at, last_used_at, revoked_at
    from mcp_tokens
    where token_hash = ${hash} and revoked_at is null
    limit 1
  `) as Record<string, unknown>[];
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function insertToken(input: {
  email: string;
  label: string | null;
  tokenHash: string;
}): Promise<void> {
  await db()`
    insert into mcp_tokens (email, label, token_hash)
    values (${input.email}, ${input.label}, ${input.tokenHash})
  `;
}

/** Every token, newest first, INCLUDING revoked ones — the page shows them
 *  struck through so history stays visible. */
export async function listTokens(): Promise<McpTokenRow[]> {
  const rows = (await db()`
    select id, email, label, created_at, last_used_at, revoked_at
    from mcp_tokens
    order by created_at desc, id desc
  `) as Record<string, unknown>[];
  return rows.map(mapRow);
}

/** Idempotent: revoking an already-revoked row leaves its original timestamp. */
export async function revokeToken(id: number): Promise<void> {
  await db()`
    update mcp_tokens set revoked_at = now()
    where id = ${id} and revoked_at is null
  `;
}

export async function touchToken(id: number): Promise<void> {
  await db()`update mcp_tokens set last_used_at = now() where id = ${id}`;
}

export async function countLiveTokens(): Promise<number> {
  const rows = (await db()`
    select count(*)::int as n from mcp_tokens where revoked_at is null
  `) as { n: number }[];
  return rows[0]?.n ?? 0;
}
```

Note: every query spells its column list out rather than sharing a constant —
the Neon tagged-template client cannot interpolate an identifier list, so a
shared constant would not work here.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/mcp/tokens.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Add the DDL**

In `scripts/db-init.mjs`, after the `dashboard_pins` block and its
`console.log("dashboard_pins table ready.");` line, append:

```js
// mcp_tokens: one row per issued MCP connector URL (spec 2026-08-12).
// Only the SHA-256 hash is stored — a lost URL is re-minted, never recovered.
// Revoked rows are KEPT so "who had access in August" stays answerable.
await sql`
  create table if not exists mcp_tokens (
    id            bigserial   primary key,
    email         text,
    label         text,
    token_hash    text        not null unique,
    created_at    timestamptz not null default now(),
    last_used_at  timestamptz,
    revoked_at    timestamptz
  )
`;
await sql`create index if not exists mcp_tokens_hash_idx on mcp_tokens (token_hash)`;
console.log("mcp_tokens table ready.");
```

- [ ] **Step 6: Run the migration**

Run: `node scripts/db-init.mjs`
Expected: output ends with `mcp_tokens table ready.` and no error.

Note: this writes to the **production** Neon instance — local, preview and
production share one `DATABASE_URL` (established in session 9p). The DDL is
idempotent and additive, so this is safe, but be aware it is not a sandbox.

- [ ] **Step 7: Typecheck and commit**

```bash
npx tsc --noEmit
git add lib/mcp/tokens.ts lib/mcp/tokens.test.ts scripts/db-init.mjs
git commit -m "feat(mcp): mcp_tokens table and token helpers

Hash-only storage, a hardcoded connector base URL so no caller can
produce a *.vercel.app connector, and a last_used_at write throttle."
```

---

### Task 2: `resolveMcpToken` replaces `mcpSecretOk`

**Files:**
- Modify: `lib/mcp/auth.ts` (replace the whole file)
- Modify: `lib/mcp/auth.test.ts` (replace the whole file)

**Interfaces:**
- Consumes: `hashToken`, `shouldTouch`, `findLiveTokenByHash`, `touchToken` from `lib/mcp/tokens.ts` (Task 1).
- Produces:
  - `type McpCaller = { id: number; email: string | null; label: string | null }`
  - `resolveMcpToken(candidate: string | undefined): Promise<McpCaller | null>`
  - `MIN_TOKEN_LENGTH: number`
  - `mcpSecretOk` is **deleted**.

- [ ] **Step 1: Write the failing test**

Replace `lib/mcp/auth.test.ts` entirely:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const findLiveTokenByHash = vi.fn();
const touchToken = vi.fn();

// Mock only the DB functions; keep hashToken/shouldTouch real so the test
// exercises the actual hashing and throttle decision.
vi.mock("./tokens", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./tokens")>();
  return {
    ...actual,
    findLiveTokenByHash: (...a: unknown[]) => findLiveTokenByHash(...a),
    touchToken: (...a: unknown[]) => touchToken(...a),
  };
});

import { resolveMcpToken, MIN_TOKEN_LENGTH } from "./auth";
import { hashToken, TOUCH_WINDOW_MS } from "./tokens";

const TOKEN = "a".repeat(64);

function row(over: Partial<{ lastUsedAt: string | null }> = {}) {
  return {
    id: 7,
    email: "rb@rise8companies.com",
    label: "Claude Desktop",
    createdAt: "2026-08-12T00:00:00.000Z",
    lastUsedAt: null,
    revokedAt: null,
    ...over,
  };
}

beforeEach(() => {
  findLiveTokenByHash.mockReset();
  touchToken.mockReset();
});

describe("resolveMcpToken", () => {
  it("returns the caller for a live token", async () => {
    findLiveTokenByHash.mockResolvedValue(row());
    await expect(resolveMcpToken(TOKEN)).resolves.toEqual({
      id: 7,
      email: "rb@rise8companies.com",
      label: "Claude Desktop",
    });
  });

  it("looks the token up by its hash, never by the token itself", async () => {
    findLiveTokenByHash.mockResolvedValue(row());
    await resolveMcpToken(TOKEN);
    expect(findLiveTokenByHash).toHaveBeenCalledWith(hashToken(TOKEN));
    expect(findLiveTokenByHash).not.toHaveBeenCalledWith(TOKEN);
  });

  // findLiveTokenByHash excludes revoked rows in SQL, so "revoked" and
  // "unknown" both arrive here as null. This pins the caller-visible result.
  it("returns null when the token is unknown or revoked", async () => {
    findLiveTokenByHash.mockResolvedValue(null);
    await expect(resolveMcpToken(TOKEN)).resolves.toBeNull();
  });

  it("returns null for undefined", async () => {
    await expect(resolveMcpToken(undefined)).resolves.toBeNull();
    expect(findLiveTokenByHash).not.toHaveBeenCalled();
  });

  it("rejects a too-short candidate without querying the database", async () => {
    await expect(resolveMcpToken("x".repeat(MIN_TOKEN_LENGTH - 1))).resolves.toBeNull();
    expect(findLiveTokenByHash).not.toHaveBeenCalled();
  });

  // Fail closed: a dead database must make every request dead, never every
  // request valid. Same rule lib/pins.ts documents for login.
  it("returns null when the database throws", async () => {
    findLiveTokenByHash.mockRejectedValue(new Error("DATABASE_URL is not set"));
    await expect(resolveMcpToken(TOKEN)).resolves.toBeNull();
  });

  it("records last_used_at on a token that has never been used", async () => {
    findLiveTokenByHash.mockResolvedValue(row({ lastUsedAt: null }));
    await resolveMcpToken(TOKEN);
    expect(touchToken).toHaveBeenCalledWith(7);
  });

  it("does not write last_used_at again inside the throttle window", async () => {
    findLiveTokenByHash.mockResolvedValue(
      row({ lastUsedAt: new Date(Date.now() - 1_000).toISOString() }),
    );
    await resolveMcpToken(TOKEN);
    expect(touchToken).not.toHaveBeenCalled();
  });

  it("writes last_used_at once the window has passed", async () => {
    findLiveTokenByHash.mockResolvedValue(
      row({ lastUsedAt: new Date(Date.now() - TOUCH_WINDOW_MS - 1_000).toISOString() }),
    );
    await resolveMcpToken(TOKEN);
    expect(touchToken).toHaveBeenCalledWith(7);
  });

  // Bookkeeping must never break a legitimate call.
  it("still resolves when recording last_used_at fails", async () => {
    findLiveTokenByHash.mockResolvedValue(row());
    touchToken.mockRejectedValue(new Error("write failed"));
    await expect(resolveMcpToken(TOKEN)).resolves.toMatchObject({ id: 7 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/mcp/auth.test.ts`
Expected: FAIL — `resolveMcpToken` is not exported from `./auth`.

- [ ] **Step 3: Write the implementation**

Replace `lib/mcp/auth.ts` entirely:

```ts
// The MCP endpoint's only gate: a token in the URL path, looked up by hash.
//
// Kyle chose a secret-in-the-URL over OAuth on 08/11/26 and confirmed it on
// 08/12/26 after verifying that Claude Desktop's Add-custom-connector dialog
// offers no field for an arbitrary header (spec §3). The URL IS the credential.
//
// Replaced the single MCP_SECRET env var on 08/12/26. Two things got simpler:
// there is no length-leaking timing concern any more, because the value handed
// to Postgres is already a SHA-256 digest and leaks nothing about its preimage;
// and there is ONE code path, because the old shared secret was migrated into
// the table as an ordinary row rather than kept as a fallback branch.
//
// Node runtime only — never imported by middleware, unlike lib/auth.ts.
import {
  hashToken,
  shouldTouch,
  findLiveTokenByHash,
  touchToken,
} from "./tokens";

/** Shortest value that could be one of our tokens (we mint 64 hex chars).
 *  Anything shorter is a typo or a probe, so reject it without a query. */
export const MIN_TOKEN_LENGTH = 32;

export type McpCaller = {
  id: number;
  email: string | null;
  label: string | null;
};

/** The caller behind this token, or null if the token is unknown, revoked,
 *  malformed, or the database is unreachable. Never throws — every failure
 *  path is a null, which the route turns into a 404. */
export async function resolveMcpToken(
  candidate: string | undefined,
): Promise<McpCaller | null> {
  if (!candidate || candidate.length < MIN_TOKEN_LENGTH) return null;
  try {
    const row = await findLiveTokenByHash(hashToken(candidate));
    if (!row) return null;
    if (shouldTouch(row.lastUsedAt, Date.now())) {
      // Its own try/catch: a failed bookkeeping write must not turn a valid
      // call into a 404.
      try {
        await touchToken(row.id);
      } catch {
        /* bookkeeping only */
      }
    }
    return { id: row.id, email: row.email, label: row.label };
  } catch {
    return null; // fail closed
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/mcp/auth.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Typecheck and commit**

`tsc` will now fail on `app/api/mcp/[secret]/route.ts`, which still imports
`mcpSecretOk`. That is expected and fixed in Task 3 — commit the module now so
the two changes stay reviewable separately.

```bash
git add lib/mcp/auth.ts lib/mcp/auth.test.ts
git commit -m "feat(mcp): resolveMcpToken replaces the shared-secret check

Looks a candidate up by SHA-256 hash, fails closed on a dead database,
and throttles last_used_at writes. mcpSecretOk is gone; the route is
updated in the next commit."
```

---

### Task 3: Wire the MCP route and key the rate limiter per token

**Files:**
- Modify: `app/api/mcp/[secret]/route.ts:1-36`
- Modify: `app/api/mcp/[secret]/route.test.ts` (replace the whole file)

**Interfaces:**
- Consumes: `resolveMcpToken`, `McpCaller` from `lib/mcp/auth.ts` (Task 2).
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

Replace `app/api/mcp/[secret]/route.test.ts` entirely:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run "app/api/mcp/[secret]/route.test.ts"`
Expected: FAIL — the route still imports `mcpSecretOk`, which no longer exists.

- [ ] **Step 3: Write the implementation**

In `app/api/mcp/[secret]/route.ts`, change the import on line 3 and the `guard`
function (lines 21-28) to:

```ts
import { resolveMcpToken } from "@/lib/mcp/auth";
```

```ts
async function guard(req: Request, params: Promise<{ secret: string }>): Promise<Response> {
  const { secret } = await params;
  // 404, not 401: a 401 confirms something exists at this path and invites a
  // guess at the credential's shape. A stranger should see an empty universe.
  const caller = await resolveMcpToken(secret);
  if (!caller) return new Response("Not found", { status: 404 });
  // Keyed per token, not globally: one bucket meant four users' concurrent
  // tool calls throttled each other (TODO 9q). Still in-memory per serverless
  // instance, so best-effort — this stops users colliding, nothing more.
  if (!allow(`mcp:${caller.id}`, 120, 60_000)) {
    return new Response("Too many requests", { status: 429 });
  }
  return handler(req);
}
```

Also update the file-header comment: replace the sentence
"The secret lives in the PATH, which is why this route has a dynamic segment."
with:

```
// The token lives in the PATH, which is why this route has a dynamic segment.
// It is looked up by hash in mcp_tokens (lib/mcp/auth.ts) — there is no shared
// MCP_SECRET any more.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run "app/api/mcp/[secret]/route.test.ts"`
Expected: PASS, 7 tests.

- [ ] **Step 5: Confirm no reference to the old env var survives**

Run: `grep -rn "mcpSecretOk\|MCP_SECRET" --include=*.ts --include=*.tsx . | grep -v node_modules`
Expected: no hits in `lib/` or `app/`. Hits in `docs/` or `TODO.md` are history and stay.

- [ ] **Step 6: Typecheck, full suite, commit**

```bash
npx tsc --noEmit
npx vitest run
git add "app/api/mcp/[secret]/route.ts" "app/api/mcp/[secret]/route.test.ts"
git commit -m "feat(mcp): route resolves tokens from the table, rate limit per token

Fixes the single global bucket from TODO 9q. A rejected token no longer
consumes limiter budget at all."
```

---

### Task 4: The `admin` level and the `/connectors` gate

**Files:**
- Modify: `lib/auth.ts:13`, `:25`, `:29-35`, `:40-42`, `:60-69`, `:88-96`
- Modify: `lib/__tests__/auth.test.ts` (append a new `describe` block)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `Level` gains `"admin"`.
  - `CONNECTORS_PAGE: PageLink` (internal to `lib/auth.ts`, not exported).
  - `canAccess("admin", "/connectors") === true`; `canAccess("exec", "/connectors") === false`.
  - `accessiblePages("admin")` includes `{ href: "/connectors", label: "Connectors" }`.

- [ ] **Step 1: Write the failing test**

Append to `lib/__tests__/auth.test.ts`:

```ts
describe("the admin level and /connectors", () => {
  it("lets admin reach /connectors", () => {
    expect(canAccess("admin", "/connectors")).toBe(true);
  });

  // THE LOAD-BEARING ONE. The /connectors clause must sit BEFORE the exec
  // short-circuit in canAccess. If a later edit moves it after, exec silently
  // gains the ability to mint API credentials and every other test still passes.
  it("does NOT let exec reach /connectors", () => {
    expect(canAccess("exec", "/connectors")).toBe(false);
  });

  it("does not let any other level reach /connectors", () => {
    for (const level of ["base", "bea", "crystal", "monica", "ops", "elise"] as const) {
      expect(canAccess(level, "/connectors")).toBe(false);
    }
  });

  it("lets admin reach everything exec can", () => {
    for (const path of ["/", "/ops", "/report", "/kb", "/rob", "/bea", "/crystal", "/monica"]) {
      expect(canAccess("admin", path)).toBe(true);
    }
  });

  // /elise is reserved for the vendor pin and not even exec may enter it; admin
  // is no exception.
  it("does not let admin reach /elise", () => {
    expect(canAccess("admin", "/elise")).toBe(false);
  });

  it("shows Connectors in admin's nav and nobody else's", () => {
    const adminHrefs = accessiblePages("admin").map((p) => p.href);
    expect(adminHrefs).toContain("/connectors");
    for (const level of ["exec", "base", "bea", "crystal", "monica", "ops", "elise"] as const) {
      expect(accessiblePages(level).map((p) => p.href)).not.toContain("/connectors");
    }
  });

  it("lands admin on /connectors after login", () => {
    expect(homeForLevel("admin")).toBe("/connectors");
  });

  it("requires the admin level for /connectors", () => {
    expect(requiredLevel("/connectors")).toBe("admin");
  });

  it("includes admin in ALL_LEVELS so its cookie verifies", () => {
    expect(ALL_LEVELS).toContain("admin");
  });
});
```

Add any of `canAccess`, `accessiblePages`, `homeForLevel`, `requiredLevel`,
`ALL_LEVELS` that are not already imported at the top of that test file to its
import list from `@/lib/auth`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/__tests__/auth.test.ts`
Expected: FAIL — `"admin"` is not assignable to type `Level`.

- [ ] **Step 3: Write the implementation**

In `lib/auth.ts`:

Line 13 — add `"admin"` to the union:

```ts
export type Level = "base" | "exec" | "admin" | "crystal" | "monica" | "bea" | "ops" | "elise";
```

Line 25 — add it to `ALL_LEVELS`:

```ts
export const ALL_LEVELS: Level[] = ["base", "exec", "admin", "crystal", "monica", "bea", "ops", "elise"];
```

`requiredLevel` — add the `connectors` case before the `USER_PINS` lookup:

```ts
export function requiredLevel(pathname: string): Level {
  const seg = pathname.split("/")[1] ?? "";
  if (seg === "rob") return "exec";
  if (seg === "connectors") return "admin";
  const user = USER_PINS.find((u) => u.level === seg);
  if (user) return user.level;
  return "base";
}
```

`homeForLevel` — land admin on the page its PIN exists for:

```ts
export function homeForLevel(level: Level): string {
  if (level === "elise") return "/elise";
  if (level === "admin") return "/connectors";
  return "/";
}
```

`canAccess` — insert ONE clause, and its position matters. Update the doc
comment above it to record why:

```ts
/** Can `level` view `pathname`? Route groups, in priority order:
 *  1. `/elise` — RESERVED for the `elise` pin only. Not even exec/CEO may
 *     reach it (checked before the exec short-circuit below).
 *  2. `elise` itself can reach nothing else — fully isolated.
 *  3. `/connectors` — RESERVED for the `admin` pin only, and likewise checked
 *     BEFORE the exec short-circuit. It issues MCP credentials; the CEO has no
 *     need to mint them and fewer holders is better. Moving this clause below
 *     the exec check would silently grant exec that power.
 *  4. `admin` and `exec` see everything else — shared pages, every personal
 *     dashboard, and `/rob`.
 *  5. `/rob` is exec-only (exec and admin already handled above).
 *  6. `/crystal`, `/monica`, `/bea` are owner-only per-user dashboards.
 *  7. Everything else (shared pages `/`, `/ops`, `/report`, and any other
 *     gated route) is visible to any authenticated, non-restricted level. */
export function canAccess(level: Level, pathname: string): boolean {
  const seg = "/" + (pathname.split("/")[1] ?? "");
  if (seg === "/elise") return level === "elise"; // /elise: ONLY the ELISE pin — not even exec
  if (level === "elise") return false; // ELISE pin can reach nothing but /elise
  if (seg === "/connectors") return level === "admin"; // not even exec — see above
  if (level === "exec" || level === "admin") return true; // CEO + admin: everything else
  if (seg === "/rob") return false; // exec-only (exec handled above)
  if (seg === "/crystal" || seg === "/monica" || seg === "/bea") return seg === "/" + level; // owner only
  // shared pages + any other gated route → any authenticated non-restricted level
  return true;
}
```

Add the nav link constant beside `EXEC_PAGE` (line ~88) and extend
`accessiblePages`:

```ts
const EXEC_PAGE: PageLink = { href: "/rob", label: "Exec (CEO)" };
const CONNECTORS_PAGE: PageLink = { href: "/connectors", label: "Connectors" };

/** Pages this level may navigate to (for the nav bar). */
export function accessiblePages(level: Level): PageLink[] {
  if (level === "elise") return [{ href: "/elise", label: "EliseAI Leasing" }];
  if (level === "admin")
    return [...SHARED_PAGES, PERSONAL.crystal, PERSONAL.monica, PERSONAL.bea, EXEC_PAGE, CONNECTORS_PAGE];
  if (level === "exec") return [...SHARED_PAGES, PERSONAL.crystal, PERSONAL.monica, PERSONAL.bea, EXEC_PAGE];
  if (level in PERSONAL) return [...SHARED_PAGES, PERSONAL[level]];
  return [...SHARED_PAGES]; // base, ops (viewer)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/__tests__/auth.test.ts`
Expected: PASS, including the pre-existing tests in that file.

- [ ] **Step 5: Typecheck, full suite, commit**

```bash
npx tsc --noEmit
npx vitest run
git add lib/auth.ts lib/__tests__/auth.test.ts
git commit -m "feat(auth): add the admin level gating /connectors

Checked before the exec short-circuit, so the CEO cannot reach the
credential-issuing page. admin otherwise sees everything exec does."
```

---

### Task 5: Mint and revoke API routes

**Files:**
- Create: `config/mcp-users.ts`
- Create: `app/api/connectors/route.ts`
- Create: `app/api/connectors/route.test.ts`
- Create: `app/api/connectors/[id]/revoke/route.ts`
- Create: `app/api/connectors/[id]/revoke/route.test.ts`

**Interfaces:**
- Consumes: `generateToken`, `hashToken`, `connectorUrl`, `insertToken`, `revokeToken`, `countLiveTokens`, `MAX_LIVE_TOKENS` from `lib/mcp/tokens.ts` (Task 1); `AUTH_COOKIE`, `verifyCookie` from `lib/auth.ts` (Task 4).
- Produces:
  - `MCP_USERS: { email: string; name: string }[]` from `config/mcp-users.ts`.
  - `POST /api/connectors` → `{ ok: true, url }` | `{ ok: false, error }`
  - `POST /api/connectors/[id]/revoke` → `{ ok: true }` | `{ ok: false, error }`

- [ ] **Step 1: Create the user list**

Create `config/mcp-users.ts`:

```ts
// The people we hand MCP connector URLs to (spec 2026-08-12 §6).
//
// A dropdown on /connectors rather than a free-text box: mcp_tokens.email
// exists only so Kyle can tell whose URL is whose, and a typo silently
// corrupts exactly that. "Other" on the form still allows a free-text address
// for someone not on this list.
export const MCP_USERS: { email: string; name: string }[] = [
  { email: "rb@rise8companies.com", name: "Rob" },
  { email: "bke@rentstayable.com", name: "Kyle" },
  { email: "cj@rentstayable.com", name: "Crystal" },
  { email: "kate@rentstayable.com", name: "Kate" },
  { email: "bea@rentstayable.com", name: "Bea" },
  { email: "monica@rentstayable.com", name: "Monica" },
  { email: "jefferson@rentstayable.com", name: "Jefferson" },
  { email: "gerardo@rentstayable.com", name: "Gerardo" },
];
```

- [ ] **Step 2: Write the failing test for minting**

Create `app/api/connectors/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const verifyCookie = vi.fn();
const insertToken = vi.fn();
const countLiveTokens = vi.fn();
const cookieGet = vi.fn();

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => cookieGet(n) }),
}));
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, verifyCookie: (...a: unknown[]) => verifyCookie(...a) };
});
vi.mock("@/lib/mcp/tokens", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mcp/tokens")>();
  return {
    ...actual,
    insertToken: (...a: unknown[]) => insertToken(...a),
    countLiveTokens: (...a: unknown[]) => countLiveTokens(...a),
  };
});

import { POST } from "./route";
import { hashToken, MAX_LIVE_TOKENS } from "@/lib/mcp/tokens";

function post(body: unknown, host = "localhost") {
  return POST(
    new Request(`http://${host}/api/connectors`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  verifyCookie.mockReset();
  insertToken.mockReset();
  countLiveTokens.mockReset();
  cookieGet.mockReset();
  cookieGet.mockReturnValue({ value: "admin.sig" });
  verifyCookie.mockResolvedValue("admin");
  countLiveTokens.mockResolvedValue(0);
});

describe("POST /api/connectors", () => {
  it("mints a token and returns its URL once", async () => {
    const res = await post({ email: "kate@rentstayable.com", label: "Desktop" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.url).toMatch(
      /^https:\/\/dashboard\.rentstayable\.com\/api\/mcp\/[0-9a-f]{64}$/,
    );
  });

  // THE REGRESSION TEST FOR SESSIONS 9n/9o. A host-derived URL would produce a
  // *.vercel.app address that returns Vercel's SSO page — indistinguishable
  // from a broken connector in Claude Desktop.
  it("uses the custom domain even when the request host is a preview URL", async () => {
    const res = await post(
      { email: "kate@rentstayable.com", label: null },
      "cloudbeds-dashboard-git-abc.vercel.app",
    );
    const body = await res.json();
    expect(body.url).toContain("https://dashboard.rentstayable.com/");
    expect(body.url).not.toContain("vercel.app");
  });

  it("stores the hash, never the token", async () => {
    const res = await post({ email: "kate@rentstayable.com", label: "Desktop" });
    const { url } = await res.json();
    const token = url.split("/").pop() as string;
    expect(insertToken).toHaveBeenCalledWith({
      email: "kate@rentstayable.com",
      label: "Desktop",
      tokenHash: hashToken(token),
    });
    const stored = insertToken.mock.calls[0][0] as { tokenHash: string };
    expect(stored.tokenHash).not.toBe(token);
  });

  it("rejects a non-admin session and writes nothing", async () => {
    verifyCookie.mockResolvedValue("exec");
    const res = await post({ email: "kate@rentstayable.com", label: null });
    expect(res.status).toBe(403);
    expect(insertToken).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated request", async () => {
    verifyCookie.mockResolvedValue(null);
    const res = await post({ email: "kate@rentstayable.com", label: null });
    expect(res.status).toBe(403);
    expect(insertToken).not.toHaveBeenCalled();
  });

  it("rejects a missing or malformed email", async () => {
    for (const email of [undefined, "", "not-an-email", "a@b", "x@y.", 42]) {
      const res = await post({ email, label: null });
      expect(res.status).toBe(400);
    }
    expect(insertToken).not.toHaveBeenCalled();
  });

  it("lowercases and trims the email", async () => {
    await post({ email: "  Kate@RentStayable.com  ", label: null });
    expect(insertToken).toHaveBeenCalledWith(
      expect.objectContaining({ email: "kate@rentstayable.com" }),
    );
  });

  it("treats a blank label as null rather than an empty string", async () => {
    await post({ email: "kate@rentstayable.com", label: "   " });
    expect(insertToken).toHaveBeenCalledWith(
      expect.objectContaining({ label: null }),
    );
  });

  it("refuses once the live-token cap is reached", async () => {
    countLiveTokens.mockResolvedValue(MAX_LIVE_TOKENS);
    const res = await post({ email: "kate@rentstayable.com", label: null });
    expect(res.status).toBe(400);
    expect(insertToken).not.toHaveBeenCalled();
  });

  it("does not leak the token in an error when the insert fails", async () => {
    insertToken.mockRejectedValue(new Error("db down"));
    const res = await post({ email: "kate@rentstayable.com", label: null });
    expect(res.status).toBe(500);
    const text = JSON.stringify(await res.json());
    expect(text).not.toMatch(/[0-9a-f]{64}/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run app/api/connectors/route.test.ts`
Expected: FAIL — cannot resolve `./route`.

- [ ] **Step 4: Write the mint route**

Create `app/api/connectors/route.ts`:

```ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { AUTH_COOKIE, verifyCookie } from "@/lib/auth";
import {
  generateToken,
  hashToken,
  connectorUrl,
  insertToken,
  countLiveTokens,
  MAX_LIVE_TOKENS,
} from "@/lib/mcp/tokens";

export const dynamic = "force-dynamic";

const MAX_EMAIL = 200;
const MAX_LABEL = 120;

// Deliberately loose: this is a typo guard on an internal dropdown, not an
// identity check. Requires a dot-separated TLD of at least two characters.
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[^\s@.]{2,}$/;

/** Issue a connector URL. Admin only — the /connectors page's rendering choice
 *  is presentation; THIS is the gate. The raw token is returned exactly once
 *  and never stored, logged, or recoverable. */
export async function POST(req: Request) {
  const level = await verifyCookie((await cookies()).get(AUTH_COOKIE)?.value);
  if (level !== "admin") {
    return NextResponse.json({ ok: false, error: "not authorised" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const rawLabel = typeof body?.label === "string" ? body.label.trim() : "";
  const label = rawLabel || null;

  if (!email || email.length > MAX_EMAIL || !EMAIL_RE.test(email)) {
    return NextResponse.json({ ok: false, error: "a valid email is required" }, { status: 400 });
  }
  if (label && label.length > MAX_LABEL) {
    return NextResponse.json(
      { ok: false, error: `label must be ${MAX_LABEL} characters or fewer` },
      { status: 400 },
    );
  }

  try {
    if ((await countLiveTokens()) >= MAX_LIVE_TOKENS) {
      return NextResponse.json(
        { ok: false, error: `at most ${MAX_LIVE_TOKENS} live tokens — revoke one first` },
        { status: 400 },
      );
    }
    const token = generateToken();
    await insertToken({ email, label, tokenHash: hashToken(token) });
    // The ONLY time this value exists outside the caller's browser. Never
    // logged: the catch below returns a fixed string for that reason.
    return NextResponse.json({ ok: true, url: connectorUrl(token) });
  } catch {
    return NextResponse.json({ ok: false, error: "could not issue a URL" }, { status: 500 });
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run app/api/connectors/route.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 6: Write the failing test for revoke**

Create `app/api/connectors/[id]/revoke/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const verifyCookie = vi.fn();
const revokeToken = vi.fn();
const cookieGet = vi.fn();

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => cookieGet(n) }),
}));
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, verifyCookie: (...a: unknown[]) => verifyCookie(...a) };
});
vi.mock("@/lib/mcp/tokens", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mcp/tokens")>();
  return { ...actual, revokeToken: (...a: unknown[]) => revokeToken(...a) };
});

import { POST } from "./route";

function post(id: string) {
  return POST(new Request(`http://localhost/api/connectors/${id}/revoke`, { method: "POST" }), {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => {
  verifyCookie.mockReset();
  revokeToken.mockReset();
  cookieGet.mockReset();
  cookieGet.mockReturnValue({ value: "admin.sig" });
  verifyCookie.mockResolvedValue("admin");
});

describe("POST /api/connectors/[id]/revoke", () => {
  it("revokes the token", async () => {
    const res = await post("7");
    expect(res.status).toBe(200);
    expect(revokeToken).toHaveBeenCalledWith(7);
  });

  it("rejects a non-admin session and touches nothing", async () => {
    verifyCookie.mockResolvedValue("exec");
    const res = await post("7");
    expect(res.status).toBe(403);
    expect(revokeToken).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated request", async () => {
    verifyCookie.mockResolvedValue(null);
    const res = await post("7");
    expect(res.status).toBe(403);
    expect(revokeToken).not.toHaveBeenCalled();
  });

  it("rejects a non-numeric id", async () => {
    for (const id of ["abc", "", "1; drop table mcp_tokens", "1.5", "-1"]) {
      const res = await post(id);
      expect(res.status).toBe(400);
    }
    expect(revokeToken).not.toHaveBeenCalled();
  });

  // Idempotent by design: revokeToken's WHERE clause skips an already-revoked
  // row, so a double click is a success, not an error.
  it("succeeds when the token is already revoked", async () => {
    revokeToken.mockResolvedValue(undefined);
    const res = await post("7");
    expect(res.status).toBe(200);
  });

  it("500s when the update fails", async () => {
    revokeToken.mockRejectedValue(new Error("db down"));
    const res = await post("7");
    expect(res.status).toBe(500);
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npx vitest run "app/api/connectors/[id]/revoke/route.test.ts"`
Expected: FAIL — cannot resolve `./route`.

- [ ] **Step 8: Write the revoke route**

Create `app/api/connectors/[id]/revoke/route.ts`:

```ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { AUTH_COOKIE, verifyCookie } from "@/lib/auth";
import { revokeToken } from "@/lib/mcp/tokens";

export const dynamic = "force-dynamic";

/** Kill one connector URL. Admin only. Idempotent — revokeToken's WHERE skips
 *  an already-revoked row, so its original timestamp survives a second click.
 *  The row itself is KEPT so "who had access in August" stays answerable. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const level = await verifyCookie((await cookies()).get(AUTH_COOKIE)?.value);
  if (level !== "admin") {
    return NextResponse.json({ ok: false, error: "not authorised" }, { status: 403 });
  }

  const { id } = await ctx.params;
  if (!/^\d+$/.test(id)) {
    return NextResponse.json({ ok: false, error: "invalid id" }, { status: 400 });
  }

  try {
    await revokeToken(Number(id));
  } catch {
    return NextResponse.json({ ok: false, error: "could not revoke" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `npx vitest run "app/api/connectors/[id]/revoke/route.test.ts"`
Expected: PASS, 6 tests.

- [ ] **Step 10: Typecheck, full suite, commit**

```bash
npx tsc --noEmit
npx vitest run
git add config/mcp-users.ts app/api/connectors
git commit -m "feat(connectors): mint and revoke API routes, admin only

Mint returns the URL once and stores only its hash. Both routes gate on
the admin level server-side, independent of what the page renders."
```

---

### Task 6: The `/connectors` page

**Files:**
- Create: `app/connectors/page.tsx`
- Create: `components/IssueConnector.tsx`
- Create: `components/ConnectorRow.tsx`
- Create: `lib/mcp/connector-view.ts`
- Create: `lib/mcp/connector-view.test.ts`

**Interfaces:**
- Consumes: `listTokens`, `McpTokenRow` from `lib/mcp/tokens.ts` (Task 1); `MCP_USERS` from `config/mcp-users.ts` (Task 5); `POST /api/connectors` and `POST /api/connectors/[id]/revoke` (Task 5).
- Produces:
  - `relativeAge(iso: string | null, nowMs: number): string` from `lib/mcp/connector-view.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/mcp/connector-view.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { relativeAge } from "./connector-view";

const now = Date.parse("2026-08-12T12:00:00.000Z");

describe("relativeAge", () => {
  // "never" is the signal that a URL was issued and never installed — the
  // single most useful thing on the page, so it must not render as "—".
  it("says never for a token that has not been used", () => {
    expect(relativeAge(null, now)).toBe("never");
  });

  it("renders minutes, hours and days", () => {
    expect(relativeAge(new Date(now - 90_000).toISOString(), now)).toBe("1 minute ago");
    expect(relativeAge(new Date(now - 2 * 3_600_000).toISOString(), now)).toBe("2 hours ago");
    expect(relativeAge(new Date(now - 3 * 86_400_000).toISOString(), now)).toBe("3 days ago");
  });

  it("says just now for the last minute", () => {
    expect(relativeAge(new Date(now - 5_000).toISOString(), now)).toBe("just now");
  });

  it("singularises correctly", () => {
    expect(relativeAge(new Date(now - 3_600_000).toISOString(), now)).toBe("1 hour ago");
    expect(relativeAge(new Date(now - 86_400_000).toISOString(), now)).toBe("1 day ago");
  });

  it("does not render an unparseable timestamp as a fake age", () => {
    expect(relativeAge("not-a-date", now)).toBe("unknown");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/mcp/connector-view.test.ts`
Expected: FAIL — cannot resolve `./connector-view`.

- [ ] **Step 3: Write the implementation**

Create `lib/mcp/connector-view.ts`:

```ts
// Presentation helpers for /connectors. Pure, so they are unit-tested rather
// than eyeballed in the browser.

/** "2 hours ago" / "never" / "unknown". `never` is deliberately a word rather
 *  than a dash: it is the signal that a URL was issued and never installed. */
export function relativeAge(iso: string | null, nowMs: number): string {
  if (!iso) return "never";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "unknown";
  const secs = Math.max(0, Math.floor((nowMs - t) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/mcp/connector-view.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Write the issue form**

Create `components/IssueConnector.tsx`:

```tsx
"use client";

import { useState } from "react";
import { MCP_USERS } from "@/config/mcp-users";

const INPUT =
  "w-full rounded-[7px] border border-lineStrong bg-surface px-3 py-2 text-[13px] text-txt outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/20";

/** Issue a connector URL. The returned URL is shown ONCE — only its hash is
 *  stored, so it cannot be retrieved again. */
export default function IssueConnector() {
  const [choice, setChoice] = useState("");
  const [otherEmail, setOtherEmail] = useState("");
  const [label, setLabel] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [url, setUrl] = useState("");
  const [copied, setCopied] = useState(false);

  const email = choice === "other" ? otherEmail.trim() : choice;
  const canSubmit = email.length > 0 && status !== "saving";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("saving");
    setErrorMsg("");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch("/api/connectors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, label }),
        signal: controller.signal,
      });
      const b = await res.json().catch(() => ({}));
      if (res.ok && b?.url) {
        setUrl(b.url);
        setStatus("done");
      } else {
        setErrorMsg(b?.error || "Could not issue a URL.");
        setStatus("error");
      }
    } catch {
      setErrorMsg("Could not reach the server. Try again.");
      setStatus("error");
    } finally {
      clearTimeout(timeout);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  if (status === "done") {
    return (
      <section className="rounded-[10px] border border-pos/40 bg-posbg p-5 sm:p-6">
        <p className="text-lg font-semibold text-pos">URL issued for {email}</p>
        <p className="mt-1 text-sm text-pos">
          This is the only time it is shown. Only its hash is stored — if it is lost, revoke it and
          issue a new one.
        </p>
        <code className="mt-3 block break-all rounded-[7px] border border-lineStrong bg-surface p-3 text-[12.5px] text-txt">
          {url}
        </code>
        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={copy}
            className="rounded-[7px] bg-accent px-4 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
          >
            {copied ? "Copied" : "Copy URL"}
          </button>
          <button
            onClick={() => {
              setStatus("idle");
              setUrl("");
              setCopied(false);
              setChoice("");
              setOtherEmail("");
              setLabel("");
            }}
            className="text-sm font-medium text-txt2 hover:text-txt"
          >
            Issue another
          </button>
        </div>
        <p className="mt-3 text-xs text-txt2">
          Send it directly to the person. This URL <span className="font-semibold">is</span> the
          credential — anyone holding it has full read access, so do not paste it into a group chat.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-[10px] border border-line bg-surface p-5 shadow-card sm:p-6">
      <p className="text-[10.5px] font-semibold uppercase tracking-[.08em] text-txt3">Issue</p>
      <h2 className="mt-1 text-lg font-semibold text-txt">New connector URL</h2>
      <form onSubmit={submit} className="mt-3 space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-[10.5px] font-semibold uppercase tracking-[.08em] text-txt3">
              Tied to *
            </span>
            <select
              value={choice}
              onChange={(e) => setChoice(e.target.value)}
              required
              className={"mt-1 " + INPUT}
            >
              <option value="">Select…</option>
              {MCP_USERS.map((u) => (
                <option key={u.email} value={u.email}>
                  {u.name} — {u.email}
                </option>
              ))}
              <option value="other">Other…</option>
            </select>
          </label>
          <label className="block">
            <span className="text-[10.5px] font-semibold uppercase tracking-[.08em] text-txt3">
              Label (optional)
            </span>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Claude Desktop — laptop"
              className={"mt-1 " + INPUT}
            />
          </label>
        </div>

        {choice === "other" && (
          <label className="block">
            <span className="text-[10.5px] font-semibold uppercase tracking-[.08em] text-txt3">
              Email address
            </span>
            <input
              value={otherEmail}
              onChange={(e) => setOtherEmail(e.target.value)}
              placeholder="name@rentstayable.com"
              className={"mt-1 " + INPUT}
            />
          </label>
        )}

        {status === "error" && <p className="text-sm text-neg">{errorMsg}</p>}

        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded-[7px] bg-accent px-5 py-3 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {status === "saving" ? "Issuing…" : "Issue URL"}
        </button>
      </form>
    </section>
  );
}
```

- [ ] **Step 6: Write the revoke button**

Create `components/ConnectorRow.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Revoke button for one token. Two-step: the first click asks, the second
 *  does it — the URL dies immediately and nobody is warned. */
export default function ConnectorRow({ id, email }: { id: number; email: string | null }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");

  async function revoke() {
    setStatus("saving");
    try {
      const res = await fetch(`/api/connectors/${id}/revoke`, { method: "POST" });
      if (res.ok) {
        router.refresh();
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("error");
    }
  }

  if (status === "error") return <span className="text-[12.5px] text-neg">Failed — reload</span>;

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className="rounded-[7px] border border-lineStrong px-3 py-1.5 text-[12.5px] font-semibold text-txt2 transition-colors hover:border-neg hover:text-neg"
      >
        Revoke
      </button>
    );
  }

  return (
    <span className="flex items-center gap-2">
      <button
        onClick={revoke}
        disabled={status === "saving"}
        className="rounded-[7px] bg-neg px-3 py-1.5 text-[12.5px] font-semibold text-white disabled:opacity-50"
      >
        {status === "saving" ? "Revoking…" : `Kill ${email ?? "this URL"}`}
      </button>
      <button
        onClick={() => setConfirming(false)}
        className="text-[12.5px] font-medium text-txt2 hover:text-txt"
      >
        Cancel
      </button>
    </span>
  );
}
```

- [ ] **Step 7: Write the page**

Create `app/connectors/page.tsx`:

```tsx
import { listTokens } from "@/lib/mcp/tokens";
import { relativeAge } from "@/lib/mcp/connector-view";
import IssueConnector from "@/components/IssueConnector";
import ConnectorRow from "@/components/ConnectorRow";

// Reads the DB on every request: a stale token list would show a revoked URL
// as live, which is the one thing this page must never do.
export const dynamic = "force-dynamic";

export const metadata = { title: "Connectors — Stayable" };

function fmtDate(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const d = new Date(t);
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${mm}/${dd}/${String(d.getUTCFullYear()).slice(2)}`;
}

export default async function ConnectorsPage() {
  let tokens: Awaited<ReturnType<typeof listTokens>> = [];
  let loadFailed = false;
  try {
    tokens = await listTokens();
  } catch {
    loadFailed = true;
  }
  const now = Date.now();

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <header>
        <p className="text-[10.5px] font-semibold uppercase tracking-[.08em] text-txt3">Admin</p>
        <h1 className="mt-1 text-2xl font-semibold text-txt">MCP connectors</h1>
        <p className="mt-2 max-w-2xl text-sm text-txt2">
          One URL per person, individually revocable. Each is recorded against the email it was
          given to — that record is a label typed here, not proof of identity, so it is accurate
          only as far as this page is filled in accurately.
        </p>
      </header>

      <section className="mt-6 rounded-[10px] border border-line bg-surface2 p-4 text-sm text-txt2">
        <p>
          <span className="font-semibold text-txt">The MCP carries no guest data, deliberately.</span>{" "}
          The <code>/bea</code> balance-due exception does not extend here — a URL sitting in a
          settings pane is a weaker gate than the PIN, so it carries the less sensitive data. Ask a
          connector who owes rent and it returns nothing. Tell people this before they connect, or
          it reads as broken.
        </p>
      </section>

      <div className="mt-6">
        <IssueConnector />
      </div>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-txt">Issued</h2>
        {loadFailed ? (
          <p className="mt-3 text-sm text-neg">
            Could not load the token list. The connectors themselves are unaffected — this page
            reads the database, and every MCP request checks it independently.
          </p>
        ) : tokens.length === 0 ? (
          <p className="mt-3 text-sm text-txt2">No URLs issued yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left text-[13px]">
              <thead>
                <tr className="border-b border-lineStrong">
                  {["Tied to", "Label", "Created", "Last used", ""].map((h) => (
                    <th
                      key={h}
                      className="pb-2 pr-3 text-[10.5px] font-semibold uppercase tracking-[.08em] text-txt3"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tokens.map((t) => {
                  const dead = t.revokedAt !== null;
                  return (
                    <tr key={t.id} className="border-b border-line align-top">
                      <td className={"py-3 pr-3 " + (dead ? "text-txt3 line-through" : "text-txt")}>
                        {t.email ?? "—"}
                      </td>
                      <td className="py-3 pr-3 text-txt2">{t.label ?? "—"}</td>
                      <td className="py-3 pr-3 text-txt2">{fmtDate(t.createdAt)}</td>
                      <td className="py-3 pr-3 text-txt2">
                        {dead ? `revoked ${fmtDate(t.revokedAt!)}` : relativeAge(t.lastUsedAt, now)}
                      </td>
                      <td className="py-3">
                        {dead ? null : <ConnectorRow id={t.id} email={t.email} />}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
```

- [ ] **Step 8: Verify the route builds and is gated**

Run: `npx tsc --noEmit && npm run build`
Expected: exit 0, and `/connectors` appears in the printed route table.

Then confirm the gate, which needs no middleware change but must be proven:

Run: `grep -n "api/mcp/\.\*" middleware.ts`
Expected: one hit. Confirm by eye that the matcher's exclusion list contains
neither `connectors` nor a bare `api/mcp` — `api/mcp/.*` requires the slash, so
`/connectors` and `/api/connectors` both stay gated.

- [ ] **Step 9: Full suite and commit**

```bash
npx vitest run
git add app/connectors components/IssueConnector.tsx components/ConnectorRow.tsx lib/mcp/connector-view.ts lib/mcp/connector-view.test.ts
git commit -m "feat(connectors): the /connectors admin page

Issue a URL shown once, list every token with last-used, revoke in two
clicks. Revoked rows stay visible struck through so history survives."
```

---

### Task 7: Seed the `ILLUSTRIOUS` PIN and migrate the legacy shared secret

**Files:**
- Create: `scripts/seed-connectors.mjs`
- Create: `scripts/verify-legacy-token.mjs`
- Modify: `TODO.md` (add the retirement item to the top session block)

**Interfaces:**
- Consumes: the `mcp_tokens` and `dashboard_pins` tables (Task 1); `.secrets/mcp-secret.txt`.
- Produces: one `dashboard_pins` row (`admin`) and one `mcp_tokens` row (the legacy URL).

- [ ] **Step 1: Write the seed script**

Create `scripts/seed-connectors.mjs`:

```js
// One-shot seed for the connector-tokens release (spec 2026-08-12).
//
// Does two things, both idempotent:
//   1. Sets the `admin` PIN (ILLUSTRIOUS), which gates /connectors.
//   2. Migrates the existing shared MCP_SECRET into mcp_tokens as an ordinary
//      row, so Rob's and Kate's connectors keep working and can later be
//      retired with a click instead of a Vercel edit and a redeploy.
//
// Run:  node scripts/seed-connectors.mjs
//
// NOTE: this writes to PRODUCTION. Local, preview and production share one
// DATABASE_URL (established session 9p). Both writes are additive.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  console.error("No DATABASE_URL(_UNPOOLED) in .env.local");
  process.exit(1);
}
const sql = neon(url);

// --- 1. the admin PIN --------------------------------------------------------
const ADMIN_PIN = "ILLUSTRIOUS";
await sql`
  insert into dashboard_pins (level, pin, updated_at)
  values ('admin', ${ADMIN_PIN}, now())
  on conflict (level) do update set pin = excluded.pin, updated_at = now()
`;
console.log("dashboard_pins: admin PIN set.");

// --- 2. the legacy shared URL ------------------------------------------------
// Kate shares this URL with Rob today. Recording it as Rob's with the sharing
// in the label keeps the page honest: a null owner would lose the fact that it
// is his original connector.
let legacySecret;
try {
  legacySecret = readFileSync(new URL("../.secrets/mcp-secret.txt", import.meta.url), "utf8").trim();
} catch {
  console.error(
    "Could not read .secrets/mcp-secret.txt — copy the value from Vercel's\n" +
      "MCP_SECRET env var into that file first, or Rob's and Kate's existing\n" +
      "connectors will stop working when MCP_SECRET is removed.",
  );
  process.exit(1);
}
if (legacySecret.length < 32) {
  console.error("The value in .secrets/mcp-secret.txt is too short to be the real secret.");
  process.exit(1);
}

const legacyHash = createHash("sha256").update(legacySecret, "utf8").digest("hex");
const existing = await sql`select id from mcp_tokens where token_hash = ${legacyHash}`;
if (existing.length > 0) {
  console.log(`mcp_tokens: legacy row already present (id ${existing[0].id}).`);
} else {
  const [row] = await sql`
    insert into mcp_tokens (email, label, token_hash)
    values ('rb@rise8companies.com', 'legacy shared URL — also used by Kate', ${legacyHash})
    returning id
  `;
  console.log(`mcp_tokens: legacy row inserted (id ${row.id}).`);
}

// Never print the secret or the token itself — only ever the hash's prefix, and
// only so the operator can match this row to the one on the page.
console.log(`Legacy hash starts ${legacyHash.slice(0, 8)}…`);
```

- [ ] **Step 2: Run the seed**

Run: `node scripts/seed-connectors.mjs`
Expected output: `dashboard_pins: admin PIN set.`, then either
`mcp_tokens: legacy row inserted (id N).` or `already present`.

- [ ] **Step 3: Verify it is idempotent**

Run: `node scripts/seed-connectors.mjs`
Expected: the second run prints `legacy row already present` and does not insert
a duplicate.

- [ ] **Step 4: Prove the stored hash matches the real secret**

This is the check that stops Rob's connector breaking. Create
`scripts/verify-legacy-token.mjs`:

```js
// Confirms the legacy MCP secret in .secrets/ matches the row in mcp_tokens.
// If this fails, removing MCP_SECRET from Vercel would break Rob's and Kate's
// connectors. Prints no secret and no token — only the hash prefix.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}
const sql = neon(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL);

const secret = readFileSync(new URL("../.secrets/mcp-secret.txt", import.meta.url), "utf8").trim();
const hash = createHash("sha256").update(secret, "utf8").digest("hex");

const rows = await sql`
  select id, email, label, revoked_at from mcp_tokens
  where token_hash = ${hash} and revoked_at is null
`;
if (rows.length !== 1) {
  console.error(`FAIL: ${rows.length} live rows match hash ${hash.slice(0, 8)}… (expected 1).`);
  console.error("Rob's and Kate's existing connectors would NOT work.");
  process.exit(1);
}
console.log(`OK: legacy URL resolves to id ${rows[0].id}, ${rows[0].email} — ${rows[0].label}`);
```

Run: `node scripts/verify-legacy-token.mjs`
Expected: `OK: legacy URL resolves to id N, rb@rise8companies.com — legacy shared URL — also used by Kate`

If it prints FAIL, do **not** proceed to remove `MCP_SECRET` from Vercel.

- [ ] **Step 5: Record the retirement trigger in TODO.md**

Add to the top session block of `TODO.md`:

```markdown
> **[ ] RETIRE THE LEGACY SHARED MCP URL.** It is now row `legacy shared URL —
> also used by Kate` in `mcp_tokens`, owned by `rb@rise8companies.com`. While it
> lives, revocation is still all-or-nothing for whoever holds it, and that URL
> has already travelled through Teams.
> 1. Issue a URL for `rb@rise8companies.com` and one for `kate@rentstayable.com`
>    from `/connectors` (PIN `ILLUSTRIOUS`).
> 2. Send each of them their own, and tell them to replace the old connector.
> 3. When `/connectors` shows both new tokens in use **and no legacy use for 7
>    consecutive days**, click Revoke on the legacy row.
> **Also: delete `MCP_SECRET` from Vercel** — nothing reads it any more, and
> leaving it implies it still works.
```

- [ ] **Step 6: Full verification and commit**

```bash
npx tsc --noEmit
npx vitest run
npm run build
git add scripts/seed-connectors.mjs scripts/verify-legacy-token.mjs TODO.md
git commit -m "feat(connectors): seed the admin PIN and migrate the shared secret

The old MCP_SECRET becomes an ordinary mcp_tokens row owned by Rob and
labelled as shared with Kate, so existing connectors keep working and
retire with a click. Records the retirement trigger in TODO."
```

---

## Post-implementation verification

These need a real deployment and cannot be proven locally. Run them **in this
order** after pushing.

- [ ] **`/connectors` is gated.** Unauthenticated `GET https://dashboard.rentstayable.com/connectors` → **307** to `/login`. If it returns 200, stop — the page is public.
- [ ] **`exec` cannot reach it.** Log in with the exec PIN, visit `/connectors` → redirected. This is the clause-ordering guarantee from Task 4, live.
- [ ] **`ILLUSTRIOUS` works and lands on `/connectors`.**
- [ ] **The legacy row appears in the list**, owned by `rb@rise8companies.com`.
- [ ] **Rob's existing connector still works.** Do not skip this — it is the one thing that would break someone who is using this today. Easiest check: the legacy row's `Last used` stops saying `never` once he makes a call.
- [ ] **Issue a URL to yourself and connect it** from Claude Desktop, using `dashboard.rentstayable.com`. A `*.vercel.app` URL returns Vercel's SSO page and looks like a broken connector.
- [ ] **Revoke that test URL and confirm the connector dies** — this is the whole point of the release, and it is the only end-to-end proof that hash lookup plus the `revoked_at is null` filter actually work together.
- [ ] **Only then delete `MCP_SECRET` from Vercel.**

---

## Deliberately not in this plan

Recorded so a reviewer does not read these as omissions. All are spec §11.

- **Bearer token in a header** — verified impossible from the connector dialog on 08/12/26 (spec §3).
- **Entra ID OAuth** — deferred with a trigger. Request access to "Managed authorization" (Beta) separately; it is not a code task.
- **Self-serve minting.** Kyle issues every URL, by choice.
- **Per-tool scoping** via `withMcpAuth`'s `requiredScopes`.
- **Rate-limiting `/api/auth`** — a real pre-existing gap (no `allow()` call, unlike `/api/submit`), and it matters slightly more now that `ILLUSTRIOUS` can mint credentials. Separable, Kyle's call.
- **Hashing `dashboard_pins`** — pre-existing plaintext storage.
- **`/personal-view`** — a separate spec.
