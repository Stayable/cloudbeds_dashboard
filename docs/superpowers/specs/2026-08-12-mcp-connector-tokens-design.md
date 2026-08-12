# MCP connector tokens — design

**Date:** 2026-08-12
**Status:** approved by Kyle 08/12/26
**Supersedes:** the single shared `MCP_SECRET` shipped in session 9n
**Related:** `docs/superpowers/specs/` (MCP server spec, 2026-08-11), TODO sessions 9n / 9o / 9q

---

## 1. Problem

The MCP server ships with **one** secret in `MCP_SECRET`, and four people now need
it — Rob, Kate, Bea, Crystal. TODO 9q named three failures, all real today:

1. **Revocation is all-or-nothing.** Rotating the secret for one person silently
   kills every other connector, with no warning to any of them.
2. **No attribution.** The server cannot tell whose call it is answering, so a
   wrongly-quoted number cannot be traced back to a question.
3. **The URL *is* the credential.** It travels through Teams and then sits in
   plain text in each person's Claude Desktop settings. One screenshot in a group
   chat is permanent read access to the portfolio.

Plus one latent bug: `app/api/mcp/[secret]/route.ts:26` is
`allow("mcp", 120, 60_000)` — a single global bucket, so four users' concurrent
tool calls throttle each other.

## 2. What this builds

A new PIN-gated admin page where **Kyle alone** issues, tracks and revokes
connector URLs, each recorded against the email of the person it was given to.

- New PIN `ILLUSTRIOUS` → new level `admin` → new page `/connectors`.
- One new Neon table, `mcp_tokens`.
- `MCP_SECRET` is retired: the existing shared secret is seeded **into the table
  as an ordinary row**, so Rob's and Kate's connectors keep working and can later
  be revoked with a click.

## 3. Decisions, including the ones reversed

Kyle iterated through several shapes on 08/12/26. Recording the rejected ones,
because the reasons still apply if this is revisited.

| Considered | Outcome | Why |
|---|---|---|
| `MCP_SECRETS` env var of `label:secret` pairs (the 9q recommendation) | **rejected** | Every roster change means editing Vercel and redeploying. A DB table is barely more work and revocation stops being a deploy. |
| Self-serve minting per user, authorised by PIN **level** | **rejected** | Forced a `kate` level into existence and still attributed tokens to a role, not a person. |
| Dashboard **user accounts** (email + scrypt password), self-serve minting | **rejected** | ~2 hrs of bespoke auth, eight password hashes to hold, a forced-change flow, and a manual reset burden on Kyle forever. |
| Replacing all PINs with per-person PINs, `MAIN` → `STYBL` | **rejected** | An auth-system replacement with a lockout risk, to serve a feature that needed one page. Also required hashing PINs and rate-limiting `/api/auth` to be safe. |
| **Bearer token in an `Authorization` header** instead of the path | **deferred, unverified** | Strictly better hygiene, and `mcp-handler` 2.1.0 already exports `withMcpAuth(handler, verifyToken)` for it. Blocked on an unverified fact: whether Claude Desktop's custom-connector dialog can set an arbitrary header. **Worth five minutes to check before building** — if it can, use a header and the URL stops being a secret at no extra cost. |
| **Microsoft Entra ID OAuth** for MCP (and possibly the dashboard) | **deferred** | The correct end state — real identity, and offboarding in M365 kills access automatically. `mcp-handler` exports `protectedResourceHandler` / `generateProtectedResourceMetadata` (RFC 9728) for exactly this. Costs 1–2 days plus tenant-admin coordination, and Entra does not support dynamic client registration, so Claude Desktop would need a pre-registered client id. **Trigger to revisit: the roster passing ~6 people, or anyone outside the core team.** |

**Chosen:** admin-issued, DB-backed secrets in the URL path. It fixes all three
failures in ~3 hours, and `mcp_tokens` is the table an OAuth migration would
issue into later, so nothing here is throwaway.

### 3.1 The attribution limit, stated once

`mcp_tokens.email` is **a label Kyle types, not proof of identity.** Every token
is minted by whoever holds `ILLUSTRIOUS`, so the record is accurate exactly as
far as Kyle is accurate. That is an acceptable trade at eight internal users. It
is recorded here so nobody later reads this column as cryptographic attribution.

## 4. Data model

One new table. Added to `scripts/db-init.mjs`, which is idempotent
(`create table if not exists`) and is the established migration path.

```sql
create table if not exists mcp_tokens (
  id            bigserial   primary key,
  email         text,                      -- owner; see note below
  label         text,                      -- "Claude Desktop — laptop"
  token_hash    text        not null unique,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz
);
create index if not exists mcp_tokens_hash_idx on mcp_tokens (token_hash);
```

- **`token_hash` is SHA-256 hex of the token; the token itself is never stored.**
  A lost URL is re-minted, never recovered. This is deliberately stricter than
  `dashboard_pins`, which stores PINs in plaintext — that inconsistency is
  pre-existing and out of scope here, but a token granting portfolio-wide
  programmatic read should not be recoverable from the database.
- **`email` is nullable in the schema but required by the API.** Nullable only
  because a future import might not know an owner; every row minted through
  `/connectors` has one.
- **Revoked rows are kept, never deleted**, so "who had access in August" stays
  answerable.

## 5. Auth changes

### 5.1 `lib/mcp/auth.ts`

`mcpSecretOk(candidate: string | undefined): boolean` is replaced by:

```ts
resolveMcpToken(candidate: string | undefined):
  Promise<{ id: number; email: string | null; label: string | null } | null>
```

Returns `null` for unknown, revoked, or malformed input, and for a dead
database. Fail-closed matches the choice `lib/pins.ts` already documents for
login: DB unreachable → nobody gets in, never everybody.

Two things get *simpler*:

- The current `timingSafeEqual`-on-digests dance exists to stop response time
  revealing the secret's length. A lookup keyed on `sha256(candidate)` leaks
  nothing about the preimage, so that concern dissolves and the code shrinks.
- There is **one** code path. No env-var fallback branch, because the legacy
  secret becomes a table row (§7).

`MIN_SECRET_LENGTH` changes purpose rather than surviving unchanged. It exists
today to refuse a too-short *env var* — a fail-closed guard against someone
setting `MCP_SECRET=changeme`. There is no env var any more, so it becomes a
cheap pre-DB rejection: a candidate shorter than 32 characters cannot be one of
our tokens (we mint 32 random bytes as 64 hex characters), so reject it without
a query.

**Cost:** one indexed lookup per MCP request where there was previously zero
I/O — roughly 5–20 ms against Neon. Most tools already query it.

### 5.2 `lib/auth.ts` — the `admin` level

- `Level` union and `ALL_LEVELS` gain `"admin"`.
- `requiredLevel`: `/connectors` → `"admin"`.
- `homeForLevel("admin")` → `/connectors`, so the PIN's purpose is obvious on login.
- `accessiblePages("admin")` → everything `exec` sees, plus a `Connectors` entry.
  `exec` does **not** get that entry.
- `canAccess` gains one clause, and **its position is load-bearing** — it must sit
  *before* the `exec` short-circuit, the same way `/elise` does:

```ts
if (seg === "/elise") return level === "elise";
if (level === "elise") return false;
if (seg === "/connectors") return level === "admin";      // NEW — not even exec
if (level === "exec" || level === "admin") return true;   // admin = exec + /connectors
if (seg === "/rob") return false;
// … unchanged
```

**Rob cannot see `/connectors`.** It is a credential-issuing console; fewer
holders is better, and the CEO has no need to mint tokens. `admin` otherwise
sees everything `exec` does, so Kyle uses one PIN rather than two.

`ILLUSTRIOUS` is one row in `dashboard_pins` (level `admin`). **No existing PIN
changes and nothing is revoked** — `MAIN`, the per-user PINs and the `elise`
vendor PIN all keep working exactly as today.

### 5.3 Middleware

**No matcher change.** `/connectors` and `/api/connectors` are not excluded, so
both are gated by the PIN cookie automatically. The MCP endpoint's exclusion is
`api/mcp/.*`, which requires the slash and therefore does not match
`api/connectors` — verified, and the reason 9m's prefix-looseness finding does
not bite here.

### 5.4 Rate limiting

`allow("mcp", 120, 60_000)` → `allow("mcp:" + id, 120, 60_000)`, keyed on the
resolved token's row id. Four users stop sharing one bucket.

The limiter remains in-memory per serverless instance and therefore
best-effort — keying per token stops users throttling each other and nothing
more. Not claiming otherwise.

## 6. The `/connectors` page

Server component, `admin` only. Two sections.

**Issued tokens** — a table of every row, newest first:

| Owner | Label | Created | Last used | |
|---|---|---|---|---|
| `rb@rise8companies.com` | legacy shared URL — also used by Kate | 08/11/26 | 2 hours ago | Revoke |

- `Last used` renders "never" when `last_used_at` is null — that is the signal a
  token was issued and never installed.
- Revoked rows still render, visibly struck through with their revocation date.
- Revoke is a POST with a confirmation step. Nothing about it is undoable from
  the UI (the row survives, but the URL is dead).

**Issue a new URL** — a form with:

- **Owner email** — a `<select>` of the eight known addresses plus `Other`, which
  reveals a free-text input. Same idiom as `IntakeForm`'s `TEAMS` constant. A
  dropdown rather than free text because a typo silently corrupts the one thing
  this column exists for. The list lives in `config/mcp-users.ts`, following the
  `config/properties.ts` / `config/catalog-sample.ts` precedent.
- **Label** — free text, optional, e.g. "Claude Desktop — laptop".

On submit the full URL is shown **once**, with a copy button, and a warning that
it cannot be retrieved again.

### 6.1 The URL must use the custom domain

The minted URL is built from a **hardcoded** `https://dashboard.rentstayable.com`,
never from the request host.

Vercel Authentication on this project is `all_except_custom_domains`. A
host-derived URL minted while on a preview deployment would produce a
`*.vercel.app` address that returns an SSO login page — which looks exactly like
a broken connector, and is the failure that consumed time in sessions 9n and 9o.

### 6.2 Warnings rendered on the page

Both have already caused real confusion, so they belong beside the button, not
in a doc:

- **This URL is the credential.** Anyone holding it has full read access. Do not
  paste it into Teams or a group chat.
- **MCP carries no guest PII, deliberately.** The `/bea` §3 balance-due exception
  does not extend to MCP — a secret URL in a settings pane is a weaker gate than
  the PIN, so it carries the less sensitive data. Ask the connector who owes
  rent and it returns nothing. **Bea must be told this before she connects**, or
  it reads as broken.

### 6.3 Cap

Maximum 20 live tokens. Not a security control — a guard against the table
quietly accumulating dead entries that make the page useless.

## 7. The legacy shared secret

`scripts/seed-mcp-legacy.mjs` inserts the current `MCP_SECRET` as an ordinary
row:

- `email` = `rb@rise8companies.com`
- `label` = `legacy shared URL — also used by Kate`
- `token_hash` = SHA-256 of the value in `.secrets/mcp-secret.txt` (present
  locally, 64 chars, gitignored)

Kate shares this URL with Rob today. Recording it as Rob's with the sharing in
the label keeps the page honest — the alternative, a null owner, loses the fact
that it is Rob's original connector.

**Why a row rather than an env-var fallback**, which was the earlier plan:

1. `resolveMcpToken` has one code path, with no branch to get wrong.
2. `last_used_at` tracking works for free, so we can *see* when the old URL stops
   being used instead of guessing.
3. Per-token rate limiting keys on its row id automatically — no sentinel case.
4. Retirement is a Revoke click, not a Vercel edit and a redeploy, and it is
   instantly reversible if someone turns out to still be on it.

`MCP_SECRET` is deleted from Vercel once the row is seeded, since nothing reads
it any more.

### 7.1 Retirement — a dated trigger, not a someday

While the shared row lives, revocation is still all-or-nothing for whoever holds
it, and that URL has already travelled through Teams. So:

1. Mint a token for `rb@rise8companies.com` and one for `kate@rentstayable.com`.
2. Send each of them their own URL, and tell them to replace the old connector.
3. When the page shows both new tokens in use **and no legacy use for 7
   consecutive days**, revoke the legacy row.

This goes into `TODO.md` as a dated item. It will not happen otherwise.

## 8. API routes

Both are ordinary gated routes, reading the level from the signed cookie via
`verifyCookie` and rejecting anything but `admin` **server-side** — the page's
rendering choice is presentation, not the gate.

- `POST /api/connectors` — mint. Body `{ email, label? }`. Validates email shape,
  caps lengths, generates 32 random bytes, stores the hash, returns
  `{ url }` **once**. The raw token is never logged.
- `POST /api/connectors/[id]/revoke` — sets `revoked_at = now()`. Idempotent:
  revoking an already-revoked row succeeds without changing the timestamp.

Deliberately **not** following `/api/change-pin`'s precedent of excluding itself
from the matcher and self-checking. Staying inside the gate means no matcher
edit and no chance of a prefix mistake.

## 9. Where the code lives

- `lib/mcp/tokens.ts` — **new.** Neon queries for mint / list / revoke /
  resolve-by-hash, and the `last_used_at` touch.
  A deviation from the convention that Neon queries live in `lib/db.ts`, taken
  on purpose: `lib/db.ts` is already large, and keeping the MCP token queries
  beside the rest of `lib/mcp/` gives one module one clear purpose.
- `lib/mcp/auth.ts` — `mcpSecretOk` → `resolveMcpToken`.
- `app/api/mcp/[secret]/route.ts` — call `resolveMcpToken`, key the rate limiter
  by id, keep the 404-not-401 behaviour.
- `lib/auth.ts` — the `admin` level (§5.2).
- `app/connectors/page.tsx`, `components/ConnectorList.tsx`,
  `components/IssueConnector.tsx`.
- `app/api/connectors/route.ts`, `app/api/connectors/[id]/revoke/route.ts`.
- `config/mcp-users.ts` — the eight known emails.
- `scripts/db-init.mjs` — the DDL. `scripts/seed-mcp-legacy.mjs` — the legacy row.

### 9.1 `last_used_at` writes

Throttled to at most once per 5 minutes per token, so a busy session is not one
write per tool call. Consequence, accepted: "last used" is accurate to within
five minutes, which is far finer than any decision made from it.

## 10. Testing

Behaviour, not implementation. Following the repo's existing vitest setup.

**`resolveMcpToken`**
- unknown hash → null
- revoked row → null
- live row → `{ id, email, label }`
- DB throws → null (fail closed), and the error is not surfaced to the caller
- the legacy seeded row resolves, and stops resolving once revoked

**`canAccess` / `accessiblePages`** — the position of the new clause is the thing
most likely to be broken by a later edit, so each direction is pinned:
- `admin` → `/connectors` **true**
- `exec` → `/connectors` **false** ← the one that catches a re-ordered clause
- `base`, `bea`, `elise` → `/connectors` **false**
- `admin` → `/rob`, `/bea`, `/` **true**
- `admin` → `/elise` **false**
- `accessiblePages("admin")` includes Connectors; `accessiblePages("exec")` does not

**Mint**
- non-`admin` cookie → rejected, and no row is written
- missing or malformed email → 400
- token is 64 hex characters
- the stored value is the **hash**, not the token
- the returned URL uses `dashboard.rentstayable.com` **even when the request
  host is a `*.vercel.app` address** — a direct regression test on the 9n/9o failure
- the raw token appears in no log line

**Revoke**
- non-`admin` cookie → rejected, and the row is left untouched
- after revoke, `resolveMcpToken` returns null for that token
- revoking twice is a no-op, not an error

**Rate limiting**
- token A exhausting its bucket does **not** 429 token B

**`last_used_at`**
- first call writes; a second call within the window does not

## 11. Out of scope

- **Bearer-token-in-header and Entra OAuth** — §3, with triggers.
- **Self-serve minting.** Kyle is in the loop for every issuance, by choice.
- **Per-tool scoping.** `withMcpAuth` supports `requiredScopes`, so
  "Gerardo gets occupancy, not everything" is later a column rather than a
  rewrite. Not built; the door is open.
- **Rate-limiting `/api/auth`.** It has no `allow()` call today, unlike
  `/api/submit`'s 5/min. Pre-existing, and unchanged by this work since no
  existing PIN is being touched. It matters slightly more once `ILLUSTRIOUS`
  exists, because that PIN can mint API credentials. A few lines, separable,
  Kyle's call.
- **Hashing `dashboard_pins`.** Pre-existing plaintext storage; not touched here.
- **Automatic offboarding.** Revocation is manual. Entra is what would fix it.
- **`/personal-view`** — a separate spec, unrelated table and purpose.

## 12. Open items

1. **Five-minute check before building:** can Claude Desktop's custom-connector
   dialog set an `Authorization` header? If yes, prefer a header over the path
   for the same effort and strictly better hygiene (§3).
2. **Tell Bea the MCP carries no guest PII** before she connects (§6.2).
3. **Preview does not isolate the database.** `DATABASE_URL` points at the same
   Neon instance from local, preview and production (established in 9p). Seeding
   or revoking "in preview" writes to production. Code can be rehearsed in
   preview; data changes cannot. Additionally, MCP cannot be tested end-to-end
   from Claude Desktop against a preview URL, because Vercel Auth returns an SSO
   page before the route runs — that only proves out on the custom domain.
