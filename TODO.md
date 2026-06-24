# TODO — Cloudbeds Dashboard

Status legend: `[ ]` open · `[~]` in progress · `[x]` done · `[?]` needs decision

> **Pickup (next CLI session):** **Three-dashboard build COMPLETE, reviewed,
> pushed.** Branch `claude/nifty-thompson-ts8zny` @ `5bcee0a` == origin. Gate
> green: `npm test` **40/40**, `tsc --noEmit` clean, `npm run build` lists `/`,
> `/exec`, `/test`, `/login`, `/api/auth`, `/api/submit`, `/api/feedback`; no
> secrets in `.next/static`.
>
> **UI enhancements this session (06/24/26, post-build):**
>   - Nav buttons: `/` → "Executive view"; `/exec` → "← Dashboard"; `/login`
>     "← Back" (for no-PIN / wrong-PIN on the exec prompt).
>   - `/exec` now embeds the full operational dashboard (OccupancyView: property
>     selector + per-property detail + Today live cards) via shared
>     `lib/occupancy.ts` `buildOccProperties`. Order: **Executive analytics on
>     top**, Operational dashboard below, then an **abbreviations legend**.
>   - `/test`: note added that metric availability depends on role/permissions.
>
> **Next real action — deploy (needs Kyle/permission, CLAUDE.md §8):**
>   1. `vercel env add EXEC_PIN production` → value `STYBLCEO` (also Preview).
>   2. Confirm `DATABASE_URL` already set on Vercel Prod+Preview (it is, per
>      provisioning below).
>   3. Redeploy, then smoke `/`, `/exec`, `/test` on the live URL.
>   4. ~~Wire DNS `dashboard.rentstayable.com`~~ — **DEPRIORITIZED by Kyle.**
>      Stays on `cloudbeds-dashboard-jade.vercel.app` for now.
>
> **Follow-up flagged (NOT built — intent only):** per-metric / per-role
> filtering of the live dashboards. The `/test` role note promises it, but the
> gate today is binary (base vs exec); actual role-scoped metric hiding is a
> separate piece of work to spec if wanted.
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
> Staging Sheet. No Smartsheet tool is connected in this session, so tasks are
> tracked here in `TODO.md` for now.
