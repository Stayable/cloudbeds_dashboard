# Stayable MCP server — design

**Date:** 2026-08-11 (ET) · **Status:** awaiting Kyle's review · **Scope:** v1, read-only

---

## 1. What this is

A **remote MCP server** hosted inside the existing dashboard app, so Rob (CEO) can
ask Claude Desktop about Stayable's operating numbers, pull the revenue report,
and reach the Smartsheet and EliseAI data his `/rob` dashboard already shows.

He adds it once through Claude Desktop's **Add custom connector** dialog: a name
and an HTTPS URL. Nothing is installed on his machine, no repo is cloned, and no
production credential ever leaves Vercel.

**v1 is read-only.** No tool writes to Cloudbeds (CLAUDE.md §5 rule 3), to
Smartsheet, or to Neon.

---

## 2. Why it lives in the dashboard app, not beside it

The tools call `lib/*` directly — `buildRevenueReport`, `getOccupancyRollup`,
`buildEvictionsViews`, and the rest. That is the whole point of the placement:

**Rob's answers are computed by the same code as the dashboard.** A separate
service re-implementing "occupancy" would drift from `/report` the first time a
derivation changed, and the two would disagree with no way to tell which was
right. The rule from CLAUDE.md §6 — *Cloudbeds supplies primitives, we own every
derivation* — only holds if there is exactly one derivation.

The cost is that the MCP surface is coupled to the app's deploy cycle. That is
the correct trade here: a stale MCP server is worse than a coupled one.

---

## 3. Access: a secret in the URL

```
https://dashboard.rentstayable.com/api/mcp/<MCP_SECRET>
```

The URL **is** the credential. `MCP_SECRET` is a 64-character random string in a
Vercel env var, compared in the route with the same constant-time comparison
`verifyFileToken` already uses (`lib/auth.ts`).

**Kyle chose this over full OAuth 2.1 on 08/11/26**, after the OAuth cost was
put in front of him: a real authorization server means discovery endpoints,
PKCE, token and refresh handling, and a large amount of security-critical code
we would own forever. For one executive reading aggregate, PII-free figures,
that is not proportionate.

**The honest downsides, recorded rather than glossed:**

- **Anyone holding the URL has full read access.** A screenshare of Rob's
  connector settings leaks it. There is no per-user identity and no per-user
  revocation — rotation is all-or-nothing.
- **It is outside the MCP authorization spec, deliberately.** That spec forbids
  putting *OAuth bearer tokens* in a URI. A secret path segment is not an OAuth
  token; it is a capability URL, and we are opting out of the auth flow rather
  than violating it. The distinction stops mattering the moment this becomes
  multi-user — **if a second person ever needs a connector, revisit this
  decision rather than sharing Rob's URL.**
- Rotation: change `MCP_SECRET`, redeploy, send Rob a new URL. Seconds, but it
  is a manual step and the old URL dies without warning to him.

**Why it is nonetheless acceptable here:** the exposed data is aggregate and
carries no guest PII (§6), the transport is HTTPS so the path is not visible to
the network, and the blast radius of a leak is business-confidential figures —
serious, but bounded and revocable.

### Middleware and platform

- `api/mcp` is added to the `matcher` exclusion in `middleware.ts`. It
  self-checks its own secret inline — the identical pattern `/api/report-file`
  already uses so the Teams card can fetch the report without the MAIN pin.
- **Vercel Deployment Protection must not sit in front of this path**, or Claude
  Desktop receives a bot-check page instead of an MCP response and the failure
  looks like a broken connector. Verify on the deployment.
- Rate-limited via the existing `allow()` in `lib/ratelimit.ts`.

---

## 4. Transport: `mcp-handler`, stateless

**Decision: `mcp-handler` 2.1.0** (Vercel's framework-agnostic HTTP adapter,
which wraps `@modelcontextprotocol/sdk` 1.30.0).

The alternatives were driving the SDK directly — more protocol code we own, for
no capability we need — or hand-rolling JSON-RPC framing. The second is the one
worth naming: this repo has just spent a review round on exactly that lesson
with markdown parsing, and a wire protocol is a worse thing to hand-roll than a
document format, because the failure mode is a client that silently stops
working rather than a visible rendering bug.

**Stateless mode specifically.** `mcp-handler`'s stateful SSE mode wants Redis to
hold session state between requests. Every tool here answers from a single
request with no continuation, so stateless costs nothing and avoids adding a
datastore. This also suits Fluid Compute, where instances are reused rather than
pinned to a session.

Verify `mcp-handler`'s current API against its README at build time rather than
from memory — it is a young package and its adapter signature has moved.

---

## 5. Tools

All read-only. All aggregate. Names use the `snake_case` convention MCP tools
conventionally use.

| Tool | Arguments | Returns |
|---|---|---|
| `list_properties` | — | The 8 properties: business name, Cloudbeds property ID, code, county, active flag |
| `get_occupancy` | `properties?`, `from`, `to`, `granularity: daily\|weekly\|monthly` | Per property and portfolio: occupancy %, rooms sold / available / out-of-order, ADR, RevPAR, room revenue |
| `get_portfolio_summary` | `asOf?` | MTD and YTD across all 8, the "how are we doing" question in one call |
| `get_daily_report` | `asOf?` | The revenue report as structured data (`buildRevenueReport`) |
| `get_report_file` | `asOf?`, `format: pdf\|xlsx` | The report as a file, so Rob can ask questions of the actual document |
| `get_today` | `properties?` | Live from Cloudbeds: arrivals, departures, in-house, stayovers, out-of-order — **counts only** |
| `get_evictions` | `from?`, `to?` | Open / closed / total / average days-to-file, from Smartsheet |
| `get_contractor_schedule` | — | This week's contractor schedule (the sheet holds only the current week) |
| `get_reviews` | `from?`, `to?` | 1-star review counts and response rate per property |
| `get_leasing_funnel` | `from?`, `to?` | EliseAI funnel stages and pipeline |

`list_properties` exists for grounding: without it the model has to guess that
"Lakeland" means 4645, and a wrong property ID produces a confident wrong answer
rather than an error.

### Property naming

Tools accept a property by business name, code, or Cloudbeds ID, resolved
through `config/properties.ts` (`getProperty`, `propertyIdByCode`). An
unrecognised name is an **error naming the valid options**, never a silent
fallback to the portfolio — "occupancy at Lakeside" must not quietly answer for
all eight.

---

## 6. Guest PII: none, and this does not reopen the `/bea` exception

**No tool returns a guest name, email, phone, or reservation-level detail.**
CLAUDE.md §5 rule 2 stands unchanged.

`/bea` §3 — guest name against outstanding balance — is the app's single
guest-PII surface, authorised by Kyle on 08/04/26 and scoped explicitly to that
one PIN-gated table. **Kyle confirmed on 08/11/26 that it does not extend here.**
The reasoning is worth keeping: a secret URL sitting in a desktop application's
settings pane is a weaker gate than the PIN, so the surface with the weaker gate
must carry the less sensitive data. If Rob needs to know who owes rent, he opens
`/bea`.

A test asserts that no tool's output schema contains a name-shaped field.

---

## 7. Freshness is part of every answer

**This is the most important property in the design.** Every tool that reads
banked or synced data returns its own freshness alongside the numbers:

- snapshot-backed tools return `finalThrough` and the latest captured date
  (`getFinalThrough`, `getSnapshotFreshness`)
- `get_leasing_funnel` returns EliseAI's last successful sync and, when the sync
  is failing, the same wording `/ops` renders (`lib/elise-status.ts`)
- `get_today` is live, and says so

Without this the model will state a two-day-old figure as today's, with total
confidence and no hedge — which is worse than the dashboard doing it, because
there is no visible page around the number to carry a caveat. The freshness
field is what lets the model say "as of Saturday" instead of "currently".

**A tool that cannot reach its source says so; it never returns zeros.** The
Cloudbeds 429-zeros incident (TODO.md) is the precedent: zeros are
indistinguishable from real data and propagate silently.

---

## 8. Errors

Tool errors are returned as MCP tool errors with a plain sentence a
non-engineer can act on — "EliseAI's credential is failing, so leasing data
stops at 08/06" rather than a stack trace or a raw HTTP status. Rob is the
reader; an error he cannot interpret is an error he will forward to Kyle.

Never surface a credential, a connection string, or an internal path in an error
message — the reply goes to a third-party desktop client.

---

## 9. Testing

Matching the repo's existing shape: pure functions, vitest, no browser.

- **Argument handling** — property resolution by name / code / ID; an unknown
  property errors and names the valid options; date-range defaults and an
  inverted range (`from` after `to`).
- **Freshness annotation** — every snapshot-backed tool includes it; a test that
  fails if a new tool is added without one.
- **No-PII assertion** — over every tool's declared output schema.
- **Secret check** — a wrong secret 404s (not 401: a 404 does not confirm the
  endpoint exists); a correct one passes. Constant-time comparison.
- **Error shape** — a failing data source produces a stated error, not zeros.

The protocol layer itself is `mcp-handler`'s responsibility and is not re-tested
here. What IS tested is that our handler is wired to it correctly, via one
end-to-end call through the route.

---

## 10. Deliberately out of scope for v1

- **Writes of any kind.** No Cloudbeds writes (CLAUDE.md §5 rule 3), no
  Smartsheet rows, no notes. If Rob wants to file an action item from Claude
  Desktop, that is a separate decision — and note the standing rule that nothing
  is written to the Action Items Staging Sheet unless asked in the moment.
- **Multi-user access.** One secret, one connector, one person. A second user is
  the trigger to revisit §3, not to forward the URL.
- **OAuth 2.1.** Costed and declined on 08/11/26; the requirements research is
  recorded should it be revisited.
- **MCP resources and prompts.** Tools only. Resources would let Rob browse
  documents rather than query them, which is what `/kb` is being built for.
- **Anything the dashboard does not already compute.** This exposes existing
  derivations; it does not add new ones.

---

## 11. Modules

| File | Purpose | Depends on |
|---|---|---|
| `app/api/mcp/[secret]/route.ts` | the endpoint: secret check, rate limit, hand off to the handler | `mcp-handler`, `lib/auth`, `lib/ratelimit` |
| `lib/mcp/server.ts` | builds the MCP server and registers the tools | the tool modules |
| `lib/mcp/tools-occupancy.ts` | `list_properties`, `get_occupancy`, `get_portfolio_summary` | `lib/db`, `config/properties` |
| `lib/mcp/tools-report.ts` | `get_daily_report`, `get_report_file` | `lib/cloudbeds`, `lib/report-pdf`, `lib/report-xlsx` |
| `lib/mcp/tools-live.ts` | `get_today` | `lib/cloudbeds` |
| `lib/mcp/tools-ops.ts` | `get_evictions`, `get_contractor_schedule`, `get_reviews`, `get_leasing_funnel` | `lib/evictions`, `lib/contractor-schedule`, `lib/reviews`, `lib/leasing`, `lib/elise-status` |
| `lib/mcp/freshness.ts` | one definition of the freshness envelope every tool attaches | `lib/db` |
| `lib/mcp/properties.ts` | resolve a user-supplied property string to a property | `config/properties` |

Split by data source rather than by layer, so the file that changes when the
revenue report changes is one file. `freshness.ts` and `properties.ts` exist
because both rules must have exactly one definition — the repo has already been
bitten by a meaning with two implementations.

---

## 12. Ship criteria

1. `npx tsc --noEmit` clean; full suite green including the new tests.
2. On the deployment: the URL with a **wrong** secret 404s; the correct URL
   completes an MCP initialize handshake.
3. Deployment Protection confirmed not blocking the path.
4. Rob adds the connector in Claude Desktop and the tools appear.
5. A real question answered end to end — "what was Lakeland's occupancy last
   week" — and the number **matches `/report` exactly**. If it does not, the
   coupling argument in §2 has failed and that is a release blocker, not a
   rounding note.
6. A question about a property whose data is stale returns the figure **with its
   freshness**, and the model's answer reflects it.

---

## 13. Delivery to Kyle

The build is not finished when it deploys. It is finished when Kyle has the two
values the **Add custom connector** dialog asks for:

- **Name:** `Stayable` — what Rob sees in his connectors list.
- **Remote MCP server URL:** `https://dashboard.rentstayable.com/api/mcp/<MCP_SECRET>`

Both go to Kyle in chat, and **the URL goes onto his clipboard** — it is ~90
characters of random string, exactly the kind of value his standing preference
says never to make him select out of a terminal. Also save it to a one-line file
as a backup.

Leave the OAuth Client ID and Client Secret fields **empty**; this server does
not implement OAuth (§3). Nothing under Advanced settings needs touching.

Two cautions to pass on with the URL:

- **It is a password.** Anyone with it has read access to the portfolio's
  numbers. Send it the way a credential is sent, not pasted into a group chat.
- **It rotates on `MCP_SECRET` change**, and Rob's connector stops working the
  moment it does, with no warning to him. If it is ever rotated, he needs the
  new URL in the same message.
