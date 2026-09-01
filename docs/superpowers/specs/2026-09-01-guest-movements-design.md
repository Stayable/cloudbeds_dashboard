# Arrivals & Departures with Guest Information — Design

Date: 2026-09-01 (Eastern) · Status: approach approved, pre-implementation

## 1. What this is

A per-guest arrivals & departures report covering all 8 Stayable properties, rendered as a
new section 5 on the Main Dashboard (`/`), plus a widening of the guest-PII posture from
one surface (`/bea` §3) to all internal staff levels.

Two things are being built. They are separable and the second is the load-bearing one:

1. **The report** — a new `lib/guest-movements.ts` reader and a `components/GuestMovements.tsx`
   view, mounted on `/`.
2. **The posture change** — `lib/guest-pii.ts`, a single definition of which levels may see
   guest names, replacing prose in `CLAUDE.md` §5 rule 2.

## 2. Decisions taken (Kyle, 2026-09-01)

| Decision | Answer |
|---|---|
| PII scope | **Staff levels only**: `base`, `exec`, `admin`, `crystal`, `monica`, `bea`, `ops` |
| Excluded | `/elise` (external vendor) and `/report` + its unauthenticated file-token links |
| Columns | Guest name, room, check-in, checkout, nights, guest count |
| Not included | Balance due, booking source, phone, email |
| Date scope | Today + tomorrow toggle |

## 3. Why the exclusions are load-bearing

**`/elise` is an external vendor.** `lib/auth.ts` puts `elise` in `RESTRICTED_LEVELS` for
"external/vendor access (e.g. EliseAI support)". Guest names there would disclose Stayable
guest data to a third party. `canViewGuestPii("elise")` must be false, and there is a test
asserting it.

**`/report` files are reachable with no PIN at all.** `signFileToken` mints unauthenticated
30-day links so the daily Teams card works without handing the MAIN pin to the Revenue chat.
Its own comment states this is acceptable *because* "the report is aggregate-only and carries
no guest PII... the risk being managed is business confidentiality, not privacy." Guest data
on `/report` would silently convert every already-posted card into a PII link. `/report` stays
aggregate-only.

**The MCP surface is out of scope and its guard stays.** `lib/mcp/server.test.ts` enforces
`assertNoGuestPii` over every MCP tool schema, throwing on `guestName`, `email`, `phone`,
`reservationId`, `folioNumber`, `occupantName`, `tenantId`. MCP tools are consumed by external
clients over per-person tokens; that is a different trust boundary from a PIN-gated dashboard.
No MCP tool exposes movements. The guard is not relaxed.

**Teams is out of scope.** `lib/due-outs.ts` is "PII-FREE BY CONSTRUCTION" because it posts to
a Teams channel, which its header calls "a weaker gate than the PIN". Nothing in this design
imports from or writes to that file.

## 4. Architecture

```
app/page.tsx  (server, force-dynamic)
   │  cookies() → verifyCookie → Level
   │  canViewGuestPii(level)  ← lib/guest-pii.ts, ONE definition
   ▼
getPortfolioMovements(days, { includeGuests })   ← lib/guest-movements.ts
   │  8 properties × 2 directions × 3 group-queries = 48 DI reads, cached 600s
   │  includeGuests:false ⇒ the name query is NOT ISSUED (2 reads, not 3)
   ▼
<GuestMovements properties={...} showGuests={...} />   ← client, tabs + export
```

### 4.1 Server-side stripping is mandatory, not cosmetic

Props handed to a client component are serialized into the RSC payload and are readable in the
browser. A `showGuests` flag that only hides a column would still ship every guest name to
every viewer. Therefore `includeGuests: false` **skips the name query entirely** and leaves
`guest` as `""`. The flag controls fetching, not rendering. There is a test asserting no row
carries a name when the flag is false.

### 4.2 The Data Insights reads

Dataset 3, `POST {DI_BASE}/reports/query/data?mode=Run`, per the shape proven in
`lib/balance-due.ts` and `lib/due-outs.ts`.

Measured constraints, not assumptions:
- **`group_rows` caps at three columns** — a fourth returns 400 (`due-outs.ts:91`,
  `balance-due.ts:85`).
- **A measure column is mandatory** even for a dimension-only list.
  `reservation_balance_due_amount` is used because it is proven to exist on dataset 3; its
  value is discarded. Asking for `reservation_id` as a measure 400s — it is a dimension.
- **`equals` on `checkout_date` is verified against all 8 live properties** (08/14/26).

Seven dimensions are needed, so three queries joined on `reservation_number`:

| Query | Group columns |
|---|---|
| G1 *(skipped when `includeGuests` is false)* | `reservation_number`, `primary_guest_full_name`, `guest_count` |
| G2 | `reservation_number`, `checkin_date`, `checkout_date` |
| G3 | `reservation_number`, `room_numbers`, `reservation_status` |

**The grouping is chosen so G1 is cleanly droppable.** `room_numbers` deliberately sits in G3,
not alongside the name: if rooms shared a query with the guest name, then skipping that query
for a non-permitted level would also destroy the room column and leave the fallback view with
nothing but dates. As grouped, dropping G1 costs the name and the guest count and nothing else
— the fallback is still a usable room-level movements list, which is exactly the shape
`lib/due-outs.ts` already proves is useful on its own.

**Nights is derived**, not fetched — `checkout - checkin`. §6 of CLAUDE.md: Cloudbeds supplies
primitives, we own every derivation.

A **date range** filter spanning today..tomorrow is used rather than two `equals` queries, and
rows are split by date in our code. This costs one group-column slot but halves the request
count: 48 reads for both days instead of 96.

Arrivals filter on `checkin_date`; departures on `checkout_date`. The two directions stay
separate queries — a guest arriving today and departing tomorrow must appear on both lists.

### 4.3 The status filter is deliberately absent

`lib/due-outs.ts` filters `reservation_status = In-House` and its header records why that makes
it time-sensitive: probed 08/14/26, Davenport had 4 due-outs that evening and every one read
`Checked Out`, so the In-House list was **zero**. "A late run does not report a quiet day, it
reports nothing at all."

A walk list wants that. A *report* must not have it. This reader filters on **date only** and
carries `reservation_status` as a displayed column, so:
- the list is stable from 00:00 to 23:59;
- you can see who has actually arrived vs. who is still expected;
- departures already gone are visible rather than vanished.

This is the opposite choice from the walk list, made for the opposite reason. Do not
"harmonise" them.

### 4.4 Row state

`state` is derived from `reservation_status` so the UI is not re-deriving meaning per call site:

| Direction | `reservation_status` | `state` |
|---|---|---|
| arrivals | `Confirmed` / `Not Confirmed` | `expected` |
| arrivals | `In-House` | `arrived` |
| arrivals | `Checked Out` | `arrived` (same-day in-and-out) |
| departures | `In-House` | `due-out` |
| departures | `Checked Out` | `departed` |
| either | `Cancelled` / `No Show` | `cancelled` |
| either | anything else | `other` (status shown verbatim) |

Cancelled rows are **kept and marked**, not dropped — a cancellation on today's arrival list is
information the front desk wants.

## 5. Files

**New**
- `lib/guest-pii.ts` — `canViewGuestPii(level)`, allowlist-based.
- `lib/guest-pii.test.ts`
- `lib/guest-movements.ts` — reader + pure fold/join/split/derive helpers.
- `lib/guest-movements.test.ts`
- `components/GuestMovements.tsx` — client view.

**Changed**
- `app/page.tsx` — read level, add NAV item 5, mount the section, amend the footer line.
- `CLAUDE.md` — §5 rule 2 and §6 scope rule rewritten (see §7 below).

**Explicitly untouched**
- `lib/due-outs.ts`, `lib/teams.ts`, `lib/balance-due.ts`, `lib/mcp/*`, `app/report/*`.

## 6. The allowlist fails closed

`canViewGuestPii` is an **allowlist**, not a denylist. A level added to `ALL_LEVELS` in future
is denied guest PII until someone adds it deliberately. A test iterates `ALL_LEVELS` so a new
level forces the decision rather than inheriting access. `null` (unauthenticated, or any
token-only path) returns false.

## 7. CLAUDE.md amendment

§5 rule 2 currently says the `/bea` exception "does **not** generalise. Any other surface
wanting guest names is a fresh decision." This design *is* that fresh decision, so the rule
must be rewritten rather than quietly contradicted. New wording:

> **No guest PII on any ungated page — ever.** Guest names are visible to **internal staff
> levels only** (`base`, `exec`, `admin`, `crystal`, `monica`, `bea`, `ops`), enforced in one
> place: `lib/guest-pii.ts`. Aggregate-only everywhere else, specifically: `/elise` (external
> vendor), `/report` and its unauthenticated file-token links, every MCP tool, and anything
> posted to Teams. The enforcement is an allowlist that fails closed.

The `/bea` §3 exception text stays as history, marked superseded.

The Home footer line "Aggregated metrics only · no guest PII" becomes false for permitted
levels and is made conditional.

## 8. Testing

Pure functions carry the tests; the network shape is the only input, per the existing
`foldDueOutRooms` pattern.

- `canViewGuestPii`: each staff level true; `elise` false; `null` false; unknown level false;
  `ALL_LEVELS` iteration forces a decision on any future level.
- `joinMovementRows`: joins three query results on `reservation_number`; a reservation missing
  from G2 or G3 still yields a row with blanks rather than being dropped; a reservation holding
  multiple rooms keeps them comma-joined; duplicate rows de-duplicate on `reservation_number`.
- `nightsBetween`: normal stay; same-day (0); missing date → null.
- `movementState`: the whole table in §4.4, both directions.
- `splitByDate`: a two-day range splits correctly; a row outside the range is dropped.
- **PII regression**: `includeGuests: false` ⇒ every row's `guest` is `""` and G1 is never
  issued. This is the test that matters most — it is the one that would catch a leak.
- Failed reads bank `null`, never `[]` — the `foldDueOutRooms` lesson: zero movements is a
  plausible Tuesday and a failed read stored as empty is indistinguishable from one.

## 9. Out of scope

- Mounting the section on `/ops`, `/crystal`, `/monica`, `/rob`. The component is written to be
  mountable there, but this change ships it on `/` only. Kyle chose "staff levels only" for the
  *policy*; rolling the section onto each dashboard is follow-on work.
- Phone / email / ETA columns — not confirmed to exist on dataset 3; would need a probe.
- Extracting a shared `lib/di-reservations.ts` primitive (approach B). Three files now duplicate
  the dataset-3 query builder. Correct to fix, wrong to fix while shipping a feature through a
  working collections surface. Its own session.
