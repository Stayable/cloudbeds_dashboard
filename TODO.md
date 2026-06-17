# TODO — Cloudbeds Dashboard

Status legend: `[ ]` open · `[~]` in progress · `[x]` done · `[?]` needs decision

> **Pickup (next CLI session):** Live on Vercel at cloudbeds-dashboard-jade.vercel.app.
> **All 8 properties wired** with per-property keys (CLOUDBEDS_API_KEY_<CODE>); all
> API propertyIDs verified (see config/properties.ts). One-page portfolio view:
> aggregate occupancy + ranked current-occupancy strip + clickable per-property
> tabs. Open items, priority order: (1) **PIN gate** — URL is still public
> (CLAUDE.md §5 rule 5); (2) **ADR/RevPAR/revenue via Data Insights**; (3) remove
> or gate /api/diagnostics; (4) daily/weekly/monthly toggle; (5) verify numbers
> vs Cloudbeds UI; (6) custom domain dashboard.rentstayable.com.
>
> Codes: DP Davenport · LL Lakeland · KE Kissimmee East · KW Kissimmee West ·
> JW Jacksonville West · JN Jacksonville North (usually 0 occ) · SA St. Augustine
> · OR Orlando OBT.
>
> **Cloudbeds auth reference (verified 06/18/26):**
> - Base URL: `https://hotels.cloudbeds.com/api/v1.3`
> - Header: `Authorization: Bearer cbat_…` (alt: `x-api-key: cbat_…`)
> - Key scope: single-property (Davenport) — portfolio needs key-per-property.
> - Client ID/Secret = OAuth app identity, **unused** (we use the static key).

---

## Phase 0 — Decisions & access (do before building)

- [?] **URL**: confirm `dashboard.rentstayable.com` (recommended) vs.
      `rentstayable.com/dashboard`. Affects DNS + Vercel config.
- [x] **Public access posture**: PIN gate via Vercel env var + httpOnly cookie
      (no full login, no DB). See CLAUDE.md §5.
- [x] **Auth method**: API key (scoped key set) — chosen over OAuth. No redirect
      URI needed.
- [x] **Cloudbeds API key**: created with Read-only scopes per CLAUDE.md §6
      (Data Insights Occupancy/Reservations/Financial, Dashboard, Hotel, Room,
      Roomblock, Reservation). No guest scopes, no write/delete. Key value to be
      stored in `.env.local` / Vercel env as `CLOUDBEDS_API_KEY` — never committed.
- [x] **Key scoping**: confirmed **per-property**. The created key (ID/Secret/API
      key) is **Davenport-only**. Cloudbeds keys grant access to either one
      property *or* the whole org; this one is single-property. **Portfolio view
      (Phase 4) will need one key per active property.**
- [ ] **Active properties**: confirm which **6 of 8** are live in Cloudbeds and
      get exact property IDs verified.
- [ ] **Pilot scope**: confirm Davenport (44199) as the first property to wire.
- [ ] Confirm Vercel account/team to deploy under (Vercel MCP is connected).

## Phase 1 — Scaffold (planning files) ✅ this PR

- [x] `CLAUDE.md` — project guidance & context.
- [x] `TODO.md` — this roadmap.
- [x] `start-claude.bat` — Windows launcher (pull + run Claude Code).
- [x] `scripts/clone-repo.ps1` — PowerShell clone helper.

## Phase 2 — App skeleton ✅

- [x] Initialize Next.js (App Router) + TypeScript + Tailwind.
- [x] `config/properties.ts` — property list. **Davenport API propertyID = 318197**
      (business ID 44199 is NOT the API ID); others' `apiPropertyId` unverified.
- [x] Server-side Cloudbeds API client (`lib/cloudbeds.ts`), env-var creds,
      Bearer auth, `{success,data}` envelope handling, no browser exposure.
- [x] `.env.example` documenting `CLOUDBEDS_API_KEY` (no real secrets committed).
- [x] Server-side response caching (10-min TTL via Next data cache).

## Phase 3 — Occupancy view (pilot: Davenport)

- [x] Daily occupancy for Davenport (live from getDashboard: % occupied, rooms
      occupied/capacity, in-house, arrivals/departures, stayovers, blocked, etc.).
- [ ] Daily/weekly/monthly toggle (weekly & monthly aggregate daily data).
- [ ] Verify numbers against Cloudbeds UI for the same dates.
- [ ] ADR / RevPAR / revenue via Data Insights endpoints (not in getDashboard).

## Phase 4 — Portfolio status metrics

- [x] Per-property + portfolio occupancy % (capacity-weighted aggregate).
- [x] Rooms sold / out-of-order / total (per property + tabs).
- [ ] ADR and RevPAR — via Data Insights (not in getDashboard).
- [x] Today: arrivals / departures / in-house / stayovers (counts only).
- [ ] Period revenue — via Data Insights.
- [ ] Pace/pickup (if available — confirm).
- [x] Expanded to all 8 properties — per-property keys (CLOUDBEDS_API_KEY_<CODE>),
      all API propertyIDs verified. One-page portfolio view + per-property tabs.

## Phase 5 — Deploy

- [ ] Set env vars in Vercel (server-side secrets).
- [ ] Deploy to Vercel.
- [ ] Apply chosen access posture (password protection / unguessable URL).
- [ ] Wire DNS for chosen URL.
- [ ] Smoke test: data loads, no PII exposed, no secrets in client bundle.

## Phase 6 — Hardening

- [ ] Loading / empty / error states per property.
- [ ] Rate-limit handling & graceful degradation if Cloudbeds is down.
- [ ] Mobile-responsive layout (IB-clean aesthetic: dark headers, clean grid).
- [ ] Auto-refresh interval for the live view.

---

## Open questions for Kyle
1. URL: subdomain or path? (recommend subdomain)
2. Any access protection acceptable, or strictly public?
3. Cloudbeds API permission options — share screen/options.
4. Which 6 properties are active in Cloudbeds right now?

> Note: org standing rule routes surfaced tasks to the Smartsheet Action Items
> Staging Sheet. No Smartsheet tool is connected in this session, so tasks are
> tracked here in `TODO.md` for now.
