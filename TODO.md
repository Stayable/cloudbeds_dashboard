# TODO — Cloudbeds Dashboard

Status legend: `[ ]` open · `[~]` in progress · `[x]` done · `[?]` needs decision

> **Pickup (next CLI session):** **BLOCKED on Kyle pasting the Neon
> `DATABASE_URL`** into `.env.local` (real pooled string from Neon console —
> sensitive vars can't be `vercel env pull`ed, come back empty). Once pasted,
> run `node scripts/db-init.mjs` to create+verify the `submissions` table, then
> proceed to **writing-plans** for the three-dashboard build.
>
> **THREE-DASHBOARD PROJECT (spec approved this session):** see
> `docs/superpowers/specs/2026-06-23-three-dashboard-stayable-design.md`.
> - `/` Base (existing, unchanged) · `/exec` Rob/CEO (PIN `STYBLCEO`) ·
>   `/test` public (no PIN) intake form.
> - **Role-based PIN** middleware: exec unlocks base+exec; base unlocks base;
>   `/test` excluded from gate. New env `EXEC_PIN=STYBLCEO`.
> - **Exec view:** occupancy + WoW/MoM trend + leaderboard · ADR & RevPAR ·
>   Lease-vs-Transient mix (Monthly/Weekly) · Rob feedback box. Revenue still
>   EXCLUDED (exact blocked; no fake estimate to CEO).
> - **/test = intake form:** name/role/team (Crystal · Remote Property Managers ·
>   Property Managers & Attendants · Other) + catalog metric multi-select (each
>   shows SAMPLE value) + notes → `POST /api/submit` → Neon. BotID-protected.
>   Soft 24h banner, no hard close.
> - **Persistence:** Neon Postgres (`neon-cb-dashboard`, Vercel Marketplace) —
>   sanctioned reversal of §6 "no DB". Single `submissions` table; `source`
>   = 'team-intake' | 'exec-feedback'. Export script → `outputs/*.xlsx`.
> - **All three mobile-responsive** (closes Phase 6 mobile item).
> - **NEW public write surface** (`/api/submit`) — BotID + validation.
>
> **✅ Lease-vs-Transient solved PII-FREE** (no Guest scope, no new key): derive
> from DI **Reservations dataset 3** rate plan (`Monthly Lease`/`Weekly Lease`
> = Kyle's `*ML`/`*WL`). Probe: `scripts/probe-lease-transient.mjs`. Rule lives
> in `lib/lease.ts` (planned). See memory `lease-vs-transient`.
>
> **Provisioning done this session:** Neon DB created + connected; full var set
> (`DATABASE_URL`, `POSTGRES_*`) on Vercel Production+Preview. Project linked
> locally (`stayable-admins-projects/cloudbeds-dashboard`). `@neondatabase/
> serverless` installed. `.vercel` gitignored. **Table NOT yet created** (see
> Pickup blocker).
>
> **(Deferred) Rob's data-catalog approval** —
> `outputs/CloudbedsDataCatalog_Stayable_061926.xlsx` (100 points, Yes/No
> column). Gold re-add candidates: **ADR, RevPAR, Total Room/Total Revenue**.
> Exec view brings ADR/RevPAR/lease back regardless.
>
> **⚠️ Security finding (this session):** the Davenport key is OVER-SCOPED — it can
> read full guest PII (verified live: `getGuestList` → 200, 100 guest records;
> DI Guests/Reservations datasets return PII). Dashboard never calls those, so no
> leak today, but re-issue all 8 keys WITHOUT Guest / Data Insights Guests scopes
> so PII is blocked by design (CLAUDE.md §6). Other 7 keys likely same.
>
> **Output location changed:** project `outputs/` ONLY. Do NOT write to OneDrive
> (CLAUDE.md §7 updated). `.env.local` now holds the real Davenport key
> (gitignored). Probe scripts in `scripts/probe-*.mjs` are read-only, no secrets.
>
> **Live on Vercel at cloudbeds-dashboard-jade.vercel.app.**
> **All 8 properties wired** with per-property keys (CLOUDBEDS_API_KEY_<CODE>); all
> API propertyIDs verified (see config/properties.ts). **PIN gate live.**
>
> **Dashboard is now OCCUPANCY-FIRST** (redesigned this session): headline =
> Portfolio Occupancy driven by a date filter (Yesterday / Last 7 / Last 30 /
> This month + custom From/To, Eastern). Occupancy = daily avg over range from
> Data Insights (dataset 7). Per-property: occupancy strip with include/exclude-
> average toggles + KE −20 renovation re-basing; detail tab shows Occupancy(range
> avg)+daily bars AND the "Today (live snapshot)" cards (rooms occupied/in-house/
> arrivals/departures/stayovers/blocked/bookings/cancellations from getDashboard).
> **ADR/RevPAR/revenue REMOVED** from UI per request. Components: OccupancyView,
> PeriodControls (PortfolioView/PropertyTabs deleted). Discovery endpoints removed.
>
> Open items: (1) verify DI occupancy vs Cloudbeds UI for a known date;
> (2) "Today (live)" cards are always today regardless of range — flagged, make
> range-aware only if asked; (3) custom domain dashboard.rentstayable.com;
> (4) if exact revenue ever wanted again: DI count/currency columns need an
> aggregation key not in public docs (ask Cloudbeds support / Finances dataset 1).
> DI query shape recorded in memory data-insights-occupancy.
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
- [x] Date-range period view via Data Insights (dataset 7): occupancy/ADR/RevPAR
      by day; presets (Yesterday/Last 7/Last 30/This month) + custom From/To,
      Eastern. Portfolio summary + per-property table.
- [x] ADR / RevPAR live (Data Insights). Revenue = est. (RevPAR × room count) —
      exact revenue needs a DI aggregation key not in public docs (follow-up).
- [ ] Verify numbers against Cloudbeds UI for the same dates.

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

- [x] Set env vars in Vercel (per-property keys + DASHBOARD_PIN).
- [x] Deploy to Vercel (cloudbeds-dashboard-jade.vercel.app).
- [x] Access posture: PIN gate (middleware + httpOnly cookie); also gates
      /api/diagnostics. Active when DASHBOARD_PIN is set.
- [ ] Wire DNS for dashboard.rentstayable.com.
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
