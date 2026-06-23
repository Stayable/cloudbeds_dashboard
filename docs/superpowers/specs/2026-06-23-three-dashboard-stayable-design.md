# Design — Three-Dashboard Stayable App

**Date:** 2026-06-23
**Owner:** RISE8 / Stayable (SFI)
**Branch:** `claude/nifty-thompson-ts8zny`
**Status:** approved in brainstorming; pending spec review.

---

## 1. Goal

Extend the existing occupancy-first Cloudbeds dashboard from one view into
three, each for a different audience; add a newly-feasible **Lease vs Transient**
metric (no Guest scope, no new API key); and turn the public view into a
**requirements-intake form** backed by a database (the sanctioned first use of
persistence — see §6a), with a **feedback channel** for Rob on the exec view.

| Route     | Audience                       | Gate                          |
|-----------|--------------------------------|-------------------------------|
| `/`       | Base (ops) — existing          | existing `DASHBOARD_PIN`       |
| `/exec`   | Rob (CEO)                      | `EXEC_PIN` = `STYBLCEO`        |
| `/test`   | All teams (requirements input) | **none — public**              |

All three are **mobile-responsive** (IB-clean grid; collapses to single column
on phones). This also closes the Phase 6 mobile-responsive item.

---

## 2. Architecture & routing

Single Next.js app (no new Vercel projects). Three route segments under `app/`:

- `app/page.tsx` — Base (unchanged).
- `app/exec/page.tsx` — Exec.
- `app/test/page.tsx` — Test (static, no data fetching).

### PIN / role model (replaces single-PIN gate)

Today `middleware.ts` gates **every** route behind one `DASHBOARD_PIN`. New
model is **role-based**, same crypto pattern as `lib/auth.ts` (SHA-256 token in
an httpOnly cookie; no DB):

- Two levels: **base** (`DASHBOARD_PIN`) and **exec** (`EXEC_PIN`).
- Login (`/login` + `/api/auth`) accepts **either** PIN. The cookie stores the
  token of whichever PIN matched. Token = `SHA-256("stayable-dashboard:<level>:<pin>")`
  so the two levels yield distinct tokens.
- **Access rules in middleware (path → required level):**
  - `/exec` → requires the **exec** token only.
  - `/` (and any other gated route) → accepts **base OR exec** token (CEO sees
    everything).
  - `/test` → added to the matcher **exclusion list**; never gated.
- If `EXEC_PIN` is unset, `/exec` falls back to requiring base (never locks
  itself out, mirroring the existing `!pin` guard).

`lib/auth.ts` grows a small level map: `{ base: DASHBOARD_PIN, exec: EXEC_PIN }`
and a `tokenFor(level, pin)` + `levelsUnlockedBy(pin)` helper. Middleware imports
it (Edge-safe — Web Crypto only, no Node APIs).

### Login UX

`/login` gains an optional context: after submit, redirect back to the
originally-requested path (`?next=`). One PIN field; the entered PIN determines
the level. Wrong/insufficient level on `/exec` → redirect to `/login?next=/exec`.

---

## 3. Base `/` — unchanged

Current occupancy-first view (`OccupancyView` + `PeriodControls`) stays exactly
as-is. No content changes. Only inherited change: it now also accepts the exec
token (so Rob isn't bounced).

---

## 4. Exec `/exec` (PIN `STYBLCEO`)

CEO view. Reuses `getPortfolio` / `getPortfolioInsights`; adds one DI Reservations
query for lease mix. Three blocks (the user's selections):

1. **Occupancy + trend + leaderboard**
   - Portfolio occupancy headline with **WoW** and **MoM** deltas (compare the
     selected range's avg occupancy to the prior equal-length window and the
     prior month). Computed from DI dataset 7 rows already fetched (issue the
     prior-window query in parallel).
   - Per-property **ranked leaderboard** best→worst, with exception flags
     (e.g. JN ≈ 0% highlighted).

2. **ADR & RevPAR**
   - Per-property + portfolio. Both auto-aggregate cleanly in DI (no blocked
     aggregation key). These are the "gold" metrics deliberately omitted from
     the base view; the exec view is their home.

3. **Lease vs Transient mix**
   - Per-property + portfolio %, with **Lease split into Monthly / Weekly** to
     mirror the `*ML` / `*WL` convention.
   - Source: DI **Reservations** dataset (id 3), `public_rate_plan` /
     `private_rate_plan`. **No guest scope, no PII** (see §5).

**Revenue is intentionally excluded.** Exact revenue is still blocked (DI sum
aggregation key not in public docs); only a `RevPAR × rooms` estimate is honest,
and we will not ship a labeled-estimate revenue figure to the CEO unless asked.
Documented as a deferred item.

4. **Feedback box** — a textarea where Rob can leave feedback on his dashboard.
   Posts to `POST /api/feedback` → Neon (`source='exec-feedback'`). Exec-gated,
   so no public abuse surface. Simple confirmation on submit.

Aesthetic: IB-clean (dark headers, clean grid, no chartjunk), mobile-responsive.

---

## 5. Lease vs Transient classification (`lib/lease.ts`)

Single auditable module. Input: a reservation's rate-plan string(s). Output:
`"lease-monthly" | "lease-weekly" | "transient"`.

**Rule (documented, tweakable):**
- Contains `Monthly Lease` (or `Long Term` / `Discounted Long Term`) → `lease-monthly`.
- Else contains `Weekly Lease` / `Weekly Rate` / `Discounted Weekly` /
  `Employee Weekly` → `lease-weekly`.
- Else → `transient`.
- **Multi-plan stays** (comma-joined, e.g. `Discounted Weekly Rate, Monthly Lease`):
  evaluate in the order above — **any lease plan present ⇒ Lease**, monthly
  taking precedence over weekly.

Counts are a **point-in-time in-house snapshot** as of the **end date of the
selected range** (defaults to today when the preset is "today"/"yesterday") —
i.e. reservations whose stay overlaps that date and whose `reservation_status`
is in-house/checked-in. Lease mix is a snapshot, not a range average (unlike
occupancy), and the UI labels it with that as-of date. The keyword lists live as
named constants so they can be corrected against real rate-plan inventory
without touching call sites.

**Validation step (implementation):** before trusting the rule, run a read-only
check that the rate-plan-derived lease count is sane against `getDashboard`
in-house totals for Davenport. Adjust keyword lists if mismatched.

---

## 6. Test `/test` (public, no PIN) — interactive intake form

`/test` is an **intake form**, not just a showcase. Teams fill it out and submit
to a database, replacing the need for live chats to gather requirements.

- **Catalog as the selectable menu.** All ~100 catalog points from
  `outputs/CloudbedsDataCatalog_Stayable_061926.xlsx`, enumerated into a typed
  `config/catalog-sample.ts` (metric name, category, **SAMPLE value**, format),
  grouped by category. Each metric shows its SAMPLE value (watermarked
  "SAMPLE — not live data") **next to a checkbox**, so teams see what they're
  picking. No Cloudbeds calls — pure static catalog + fake values.
- **Form fields:**
  - `name` (required)
  - `role` (required, free text)
  - `team` (required, select): **Crystal · Remote Property Managers ·
    Property Managers & Attendants · Other** (free text if Other). Taxonomy is
    explicitly revisitable after submissions land.
  - `metrics` (multi-select over the catalog; ≥1 required)
  - `notes` (optional free text)
- **Soft 24-hour window:** a banner asks teams to submit within 24 hours. **No
  hard cutoff** — the form stays open; nothing auto-closes.
- **Submit → `POST /api/submit`** → row in Neon Postgres (see §6a).
- Mobile-responsive card/grid; works with no auth.

## 6a. Persistence (Neon Postgres) + submission/feedback APIs

Reverses CLAUDE.md §6 "No database" — the sanctioned "later" trigger
(persisting submissions). Storage is **Neon Postgres via the Vercel
Marketplace**; connection string in a server-only env var (`DATABASE_URL` /
`POSTGRES_URL`). Server-side only; never exposed to the browser.

**One table, both sources:**

```sql
create table submissions (
  id          bigserial primary key,
  created_at  timestamptz not null default now(),
  source      text not null,          -- 'team-intake' | 'exec-feedback'
  name        text,
  role        text,
  team        text,
  metrics     jsonb,                   -- array of catalog metric keys (intake only)
  notes       text                     -- intake notes, or Rob's feedback body
);
```

**Write paths:**
- `POST /api/submit` — **public**, from `/test`. **BotID-protected** (Vercel
  BotID, GA), plus required-field + ≥1-metric server-side validation. Inserts
  `source='team-intake'`.
- `POST /api/feedback` — **exec-gated** (behind the exec PIN, like `/exec`),
  from Rob's feedback box. Inserts `source='exec-feedback'`, `name='Rob'`
  (prefilled), `notes=<feedback>`.

**Read / export:** a read-only script `scripts/export-submissions.mjs` dumps the
table to `outputs/Submissions_Stayable_<MMDDYY>.xlsx` (IB formatting) so Kyle can
review and act per team. No admin UI in this scope.

**Abuse posture:** the only public write is `/api/submit`. Mitigations: BotID,
required fields, ≥1 metric, light server-side rate limiting, low-sensitivity
data (name/role — no secrets, no guest PII). Documented as the one new public
write surface.

---

## 7. Security / data posture

- **No new API key. No Guest scope.** Lease/Transient comes from rate plan
  (an allowed scope per CLAUDE.md §6). Hard rule §5.2 (no guest PII) is
  preserved by design.
- The **open security finding** — re-issue all 8 keys without Guest / DI Guests
  scopes — is **unaffected and still recommended**. This work does not depend on
  it and does not make it worse.
- `/test` shows hardcoded fake data → zero PII risk despite being public. The
  new public write (`/api/submit`) is BotID-protected and stores only
  low-sensitivity name/role/picks — no secrets, no guest PII.
- `EXEC_PIN` and `DATABASE_URL` stored in Vercel env + `.env.local`
  (gitignored). Never committed.
- `/api/feedback` is exec-gated; not a public write surface.

---

## 8. Components & files (planned)

| File | Change |
|---|---|
| `middleware.ts` | path→level gate; exclude `/test` |
| `lib/auth.ts` | level map, `tokenFor(level,pin)`, `levelsUnlockedBy(pin)` |
| `app/login/page.tsx`, `app/api/auth/route.ts` | `?next=` redirect; level-aware cookie |
| `lib/cloudbeds.ts` | add `getPortfolioLeaseMix(date)` (DI dataset 3) + prior-window occupancy for deltas |
| `lib/lease.ts` | **new** — classification rule |
| `app/exec/page.tsx` | **new** — exec view |
| `components/ExecView.tsx` | **new** — leaderboard + KPI + lease mix, mobile-responsive |
| `app/test/page.tsx` | **new** — intake form (static catalog + checkboxes) |
| `components/IntakeForm.tsx` | **new** — client form (name/role/team/metrics/notes) |
| `config/catalog-sample.ts` | **new** — enumerated catalog points + sample values |
| `lib/db.ts` | **new** — Neon client + `insertSubmission()` |
| `app/api/submit/route.ts` | **new** — public, BotID-protected intake write |
| `app/api/feedback/route.ts` | **new** — exec-gated feedback write |
| `components/ExecFeedback.tsx` | **new** — Rob's feedback textarea |
| `scripts/export-submissions.mjs` | **new** — dump table → `outputs/*.xlsx` |
| `config/properties.ts` | unchanged |

---

## 9. Out of scope / deferred

- Exact revenue (blocked; needs Cloudbeds support or Finances dataset key).
- Range-aware "Today (live)" cards (pre-existing flag, unchanged).
- DNS / custom domain (`dashboard.rentstayable.com`) — separate task.
- Re-issuing the 8 keys without Guest scope (separate security task).
- Admin UI for browsing submissions (export script only for now).
- Hard 24h auto-close (soft banner only, per decision).
- Provisioning the Neon DB itself (Vercel Marketplace step, done before/at
  implementation; spec assumes `DATABASE_URL` is available).

---

## 10. Testing

- `lib/lease.ts`: unit tests over representative rate-plan strings incl.
  multi-plan comma cases and the precedence rule.
- Middleware: base PIN cannot reach `/exec`; exec PIN reaches both; `/test`
  reachable with no cookie.
- `/test`: form renders with no env vars / no network (static catalog must work
  offline). Submit requires `DATABASE_URL`.
- `/api/submit`: rejects missing required fields / zero metrics; happy-path
  inserts one row with `source='team-intake'`. `/api/feedback`: rejects without
  exec cookie; inserts `source='exec-feedback'`.
- Lease-mix sanity check vs Davenport `getDashboard` in-house count.
