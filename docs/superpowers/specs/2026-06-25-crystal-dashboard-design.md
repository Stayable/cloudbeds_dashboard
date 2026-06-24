# /crystal — Crystal's tailored operations dashboard

**Date:** 2026-06-25 · **Owner:** RISE8 / Stayable · **Status:** approved, building

## Goal

A PIN-gated `/crystal` route showing a dashboard tailored to the 36 metrics
Crystal Johnson (VP of Operations) selected on `/test`, organized into logical
sections, with **live** (today) data alongside **period** (date-range) data, plus
a notes/comments field at the bottom. Aggregate-only, no guest PII (CLAUDE.md
§5/§6).

## Access

- New third auth level `crystal` in `lib/auth.ts`, alongside `base`/`exec`.
- Keyed off a new env var `CRYSTAL_PIN` = `CRYSTL` (cookie = SHA-256 of
  `stayable-dashboard:crystal:<pin>`).
- `/crystal` unlocks with the **CRYSTL** PIN **or** the exec PIN (CEO sees all).
  Base PIN does not unlock it. `decideAccess` enforces this; `requiredLevel`
  maps `/crystal(/...)` → `crystal`. Auth route accepts the crystal PIN.
- Middleware already gates `/crystal` (not in the public-exclusions matcher).
- **Deploy dependency:** `CRYSTAL_PIN=CRYSTL` must be set in Vercel (same
  outstanding step as `EXEC_PIN`); until then `/crystal` falls back to the base
  gate behavior. Flag at handoff.

## Layout — 4 sections (organized per recommendation)

1. **Live now** (today, Eastern) — from `getPortfolio`/`DashboardData`. Portfolio
   roll-up + per-property: live occupancy %, rooms occupied, sellable capacity,
   in-house rooms, guests in-house, arrivals (expected/confirmed), departures
   (expected/confirmed), new bookings today, cancellations today, rooms blocked,
   % blocked, date-blocked rooms, out-of-service rooms. **All fields verified
   present in `DashboardData`.**
2. **Occupancy — selected range** — reuse `OccupancyView` + `buildOccProperties`
   (capacity-weighted portfolio occupancy, per-property detail, daily bars,
   include/exclude toggles). Covers occupancy %, adjusted occupancy %, rooms
   sold, rooms available, capacity, blocked/OOS over range. Driven by
   `PeriodControls` (presets + custom range).
3. **Revenue & rate — selected range** — from DI dataset 7 (`getPortfolioInsights`,
   `OccupancyRow.adr/revpar`). Portfolio + per-property ADR, RevPAR, room rate
   (≈ADR), total room revenue and total revenue **derived as RevPAR × capacity ×
   days and labeled "est."** (DI public API can't sum currency columns directly —
   consistent with the existing exec approach). Estimates are visibly marked.
4. **Reservations & pace — selected range, aggregates only** — from DI dataset 3
   (the proven `details:true` + `room_count` pattern, like `getLeaseMix`):
   - **Reservation status mix** — rooms-on-books by `reservation_status`
     (Confirmed / In-House / Checked-Out / Cancelled / No-Show). Verified columns.
   - **Rate-plan mix** — rooms-on-books by `public_rate_plan`. Verified columns.
   - **Deferred (honest):** reservation grand total / paid / balance due (currency),
     room type / room-type-category, room guest count, room nights — these need a
     live column-name probe against dataset 3 and currency columns may not be
     API-aggregatable. Shown as a labeled "pending data verification" placeholder
     rather than a fabricated number. Follow-up task.

## Notes / comments field

- A robust notes box at the bottom (try/catch + abort timeout — NOT the
  unguarded pattern that hung the `/test` form). Posts to `/api/crystal-note`.
- `/api/crystal-note` (crystal-or-exec gated, mirrors `/api/feedback`) →
  `insertCrystalNote(notes)` → `submissions` with `source='crystal-note'`,
  `name='Crystal'`. No PII; submitter-entered text only.

## Non-goals / assumptions

- Portfolio-wide across active properties; default range last 7 days; Eastern.
- Read-and-cache Cloudbeds only; never persists Cloudbeds data.
- No fabricated figures — unavailable metrics are labeled, not invented.

## Testing

- TDD the pure auth functions (`requiredLevel`, `decideAccess`, `expectedTokens`)
  for the new `crystal` level. Existing auth tests must stay green.
- `npm run build` green before push.
