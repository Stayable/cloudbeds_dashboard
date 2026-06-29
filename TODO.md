# TODO — Cloudbeds Dashboard

Status legend: `[ ]` open · `[~]` in progress · `[x]` done · `[?]` needs decision

> **Pickup (next CLI session):** Branch `claude/nifty-thompson-ts8zny` — working
> tree clean after Ops Dashboard commit. **LIVE at `dashboard.rentstayable.com`**.
> Build green; **59 vitest tests pass** (13 files). Pushed to origin (`e08f591`).
>
> **OPERATIONS DASHBOARD rebuilt (session 06/30/26).** Route `/ops` gated to `ops`
> level OR exec/CEO. **PIN = `OPERATIONS`** (Neon `dashboard_pins`, changed from
> `OPERATION` per Kyle). Title now "Operations Dashboard". **5 sections** (sidebar
> SectionNav + per-property/All toggles per [[per-user-dashboard-conventions]]):
>   1. **OOO rooms** — LIVE, reuses `BeaOosExplorer` + `getPortfolioOoo` (copied
>      from Bea's view).
>   2. **Leasing** — BLANK placeholder. Note: "Requesting leasing (read) API from
>      Elise for prospects and lease activity." (EliseAI parked — see memory
>      `evictions-smartsheet`.) Replaced the old Cloudbeds-DI lease placeholder.
>   3. **Occupancy** — LIVE, `OccupancyView` + `PeriodControls` (from main dash).
>   4. **Evictions** — LIVE, `EvictionsSection` + `getEvictions` (copied from Monica).
>   5. **1-Star Reviews** — BLANK placeholder, note "Ongoing build". Source TBD
>      (Local Falcon MCP is connected — candidate source).
>   - Build green, typecheck clean; smoke-tested authed (`OPERATIONS` → `/ops`,
>     all 5 sections render).
>
> **EVICTIONS shipped to `/monica` (session 06/26/26, commit `9997565`, pushed).**
> First non-Cloudbeds data source. Section #6 on Monica's dashboard, per-property/
> All toggle + table. Metrics: Open / Closed / Total + **Avg days to file** (notice
> → complaint, all-time) + **Avg days to resolve** (filing → completion, MTD).
>   - Source: Smartsheet **"Evictions Metrics"** sheet `4398121124581252` (live
>     cross-sheet formulas, counts only — no PII) via new server-only read client
>     `lib/smartsheet.ts` (Bearer, 10-min cache). Builder + tests `lib/evictions.ts`.
>   - **Days-to-file is APP-COMPUTED** from the Closed sheet `1160578736646020`,
>     column-restricted to Property + 2 dates (no tenant names hit the server).
>     Reason: an auto-updating sheet row would need a cross-sheet named reference,
>     which is Smartsheet-UI-only (not creatable via API/MCP).
>   - **New env vars:** `SMARTSHEET_API_TOKEN` (set by Kyle this session) ·
>     optional `SMARTSHEET_EVICTIONS_SHEET_ID` (dflt 4398121124581252) ·
>     `SMARTSHEET_CLOSED_SHEET_ID` (dflt 1160578736646020). Section degrades to a
>     friendly "not connected" state when token unset. See memory
>     `evictions-smartsheet`.
>   - **Smartsheet MCP = browser OAuth only** (`/mcp` each session); the deployed
>     app uses the API token, not the connector.
>   - **EliseAI (Leases, Prospects) — PARKED** by Kyle. No connector / no key; needs
>     read-only API access + docs from EliseAI vendor before any build.
>   - **Open evictions follow-ups:** (a) days-to-file is all-time — switch to MTD if
>     cadence should match resolve; (b) computed from Closed sheet only — union
>     Master DB `6908157491472260` if it also holds closed cases; (c) mirror the
>     section onto other dashboards if wanted; (d) verify live render now token set.
>
> **Per-user dashboards SHIPPED (session 06/25–26/26).** Routes:
>   - **`/` home — PUBLIC, no PIN** (occupancy-first view + a "Personal view →"
>     PIN box in the header to jump to your own dashboard).
>   - **`/crystal`** (VP Ops, 36 metrics) · **`/monica`** (Revenue Mgmt, 16) ·
>     **`/bea`** (Ops Support, 2) · **`/rob`** (CEO/exec, 66). Each tailored to
>     that person's `/test` submission, deduped to data-backed metrics.
>   - **`/exec` REMOVED** (Rob's view is `/rob`, exec-gated).
>   - Shared convention: sticky `SectionNav` sidebar + per-property/All toggle per
>     section + "← Dashboard" back link. See memory `per-user-dashboard-conventions`.
>
> **PINs are Neon-only (06/30/26): env-var fallback REMOVED.** `dashboard_pins`
> is now the single source of truth — no `*_PIN` env var is read anymore (users
> change their own PIN, so the DB must win). `lib/pins.ts` reads DB only; if the
> DB is unreachable, NO level can log in (fail-safe closed, not open). Removed
> `ENV_PIN_FOR` + `USER_PINS[].envVar` from `lib/auth.ts`; dropped `*_PIN` from
> `.env.example`/`.env.local`. Manage rows with `scripts/seed-pins.mjs`.
>
> **Auth → DB-backed PINs + signed cookie:**
>   - PINs live in Neon table **`dashboard_pins(level,pin,updated_at)`**. Read
>     only at login + change. `lib/pins.ts`.
>   - Cookie = signed level token `"<level>.<hmac(level)>"` (secret =
>     `AUTH_SECRET || DATABASE_URL`). `signLevel`/`verifyCookie` in `lib/auth.ts`.
>     Middleware verifies with ZERO DB reads; only user/exec routes gated (base
>     public). Login auto-routes by level (`homeForLevel`).
>   - **Self-service Change PIN** on each dashboard (`/api/change-pin`, derives
>     level from cookie → changes only your own).
>   - **Current PINs (in Neon):** exec=`STYBLCEO`, crystal=`CRYSTL`,
>     monica=`MONICA`, bea=`BEAOPS`, ops=`OPERATIONS`. Home is public.
>
> **Data wins this session:**
>   - **§4 Reservations** (Crystal/Monica/Rob): live DI dataset-3 aggregates,
>     PII-free (`getReservationAggregates`); Rob adds fees/taxes/commission.
>   - **§5 Finance** (Rob/Monica): DI dataset-1, **per-day chunking** beats the
>     1500-row detail cap (`getFinanceAggregates`, `capped` flag warns if a day
>     still hits it).
>   - **Bea OOS explorer:** property cards → single property shows reason cards +
>     room list; **All Properties = total + summary table** (count + top reason,
>     click a row to drill in). Rooms from `getRoomBlocks`+paginated `getRooms`
>     (`getOooRooms`). Room numbers = inventory, not PII.
>
> **Lakeland key re-created + working** (session end): config already had
> `apiPropertyId 210972`; key in Vercel as `CLOUDBEDS_API_KEY_LL`; live home shows
> `LL configured:true, capacity 157`. **Verify Bea→Lakeland tab** (Room/Roomblock
> scopes) — if it shows "error", those two scopes weren't re-enabled on the new key.
>
> **Key audit DONE (06/30/26) — ALL 8 KEYS HEALTHY, 0 errors.** Audited via the
> live dashboard (`dashboard.rentstayable.com`): header reads **"8 of 8 reporting"**;
> every property returns occupancy data (Jun 23–29: OR 91.0 · KW 90.4 · JW 89.6 ·
> KE 88.0 · SA 86.1 · LL 84.1 · DP 72.9 · JN 12.0 (excluded)). Supersedes the old
> "only DP + LL reporting" note.
>   - **Why live-dashboard, not the script:** every app env var (incl. all
>     `CLOUDBEDS_API_KEY_*`, `DATABASE_URL`) is **Sensitive** in Vercel →
>     `vercel env pull` returns names with EMPTY values, so a local
>     `scripts/audit-keys.mjs` run can only test keys pasted into `.env.local`
>     (DP). The script still works if you paste the real values; otherwise the
>     live dashboard is the audit.
>   - Security carry-forward UNCHANGED: keys working ≠ keys correctly scoped —
>     still re-issue all 8 read-only WITHOUT Guest scope (see below).
>
> **Next steps / open:**
>   1. ~~Other property keys~~ **DONE** — all 8 reporting (audit above). Remaining
>      key work is the security re-issue (no Guest scope), not connectivity.
>   2. (Optional) set `AUTH_SECRET` in Vercel to decouple cookie signing from
>      `DATABASE_URL` (one-time re-login when it changes).
>   3. (Optional) notes box for Monica/Bea (Crystal/Rob have one).
>   4. Finance is per-property × 2 calls/day — watch volume if many keys + long
>      ranges; throttle if it drags.
>
> **⚠️ Security carry-forward:** re-issue ALL keys read-only, NO Guest / Data
> Insights Guests scope (Davenport key was over-scoped — verified could read PII;
> dashboard never calls it, so no leak, but block by design). CLAUDE.md §6.
>
> **Open lease-mix caveats (carry-forward from Tasks 5 & 13):**
>   - **Ratio-only:** lease-mix `total` is summed `room_count` over in-house
>     reservation rows, NOT physical rooms. Davenport 06/24: lease total 644 vs
>     getDashboard inHouse 109 / capacity 152. ExecView renders it as
>     monthly/weekly/transient **percentages only** — never as a room count.
>     Keep it a ratio; do not surface the raw total as "rooms".
>   - **"In-House" string unverified on 7 properties:** the `reservation_status`
>     value `"In-House"` is confirmed live on Davenport only. Spot-check the
>     other 7 post-deploy (group dataset 3 by `reservation_status`); if a
>     property uses a different string, its lease mix would read empty.
>
> **THREE-DASHBOARD PROJECT (spec approved & BUILT):** see
> `docs/superpowers/specs/2026-06-23-three-dashboard-stayable-design.md`.
> - [x] `/` Base (existing, unchanged) · `/exec` Rob/CEO (PIN `STYBLCEO`) ·
>   `/test` public (no PIN) intake form.
> - [x] **Role-based PIN** middleware: exec unlocks base+exec; base unlocks base;
>   `/test` excluded from gate. New env `EXEC_PIN=STYBLCEO`.
> - [x] **Exec view:** occupancy + WoW/MoM trend + leaderboard · ADR & RevPAR ·
>   Lease-vs-Transient mix (Monthly/Weekly) · Rob feedback box. Revenue still
>   EXCLUDED (exact blocked; no fake estimate to CEO).
> - [x] **/test = intake form:** name/role/team (Crystal · Remote Property Managers ·
>   Property Managers & Attendants · Other) + catalog metric multi-select (each
>   shows SAMPLE value) + notes → `POST /api/submit` → Neon. BotID-protected.
>   Soft 24h banner, no hard close.
> - [x] **Persistence:** Neon Postgres (`neon-cb-dashboard`, Vercel Marketplace) —
>   sanctioned reversal of §6 "no DB". Single `submissions` table; `source`
>   = 'team-intake' | 'exec-feedback'. Export script → `outputs/*.xlsx`.
> - [x] **All three mobile-responsive** (closes Phase 6 mobile item).
> - [x] **NEW public write surface** (`/api/submit`) — BotID + validation.
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

- [x] **URL**: `dashboard.rentstayable.com` — custom domain wired in Vercel
      (session 06/26/26). Live.
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
- [x] **Active properties**: **all 8 are active** in Cloudbeds (confirmed by Kyle
      06/30/26). Property IDs verified in `config/properties.ts`.
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
- [x] Wire DNS for dashboard.rentstayable.com (custom domain live, 06/26/26).
- [~] Smoke test: home + per-user dashboards verified live (DP + LL reporting);
      remaining 6 properties await keys.

## Phase 6 — Hardening

- [ ] Loading / empty / error states per property.
- [ ] Rate-limit handling & graceful degradation if Cloudbeds is down.
- [x] Mobile-responsive layout (IB-clean aesthetic: dark headers, clean grid).
      Done across `/`, `/exec`, `/test` in the three-dashboard build.
- [ ] Auto-refresh interval for the live view.

---

## Open questions for Kyle
1. URL: subdomain or path? (recommend subdomain)
2. Any access protection acceptable, or strictly public?
3. Cloudbeds API permission options — share screen/options.
4. Which 6 properties are active in Cloudbeds right now?

> Note: org standing rule routes surfaced tasks to the Smartsheet Action Items
> Staging Sheet. Smartsheet MCP is now connectable via `/mcp` (browser OAuth, per
> session) — used 06/26/26 to wire the Evictions source. Tasks still tracked here
> in `TODO.md` unless explicitly pushed to the staging sheet.
