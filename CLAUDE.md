# CLAUDE.md — Cloudbeds Dashboard

Guidance for Claude Code working in this repository. Read this first.

---

## 1. What this is

A **public, view-only dashboard** that surfaces Cloudbeds operating data for the
Stayable portfolio. Primary view is **occupancy**, with supporting status
metrics (see §6). Deploys to **Vercel**. No login — purely for viewing.

- Owner: RISE8 Companies / Stayable (Stayable Fund I — SFI).
- Pilot property: **Davenport (44199)**.
- Target URL: `dashboard.rentstayable.com` (recommended subdomain) or
  `rentstayable.com/dashboard` (path via proxy). Decide before DNS step.

**Current stage:** Phase 0 complete — access posture (PIN gate), auth (API key),
and the read-only Cloudbeds key are all decided/created. **Next: Phase 2 app
skeleton** (Next.js + server-side Cloudbeds client), Davenport (44199) pilot
first. See `TODO.md` for the live checklist.

---

## 2. Company context

RISE8 Companies is a vertically integrated real estate investment and operations
firm (Boca Raton, FL) that owns and operates the **Stayable** extended-stay hotel
brand — 8 Florida properties, 6 currently active in Cloudbeds.

All work product reflects this institutional context. Be direct, dense, no
fluff. Never fabricate figures, dates, or approvals — if a number is unverified,
mark it unverified.

---

## 3. Properties (reference IDs on every property-specific output)

| Property            | Cloudbeds Property ID | County     | Active in Cloudbeds |
|---------------------|-----------------------|------------|---------------------|
| Lakeland            | 4645                  | Polk       | yes                 |
| Kissimmee East      | 2295                  | Osceola    | yes                 |
| Kissimmee West      | 5399                  | Osceola    | yes                 |
| Jacksonville West   | 6802                  | Duval      | yes                 |
| Jacksonville North  | 812                   | Duval      | yes                 |
| St. Augustine       | 2535                  | St. Johns  | yes                 |
| Davenport           | 44199                 | Polk       | **pilot**           |
| Orlando OBT         | 8700                  | Orange     | yes                 |

> **All 8 properties are active in Cloudbeds** (confirmed by Kyle 06/30/26).
> Davenport (44199) was the pilot. Per-property keys still outstanding for KE, KW,
> JW, JN, SA, OR (only DP + LL reporting) — see TODO.

The canonical list lives in code at `config/properties.ts` once built. Keep this
table and that file in sync.

---

## 4. Tech stack

- **Next.js** (App Router) — Vercel-native, supports server-side data fetching.
- **Vercel** for hosting + env-var secret management + (optional) password
  protection.
- **Cloudbeds API** (OAuth 2.0 / API key) — called **server-side only**.
- TypeScript. Keep dependencies minimal.

---

## 5. Architecture & security (non-negotiable)

```
Browser (public, no auth)
   │  requests aggregated metrics only
   ▼
Next.js server (API routes / server components)
   │  holds Cloudbeds credentials in Vercel env vars (server-side)
   ▼
Cloudbeds API
```

**Hard rules:**
1. **Credentials never reach the browser.** Cloudbeds API key / OAuth tokens
   live in Vercel environment variables and are used only in server code. No
   `NEXT_PUBLIC_` prefix on any secret.
2. **No guest PII on any ungated page — ever.** Expose aggregated metrics only
   (occupancy %, room counts, ADR/RevPAR, arrivals/departures *counts*). No
   guest names, no reservation-level detail.
   - **SCOPED EXCEPTION — `/bea` §3 "Balance due" (authorised by Kyle 08/04/26).**
     That one table shows **guest name + room + outstanding balance** for
     in-house reservations, because chasing rent arrears is not possible without
     naming the person who owes it. It is the **only** guest-PII surface in the
     app. Conditions, all load-bearing:
     - `/bea` stays PIN-gated (`BEA_PIN` or exec/CEO). Never relax that.
     - The exception does **not** generalise. Any other surface wanting guest
       names is a fresh decision, not covered by this one.
     - **Consequence:** the standing "re-issue all 8 Cloudbeds keys without Guest
       scope" security task **can no longer drop the Guest / Data Insights Guests
       scopes.** Least privilege now stops one step short of where §6 aimed it.
       That is a real, accepted reduction in the technical guardrail — the rule is
       now enforced by code and the PIN gate rather than by the key.
     - Implementation + the measurement behind the missing due-date column:
       `lib/balance-due.ts`.
3. **Read-only.** This app never writes to Cloudbeds.
4. Cache API responses server-side (short TTL, e.g. 5–15 min) to stay within
   Cloudbeds rate limits and keep the page fast.
5. **PIN gate** (decided): no full login, but access is gated by a PIN stored in
   a Vercel env var. **Role-based:** `DASHBOARD_PIN` unlocks base `/`; `EXEC_PIN`
   (`STYBLCEO`) unlocks base `/` AND `/exec`. A server-side check sets an httpOnly
   cookie. `/test` is excluded from the gate (public intake form).
6. **Database (scoped reversal of the original "no DB").** Cloudbeds data itself
   is still **read-and-cache only** — never persisted, no DB on the read path.
   A single **Neon Postgres** `submissions` table (server-only, via `DATABASE_URL`)
   now backs two public/exec **write** surfaces: `/api/submit` (the `/test`
   team-intake form) and `/api/feedback` (the exec feedback box), distinguished by
   a `source` column (`team-intake` | `exec-feedback`). **No guest PII** is stored
   — the table holds only submitter-entered name/role/team/notes + selected
   catalog metric names. Cloudbeds remains untouched by this table.

---

## 6. Cloudbeds data — what we show

### Occupancy cadence (answer to "what's possible")
- **Daily** — native. Per-day occupancy from the dashboard/reservations
  endpoints. This is the core view.
- **Weekly** — computed by aggregating daily occupancy over a 7-day range.
- **Monthly** — computed by aggregating daily occupancy over the month (and
  month-to-date).

All three are feasible; weekly/monthly are roll-ups of daily data over a date
range, not separate API calls.

### Metrics to surface (current status of the portfolio)
- **Occupancy %** (per property + portfolio total), daily/weekly/monthly toggle.
- **Rooms**: sold / available / out-of-order, total inventory.
- **ADR** (Average Daily Rate) and **RevPAR** (Revenue per Available Room).
- **Today's activity**: arrivals, departures, in-house, stayovers (counts only).
- **Revenue** (period total).
- **Pace / pickup** if exposed by the API (bookings on the books vs. prior
  period) — nice-to-have, confirm availability.

### API notes
- **Auth: API key (scoped key set)** — chosen over OAuth. No redirect URI, no
  token rotation, no extra storage. Server-to-server, ideal for a BI dashboard.
  (OAuth's redirect-URI flow was the alternative; not used.)
- **Scope rule: Read-only. Aggregate-only everywhere except `/bea` §3.** Least
  privilege still applies to Write/Delete and to every scope below — but as of
  **08/04/26** the guest read scope is **retained deliberately**, because `/bea`
  §3 names guests against their outstanding balance (§5 rule 2, scoped
  exception). The guardrail behind §5 rule 2 is therefore now **code + the PIN
  gate**, not the key. Treat "no guest scopes" as historical wherever it appears
  below or in `TODO.md`.

  **Scopes to enable (Read only):**
  - Data Insights Occupancy — occupancy %, ADR, RevPAR, rooms sold/available
  - Dashboard — today's arrivals / departures / in-house / stayovers
  - Hotel — property name, inventory, metadata
  - Room — room counts / total inventory
  - Roomblock — out-of-order / blocked rooms
  - Data Insights Reservations — reservation aggregates, pace/pickup
  - Data Insights Financial Transactions — revenue
  - Reservation — backstop for arrival/departure counts
  - *(optional)* Data Insights Invoices, Data Insights Payments, Rate,
    Marketsegment

  **Required as of 08/04/26:** Guest / Data Insights Guests — `/bea` §3 reads
  `primary_guest_full_name` from DI Reservations (dataset 3). Previously listed
  here as "never enable"; that changed with the §5 rule 2 exception. Revoking it
  breaks Bea's Balance due table and nothing else.

  **Never enable:** any Write or Delete; Door Lock Key, Housekeeping, Night
  Audit, Communication, User, etc.

- **Key scoping**: confirm whether the key is per-property or covers all 6 active
  properties. Pilot (Davenport 44199) can start with a single-property key; the
  portfolio view needs multi-property access or one key per property.
- Store the key in a Vercel env var (e.g. `CLOUDBEDS_API_KEY`). Server-side only.
- Verify endpoint names and field shapes against current Cloudbeds API docs at
  build time — do not assume field names from memory.

---

## 7. File naming convention (RISE8 standard)

Property-specific deliverables: `Title_PropertyID_MMDDYY`
(e.g., `OccupancyReport_44199_061726`).

**Exception:** standard tooling files keep their conventional names so they
function correctly — `CLAUDE.md`, `TODO.md`, `package.json`, config files, the
`.bat`/`.ps1` helper scripts. The convention applies to generated reports and
investor/lender/legal outputs, not framework files.

Final report/export outputs save to the project `outputs/` folder
(`C:\Users\Kyle Estocapio\Git-Claude\cloudbeds_dashboard\outputs`). **Do not
write to OneDrive — ever.** Outputs live in the project folder only.

---

## 8. Dev workflow

- Develop on branch **`claude/nifty-thompson-ts8zny`**. Create locally if
  missing. Never push to another branch without explicit permission.
- Commit with clear messages. Push with `git push -u origin <branch>`.
- **Do not open a pull request unless explicitly asked.**
- Repo scope is limited to `stayable/cloudbeds_dashboard`.

## 9. Local dev (Windows, Kyle's machine)

- Repo lives at `C:\Users\Kyle Estocapio\Git-Claude\cloudbeds_dashboard`.
- `start-claude.bat` — pulls latest and launches Claude Code CLI.
- `scripts/clone-repo.ps1` — one-time clone into `C:\Users\Kyle Estocapio\Git-Claude`.
