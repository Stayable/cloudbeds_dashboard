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

/** How many hex characters of the token show at each end in the /connectors
 *  table. See tokenPreview for why storing this is safe. */
export const PREVIEW_EDGE = 6;

export type McpTokenRow = {
  id: number;
  email: string | null;
  label: string | null;
  /** First and last few characters of the token, e.g. "a1b2c3…7eb0dc". Null for
   *  rows minted before previews existed. NOT a credential — see tokenPreview. */
  preview: string | null;
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

/** An identifying fragment of the token — first and last PREVIEW_EDGE hex
 *  characters — so a URL someone is holding can be matched to a row on
 *  /connectors by eye.
 *
 *  WHY STORING THIS IS SAFE, and why it is nonetheless a deliberate narrowing
 *  of "only the hash is stored":
 *  A token is 32 random bytes = 256 bits. Revealing 12 of its 64 hex characters
 *  discloses 48 bits and leaves ~208 unknown, which is not brute-forceable by
 *  any margin that matters. So the preview cannot be used to reconstruct a
 *  working URL. But it IS a piece of the credential sitting in the database in
 *  plaintext, where previously nothing was — recorded here rather than left for
 *  someone to discover.
 *
 *  A short token is masked entirely rather than mostly revealed: anything at or
 *  below 2*PREVIEW_EDGE characters returns only the ellipsis, so a
 *  hypothetical short token cannot be leaked whole by this function. */
export function tokenPreview(token: string): string {
  if (token.length <= PREVIEW_EDGE * 2) return "…";
  return `${token.slice(0, PREVIEW_EDGE)}…${token.slice(-PREVIEW_EDGE)}`;
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
    preview: r.token_preview == null ? null : String(r.token_preview),
    createdAt: iso(r.created_at) ?? new Date(0).toISOString(),
    lastUsedAt: iso(r.last_used_at),
    revokedAt: iso(r.revoked_at),
  };
}

/** The LIVE token matching this hash, or null. Revoked rows are excluded here,
 *  in SQL — that is the mechanism by which a revoked URL stops working. */
export async function findLiveTokenByHash(hash: string): Promise<McpTokenRow | null> {
  const rows = (await db()`
    select id, email, label, token_preview, created_at, last_used_at, revoked_at
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
  tokenPreview: string;
}): Promise<void> {
  await db()`
    insert into mcp_tokens (email, label, token_hash, token_preview)
    values (${input.email}, ${input.label}, ${input.tokenHash}, ${input.tokenPreview})
  `;
}

/** Every token, newest first, INCLUDING revoked ones — the page shows them
 *  struck through so history stays visible. */
export async function listTokens(): Promise<McpTokenRow[]> {
  const rows = (await db()`
    select id, email, label, token_preview, created_at, last_used_at, revoked_at
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
