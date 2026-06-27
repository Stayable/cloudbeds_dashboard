# Ops Dashboard — Design Spec

**Date:** 2026-06-27
**Author:** Claude (with bke@rise8companies.com)
**Status:** Approved design → pending implementation plan

---

## 1. Purpose

Add an **Ops Dashboard** — the first *role*-based (not person-named) PIN-gated
view in the Stayable Cloudbeds dashboard. It surfaces the day-to-day operational
state of the portfolio for operations staff: who's arriving/leaving, what rooms
are down, occupancy, and eviction tracking.

It reuses the existing per-user-dashboard machinery (signed-cookie level gate +
shared section component library). No new infrastructure.

---

## 2. Access & identity

| Attribute        | Value                                                        |
|------------------|-------------------------------------------------------------|
| Level name       | `ops`                                                        |
| Route            | `/ops`                                                       |
| Header title     | **Ops Dashboard**                                            |
| PIN              | `OPS`                                                        |
| Env fallback var | `OPS_PIN` (set in Vercel = `OPS`)                            |
| DB override      | `dashboard_pins` table, `level = 'ops'` (existing mechanism) |
| Exec visibility  | Automatic — `canAccess('exec', …)` returns true for all     |

- The cookie scheme is unchanged: login checks the PIN against
  `effectivePins()` (DB row, else `OPS_PIN` env), then issues the signed level
  token `ops.<hmac>`. Middleware verifies from the cookie alone (no DB read).
- `ops` is a distinct level: its PIN unlocks **only** `/ops`. Exec/Rob sees it
  because exec sees everything; no per-user level sees another's route.

---

## 3. Sections (reused from the shared library)

The page composes four existing section components — no new section types:

1. **Live now** — today's arrivals / departures / in-house / stayovers (counts only).
2. **Out of service** — OOS / blocked rooms by property + reason.
3. **Occupancy** — occupancy % per property + portfolio, daily/weekly/monthly toggle.
4. **Evictions** — Smartsheet-backed: Open / Closed / Total / Avg days to file.

Per the per-user-dashboard convention, the page MUST have:
- a **sidebar section-nav** (anchor links to each section), and
- a **per-property / All toggle** on each section.

Section order in nav and body: Live now → Out of service → Occupancy → Evictions.

---

## 4. Change set

| File | Change |
|------|--------|
| `lib/auth.ts` | Add `"ops"` to the `Level` union, `ALL_LEVELS`, and `USER_PINS` (`{ level: "ops", envVar: "OPS_PIN" }`); add `ops: "OPS_PIN"` to `ENV_PIN_FOR`. `requiredLevel` / `homeForLevel` / `canAccess` already generalize over `USER_PINS` — no logic change, verify only. |
| `lib/pins.ts` | Add `"ops"` to the `order` array in `findLevelByPin` so the PIN resolves to the level. |
| `app/ops/page.tsx` | New page. Mirror `app/monica/page.tsx` structure; header "Ops Dashboard"; compose the four sections with sidebar nav + per-property/All toggle. |
| `middleware.ts` | No change — matcher already gates every non-base route; `/ops` is covered. Verify only. |
| `TODO.md` | Add the Ops Dashboard item; note the `OPS_PIN=OPS` Vercel env step (carried with the open `EXEC_PIN` env task). |
| Vercel env (manual) | User adds `OPS_PIN=OPS` in the Vercel dashboard — Claude cannot set this. Until set, the DB row or env fallback governs; gate stays closed if neither exists. |

---

## 5. Out of scope (YAGNI)

- **No new section components** — all four already exist and are shared.
- **No DB schema change** — PIN storage reuses `dashboard_pins`; no new table/column.
- **No Cloudbeds scope or endpoint change** — sections already fetch what they need.
- **No changes to other dashboards.**
- **No base-`/` exposure** — `/ops` is PIN-gated like the other user views.

---

## 6. Security check (CLAUDE.md §5)

- Credentials stay server-side; no `NEXT_PUBLIC_` added.
- No guest PII — the four sections are all aggregate/operational; Evictions is
  Smartsheet-sourced (no Cloudbeds guest data).
- Read-only; no writes to Cloudbeds.
- PIN `OPS` is low-entropy (matches the existing convention, e.g. exec
  `STYBLCEO`); acceptable per the project's stated low-sensitivity, view-only
  posture. Rotatable any time via the change-PIN route without redeploy.

---

## 7. Acceptance criteria

1. Visiting `/ops` while unauthenticated redirects to `/login?next=/ops`.
2. Entering PIN `OPS` sets the cookie and lands on `/ops` titled "Ops Dashboard".
3. The Ops PIN does **not** unlock `/monica`, `/bea`, `/crystal`, or `/rob`.
4. Exec PIN unlocks `/ops` (exec sees everything).
5. All four sections render with sidebar nav and a per-property/All toggle.
6. Existing dashboards and tests are unaffected (`lib/__tests__/auth.test.ts`
   still passes; extend it to cover the `ops` level).
