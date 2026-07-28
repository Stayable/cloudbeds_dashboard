# TODO — Cloudbeds Dashboard

Status legend: `[ ]` open · `[~]` in progress · `[x]` done · `[?]` needs decision

---

## 07/28/26 (session 3b) — ACCURACY REMEDIATION vs Monica's report

Kyle added her 7/25–7/27 PDFs; a full parity comparison (8 properties × 3 periods
× 17 metrics) found seven defects. All seven are addressed. Portfolio YTD
occupancy went **75.8% → 79.7%** against her 79.7%, and every Last-Year column
now matches her exactly (was −33.4pp on Davenport). YTD room revenue was already
within +0.06%.

- **[x] Nights source replaced.** Dataset-3 `reservation_status = "In-House"`
  dropped guests who checked out before the 06:00 capture. Nights now come from
  the same dataset-1 room-rate query as revenue, de-duplicated on
  `res_room_identifier`. Verified live: DP 7/24 → 13/83 and 7/26 → 18/82, both
  exactly her figures (was 11/84 and 7/84). `foldRoomNights` is unit-tested.
- **[x] Inventory denominators.** `inServiceWindows` in `config/properties.ts`
  (JN Jan–Apr 2025 + Apr 2026 on; DP Jun 2025 on — each derived two ways that
  agree exactly); 486 phantom rows cleared; per-day inventory seeded from her
  workbook, which showed real capacity moves we were flattening (DP 151→150→152→
  153 during 2026, OR 133→135, KE 196→167 in 2025).
- **[x] Restatement.** `/api/cron/restate` (11:30 UTC daily) re-derives the
  trailing 31 days and freezes months 5 days after close. `flash_room_rev` keeps
  the first capture so the delta is quantifiable. This deliberately relaxes the
  old capture-once rule — safe now only because nights no longer depend on
  current reservation status.
- **[x] JN out-of-order.** `sellableOverrides` (20 sellable of 127) with a
  `manual override` badge on the report; 122 historical days repaired. JN reads
  2 available, not 89.
- **[x] Availability guard.** `findAvailabilityAnomalies` flags ≥25% availability
  for 7+ consecutive days, surfaced in the report + gaps crons. Unit-tested.
- **[x] Block-type composition** stored per `roomBlockType`; **new-rate-plan
  alert** via `known_rate_plan` + the rate-plans audit.
- **[x] Reconciliation workbook** → `outputs/RevenueVariance_Stayable_072826.xlsx`
  (Variance tab + Findings & status tab).

**▶ Open items from this work:**
1. **[?] KE 167 vs 168 rooms** — unresolved, 1 room every day all year. Run
   `node scripts/audit-room-counts.mjs` where all 8 keys exist (it needs a key
   per property; only DP is in local `.env.local`). If Cloudbeds lists 168, find
   the extra room and fix it at source rather than hardcoding 167.
2. **[ ] Restate the other 7 properties.** Only Davenport could be restated
   locally. Deploy, then hit `/api/cron/restate?days=31` so 7/24–7/26 counts are
   re-derived for LL/JW/KE/KW/OR/SA/JN.
3. **[?] JN sellable room count (20) is INFERRED** from her OOO of 107 — confirm
   with the property, and delete the override once the rooms are blocked in
   Cloudbeds.
4. **[?] $125,911.92 of JN room revenue** sits on May–Nov 2025 days with zero
   occupancy. Her report excludes it entirely; we kept it with zero inventory so
   the difference stays visible. Needs a business ruling.
5. **[ ] KE transient/lease split** — YTD −15.9% transient / +3.8% lease with the
   total agreeing to 0.3% looks like dollars moving between buckets, not capture
   timing. Probe with the KE key over ~5 past dates.
6. **[ ] On-the-books 7-day grid never validated** against her figures — future
   days post no transactions, so it still uses the dataset-3 path.

> **Pickup — 07/28/26 (session 3). DESIGN REDESIGN APPLIED APP-WIDE — BUILT &
> VERIFIED LOCALLY, ⚠️ NOT COMMITTED, NOT DEPLOYED.** The Claude-design output came
> back and is now implemented across every surface. Working tree is **DIRTY**
> (34 modified + 4 new files, +1713/−1283) on `claude/nifty-thompson-ts8zny`.
>
> **▶ START HERE NEXT SESSION:**
> 1. **Look at it in a browser, light AND dark.** Dark mode was verified only via
>    the emitted CSS + served HTML, never visually. `npm run build && npx next start`,
>    log in, toggle the Dark/Light button in the top bar. Check the wide tables
>    (/report OTB, /ops by-property) don't scroll the page body.
> 2. **Then commit + push + deploy.** Nothing is committed yet — a `git checkout`
>    would destroy the whole redesign.
> 3. Carry-overs still open from session 2: verify `/ops` §6–8 + `/report` on prod;
>    **ask Elise about the 15 empty views**; the two ops findings (952/3,299 calls
>    unanswered; "unknown" = 424/472 cancellations).
>
> - **[x] Design source of record:** `Property management dashboard system/Stayable
>   Operating Dashboard.dc.html` (+ `support.js`) — the design-tool export Kyle got
>   back from the prompt sent 07/27. **UNTRACKED in git — keep the folder**, it is
>   the spec every value below was transcribed from.
> - **[x] Token foundation.** `app/globals.css` now holds the ONLY palette in the
>   app: a light `:root` set and a `[data-theme="dark"]` set (canvas / surface /
>   surface-2/3 / line / line-strong / txt / txt-2/3 / navy / blue / sky / gold /
>   pos+bg / neg+bg / warn+bg / chrome+text+line / shadow). Written as
>   space-separated **RGB channels** so `bg-surface/60` alpha modifiers still work.
>   `tailwind.config.ts` maps them to semantic names and sets
>   `darkMode: ["class", '[data-theme="dark"]']`.
> - **[x] NO default Tailwind palette classes remain** anywhere in `app/` or
>   `components/` — `slate-*`, `amber-*`, `emerald-*`, `red-*`, `orange-*`,
>   `purple-*`, `yellow-*` are all gone (grep returns zero). Done as two scripted
>   ordered-regex sweeps + hand fixes, not by hand-editing 30 files.
> - **[x] IBM Plex Sans** self-hosted via `next/font/google` (no runtime request to
>   Google), plus a pre-paint inline script in `app/layout.tsx` that reads
>   `localStorage.sd_theme` so a dark-mode user never gets a white flash.
> - **[x] New shared primitives — `components/ui.tsx`.** Card/CardHead, Label, Kpi,
>   KpiNavy, MiniStat, Chip/DeltaChip/PointChip, Bar, StatusDot, `occColor`,
>   SegTrack+`segButton`, `thClass`, TableScroll, PageHead, `chromeButton`,
>   `surfaceButton`, SectionTitle, Rail+`railRowClass`, FreshnessStrip, Notice.
>   **Use these before writing new markup.** Also new: `components/ThemeToggle.tsx`,
>   `components/NavLinks.tsx`, `components/ControlBar.tsx`.
> - **[x] Chrome rebuilt.** 56px navy top bar: lowercase `stayable` + gold dot,
>   pill nav with an **active-page state** (`NavLinks` is a client child purely for
>   `usePathname`), role name/title derived from the PIN level, theme toggle, log
>   out. Nav stays a server component reading the auth cookie.
> - **[x] Period controls de-duplicated.** They used to be rendered **5× down
>   `/ops`** and again per per-user page; now there is ONE sticky `ControlBar`
>   under the nav (`top-14`), and `<ControlBar standalone>` (`top-0`) for `/elise`,
>   which has no chrome. Section scroll anchors moved to `scroll-mt-32
>   lg:scroll-mt-28` to clear the taller sticky stack.
> - **[x] Surfaces restyled:** `/login` (navy gradient + glass PIN card) · `/`
>   (navy arrivals hero w/ per-property split bar, rooms-in-house card, at-a-glance
>   grid, property cards w/ dot+bar) · `/report` (rail w/ per-row occupancy bars,
>   KPI row, revenue-vs-LY card w/ MTD/YTD segmented + two-tone bars, leaderboard
>   w/ sparklines, area-filled trend, OTB matrix w/ sticky metric column,
>   methodology accordion, 3-tier availability legend) · `/ops` + `/rob` `/monica`
>   `/crystal` `/bea` `/elise` `/test` (PageHead, rails, tiles, tables, forms).
> - **[x] Verified:** `tsc` clean · **170/170 tests pass** · `next build` green ·
>   production server started and **all 8 gated surfaces fetched 200** with no error
>   boundaries · both token blocks + the self-hosted woff2 + every arbitrary
>   utility (`text-[10.5px]`, `repeat(auto-fit,minmax(168px,1fr))`, the inset ring,
>   `max-w-[1560px]`) confirmed present in the built CSS.
> - **[x] Two DELIBERATE departures from the mock (don't "fix" these):**
>   1. The mock's **global property-scope dropdown was not built** — this app has no
>      global scope state, each surface owns its own filters. Adding one would mean
>      inventing state that doesn't exist.
>   2. **Home keeps its section rail** instead of the mock's Properties|Zones
>      segmented toggle — dropping the rail would lose working navigation.
> - **[x] No fabricated comparisons.** The mock puts a delta chip on every tile;
>   chips were wired ONLY where a real last-year figure exists. The portfolio KPI
>   row on `/report` intentionally has **none**, because the "Revenue vs. last year"
>   card below it is scoped differently (excludes JN) and two differently-scoped
>   deltas would read as a contradiction.
> - **[x] On-navy literals are intentional.** `text-white` and the hex set
>   (`#7FA8DA`, `#12386B`, `#8FB3DD`, `#6E96C9`, `#5C82B4`, `#2A5C9E`, `#9FC2E8`,
>   `#FF9BAA`, `#0A7FD1`, `#062B5C`, `#04305C`) only ever sit on navy chrome or the
>   login gradient, which are navy in BOTH themes — straight from the design source.
>   Everything else is a token.
> - **[ ] Not done / open from this session:**
>   - **Visual check in a browser (light + dark)** — the one real gap.
>   - Dropped one unverifiable line of mock copy ("PIN rotates monthly") from the
>     login card; PINs are changed via `ChangePin`, not on a schedule.
>   - ESLint is not configured in this repo (`next lint` prompts for setup), so
>     lint was skipped — only `tsc` covers the new code.
>   - Pre-existing typecheck error in `lib/ops-pdf-ooo.test.ts` (fixture missing 4
>     `DashboardData` fields) STILL there — confirmed pre-existing against a clean
>     tree, deliberately untouched.
> - See memory `design-system` for the rules that now hold repo-wide.
>
> **Pickup — 07/27/26 (session 2). ELISE ENRICHMENT + /report POLISH SHIPPED;
> DESIGN PROMPT SENT.** Commits `2556a62` (Elise data layer), `bf3eb60` (/ops §6–8
> + Tour→Lease fix), `954a6b0` (/report polish), `2dc46d3` + `1aa3142` (merged
> design prompt). All pushed, working tree CLEAN; 170 tests pass; clean build
> verified locally against live data.
>
> **▶ START HERE NEXT SESSION:**
> 1. **[x] DONE 07/28 — design output adapted into the app** (see the session-3
>    block above). Prompt lived at `docs/prompts/dashboard-design-prompt.md`; the
>    returned design is `Property management dashboard system/`.
> 2. **Verify on prod** — `/ops` §6–8 render; `/report` freshness stamp reads
>    "8 of 8", sparklines, YoY MTD/YTD toggle, Methodology panel; confirm the next
>    daily Teams card carries the methodology line.
> 3. **Ask Elise about the 15 empty views** (list below) — the only thing blocking
>    Renewals / Evictions / Maintenance-Turns.
> 4. **Two operational findings for Ops/Leasing to chase:** 952 of 3,299 calls
>    unanswered (last 30d); "unknown" is the largest cancellation reason (424/472).
>
> **Gotcha worth remembering:** `cat file | clip` CORRUPTS non-ASCII (UTF-8 →
> `┬╖`). Use PowerShell `Get-Content -Raw -Encoding UTF8 | Set-Clipboard` and
> verify. Also: `pkill -f "next start"` does NOT reliably kill the local server on
> Windows — a stale process kept serving an old build and made a smoke test report
> stale numbers. Use `Get-NetTCPConnection -LocalPort 3000` + `Stop-Process`.
> - **[x] Monica's rulings (via Kyle 07/27): M1/M2/M3 all TRANSIENT.** Employee
>   Weekly counted in transient nights AND revenue because it is paid. Our code
>   already did this → classifier VALIDATED, no change. M4 (annual year-end file)
>   explained; recommendation is to use OUR daily captures and skip the hand-off.
> - **[x] Elise enrichment (11 metrics, PII-free).** `elise_metric_daily` +
>   `fetchEliseEnrichment` + `/ops` §6 Leasing insights, §7 Voice AI, §8 AI
>   performance. 35,503 rows, all 8 props, 2025-12-28→. Backfill:
>   `node scripts/elise-enrichment-sync.mjs`.
>   - **BLOCKED at source — only 15 of 30 shared views hold ANY rows.** RENEWALS,
>     DEMAND_NOTICES, WORK_ORDERS, SOURCE_WORK_ORDERS, TURNS, INSPECTIONS,
>     MAINTENANCE_ASSETS, PAYMENT_PLANS, PROMISES_TO_PAY, DELINQUENCY_SUMMARY,
>     RESIDENT_SURVEYS, PROSPECT_TOUCHPOINTS, AMENITIES are all EMPTY → the
>     Renewals / Evictions / Maintenance-Turns sections CANNOT be built from
>     Elise. RESIDENTS holds only Future/Cancelled/Applicant (no current
>     residents) → resident-movement dropped rather than shipped hollow.
>     **OPEN: ask Elise whether these are unused or not syncing.**
>   - No YoY on Elise data — the share starts 2026-01-13.
> - **[x] /report polish (all 5 items).** Freshness stamp (green/amber, last
>   captured day + properties + last write); per-property 30-day occupancy
>   sparklines (leaderboard column + drill-down); YoY MTD/YTD toggle with
>   per-property Δ badges; METHODOLOGY as ONE exported constant rendered by page
>   + .xlsx + .pdf and referenced by the Teams card (parity pinned by 8 tests);
>   Teams card gains a stale-data warning.
> - **[x] Bugs fixed this session:** (a) `cancel_reason` over-counted 3x (reason
>   is stamped on every later event — now scoped to `prospect_canceled`: 472 vs
>   funnel 480); (b) **PRE-EXISTING, was live: Leasing showed "Tour → Lease
>   148.4%"** — Elise records attendance for only 23.3% of booked tours, so
>   leased/attended broke 100%. Now over tours BOOKED (34.6%) with the capture
>   rate surfaced; (c) freshness stamp read "8 of 1" (denominator counted only
>   key-configured properties) → now `propertiesExpected`.
> - **[x] Design prompts MERGED to one** (`2dc46d3`): `docs/prompts/dashboard-
>   design-prompt.md`, refreshed for /ops §6–8 + the new /report elements, palette
>   conflict resolved to brand navy #041E42. ASCII fallback `1aa3142`. SENT by Kyle.
> - **DEFERRED / HELD (not blocking):**
>   - K3 security re-issue (all 8 CB keys without Guest scope) — HELD by Kyle;
>     no leak (app never calls guest endpoints), revisit when he has time.
>   - LY *revenue* exact-match from Monica's files (~0.2% off) — optional.
>   - **M4 CLOSED as "use our captures":** forward LY comes from our own daily
>     capture-once snapshots, not Monica's year-end file. Recommendation given and
>     accepted in principle; re-import her file only if a real mismatch appears.
>   - `Occupancy Report/` (869 files, ~2.0 GB) is gitignored — needs Git LFS if it
>     should ever be versioned.
>   - Pre-existing typecheck error in `lib/ops-pdf-ooo.test.ts` (missing
>     DashboardData fields in a fixture) — untouched, tests still pass.
>
> **Pickup — 07/27/26. BOTH storage-verification items DONE.** Snapshot store is
> healthy; the classifier audit found ONE material gap + several review items.
> New tool shipped (`ff88917`): `getRatePlanInventory` + `GET
> /api/cron/rate-plans?start=&end=` (CRON_SECRET, read-only, not scheduled).
>
> - **[x] Snapshot health — CLEAN.** Neon `report_daily_snapshot`: 4,616 rows,
>   8/8 props, 2025-01-01 → 2026-07-31 (577 rows each, complete daily).
>   **Gap detector `?days=30` → totalMissing: 0.** Last 14 days: all 8 props
>   non-zero on transient / lease / OOO / revenue every day. Daily cron ran
>   07/25, 07/26, 07/27 at 10:01 UTC, 8 rows each (yesterday); 07/24 was the
>   4,592-row backfill. All zero-count days are explained: DP 2025 Jan–May
>   (pre-CB), JN 2025-05→2026-03 (the ~0-occ property), and 5 FUTURE days
>   (Jul 27–31) that carry inventory+OTB revenue but no counts. Future rows are
>   inert for MTD/YTD (`getRevenueReportInputs` reads stored days only through
>   `asOf-1`, then adds a live today) and the cron will fill them as stubs.
> - **[x] Rate-plan classifier audit (all 8, YTD 2026-01-01→07-27) — CLASSIFIER
>   VALIDATED, NO CHANGE NEEDED.** 57 distinct plan strings; portfolio Room-Rate
>   revenue $3,419,899. Three plans escalated to Monica; she ruled **all three
>   TRANSIENT** (via Kyle 07/27), matching what the code already does:
>   - `Discounted Monthly Rate` $56,467 (6 props) → **transient** ✓
>   - `Discounted Weekly Rate` $458,300 (all 8) → **transient** ✓
>   - `Employee Weekly Rate` $45,189 (7 props) → **transient**, counted in BOTH
>     transient nights and transient revenue **because they are paid** ✓
>   So `classifyForReport` is correct as written and the 0.09% reconciliation
>   stands. Do NOT add monthly/weekly *rate* keywords. (The `lib/lease.ts`
>   divergence — weekly-rate = lease-weekly — is intentional and applies only to
>   the in-house lease-mix widget, never to the report or banked snapshots.)
>   - **Multi-plan strings are nights-only.** Every comma-joined plan has $0
>     revenue — dataset-1 carries the single plan at transaction time, dataset-3
>     carries accumulated plan history. So revenue classification is clean;
>     only NIGHTS are exposed to the comma-join/precedence trap.
>   - **Data hygiene (Cloudbeds-side, cosmetic):** 3 whitespace variants of
>     "Book Direct and Save - Refundable (24-Hour Cancellation)", 2 of
>     "Refundable (24-Hour Cancellation)" (one trailing TAB), a plan literally
>     named `-` ($22, JN+KE), and `Special Weekly/Daily Rate due to Wildfire` (JW).
> - **(carry) Annual exact-LY:** forward captures are CB-derived (capture-once
>   freeze), not Monica-frozen — for an EXACT prior year, re-backfill from her
>   year-end file each January (`backfill-counts-from-monica.mjs`).
>
> **Checkpoint — 07/25/26 (cont.).** Durable source-of-truth hardening + overhaul prompt.
> All pushed (`629aff5` latest, branch claude/nifty-thompson-ts8zny).
> - **[x] Snapshot store hardened** (`629aff5`) — Neon report_daily_snapshot is now
>   the source of truth going forward:
>   • **Capture-once freeze** (`bankDailySnapshot`): daily cron freezes a day once
>     banked with real counts; fills only still-empty (count=0) stubs, never
>     overwrites a real capture → drift-proof history.
>   • **Gap detector** (`findSnapshotGaps`): flags active property×day with no REAL
>     occupancy capture (missing row OR revenue-only stub). Route `GET
>     /api/cron/gaps?days=30` (CRON_SECRET) + folded into daily revenue-report cron
>     response (`gapsLast14d`). Verified vs Neon: 0 false positives, fires on stubs.
> - **[x] Year-rollover answered:** data auto-fills forward (cron banks yesterday
>   daily; 2027 this-year accrues, 2026 becomes LY automatically). No new build for
>   accumulation/storage. Caveats: forward counts are CB (not Monica-frozen) — for
>   exact LY, re-backfill from Monica's year-end file annually; cron reliability +
>   key longevity matter (gap detector now catches misses).
> - **[x] Full DASHBOARD OVERHAUL prompt** drafted for Claude design (whole app, not
>   just /report) — scratchpad `dashboard-overhaul-prompt.md` (Stayable palette baked
>   in). HELD for Kyle to run; adapt output back into app after.
> - **[x] Cloudbeds key expiry — RESOLVED (Kyle 07/25): NO hard expiry.** Keys only
>   lapse after ~30 days of INACTIVITY; the daily cron keeps them alive. So no
>   silent-death risk under normal operation. (memory `cloudbeds-auth` corrected.)
> - **[x] Snowflake share audit** — 30 views, only 2 used (see prior entry / memory).
>
> **Checkpoint — 07/25/26.** Revenue-report accuracy + Rob's YoY + brand.
> All code committed & pushed (`6954621` latest, branch claude/nifty-thompson-ts8zny).
> - **[x] Rob's YoY revenue** shipped (`e23d63e`): /report overview MTD/YTD This
>   Year / Last Year / Δ% cards + toggleable **dark/light-blue** grouped-bar chart.
>   2025 revenue backfilled (2,920 rows, CB Room-Rate). JN excluded, DP noted.
> - **[x] Revenue VALIDATED vs Monica's 7/23 report** — same-date YTD **+0.09%
>   portfolio**, ≤~0.8%/property (see RevenueReconciliation_Stayable_072426.xlsx).
> - **[x] Revenue txn-type RESOLVED = "Room Rate" only** (reverted the "Room
>   Revenue" add `caccfaa`→`65aad1a`; it overshoots Monica +2.5-3.3%). Cancelled
>   auto-excluded ($0 room-rate). ADR = room rate only.
> - **[x] BOTH years' occupancy COUNT cells backfilled from Monica's frozen files**
>   (count-only, validated EXACT vs her summary): 2026 Jan1–Jul20 (1,608 rows) +
>   **2025 LY full-year (2,920 rows)**. So MTD/YTD + Last-Year Occupied/Transient/
>   Lease/%Occ/OOO/ADR now populate on /report. KEY: read "Block C" (target year in
>   idx2, the settled copy). Scripts: parse-monica-counts.py + backfill-counts-from-
>   monica.mjs (re-run each new Monica file). See memory monica-revenue-methodology.
> - **[x] Accuracy finding:** historical DAILY figures are point-in-time (drift from
>   CB re-query via rate-plan reclassification); MTD/YTD + live "yesterday" accurate.
> - **[x] Monica methodology confirmed + doc** (outputs/RevenueReportMethodology_
>   Stayable_072426.md — mirror its Sources/Notes/Legend onto /report, still TODO).
> - **[x] Stayable brand colors app-wide** (`a88a25e`): ink #041E42 navy, accent
>   #0091F5, +skyLight #91D1FA, gold #FDDA24 (from rentstayable.com).
> - **[x] Log Out nav + loading overlay** (`5a9d018`); **/report active for all
>   users** (elise excluded by design); /report redesign (`7e2a147`).
> - **[x] Snowflake share AUDITED** (scripts/snowflake-introspect.mjs): 30 views
>   exposed, dashboard uses only 2 (leasing funnel + pipeline).
> - **NEXT / PARKED (Rob-facing + ops):**
>   1. (opt) LY *revenue* exact-match from Monica's files (currently CB, ~0.2% off).
>   2. **Elise data** — enrich Leasing (lead source / AI-booked % / tour no-show /
>      cancellation reasons — same 2 views) → new sections: Renewals, Evictions
>      (`DEMAND_NOTICES`, overlaps Smartsheet), Maintenance/Turns, Voice-AI. PII =
>      GROUP-BY at Snowflake only.
>   3. /report polish: Monica footer, freshness stamp, per-property sparklines,
>      YoY MTD/YTD toggle + Δ labels, export/Teams parity.
>   4. **Confirm `TEAMS_FLOW_URL` set** in Vercel (daily Teams card still no-ops
>      until then — carried from 07/23).
>   5. Standing security: re-issue all 8 CB keys WITHOUT Guest scope.
>
> **Pickup — 07/24/26.** Post-deploy session: P1/P2 done, /report redesigned,
> revenue methodology VALIDATED against Monica, one revenue fix identified.
> - **[x] P1 `TEAMS_FLOW_URL`** set in Vercel + redeployed (Kyle).
> - **[x] P2 revenue backfill** ran Jan→Jul, 8 props, **1,696 rows** (via
>   `scripts/run-backfill.mjs`, reads `CRON_SECRET` from `.env.local`).
> - **[x] P4 reconciliation vs Monica** — `outputs/RevenueReconciliation_Stayable_
>   072426.xlsx`: YTD Room Revenue matches **within ~1%/property, +0.2% portfolio**.
>   Transient/lease split differs 1–4% = her Yardi legacy blend on history (expected).
> - **[x] Monica methodology CONFIRMED** (call `Revenue Report Automation.vtt` +
>   direct Q&A): lease=Monthly+Weekly rate plan · **revenue = "rate and revenue"
>   codes only** · ADR room-rate-only · OOO vs Other blocks · 7-day OTB · Yardi→CB
>   at 2025. See memory `monica-revenue-methodology`.
> - **[x] REVENUE transaction-type RESOLVED — stays "Room Rate" only.** A probe
>   found a distinct "Room Revenue" type (~2.5% of Room Rate, DP YTD $17,168).
>   Briefly added it (`caccfaa`) then REVERTED: per-day ground truth shows
>   Room-Rate-only matches Monica's DP YTD to **−0.09%**, while rate+revenue
>   overshoots **+2.5–3.3%**. Monica's "rate and revenue" = her Excel column
>   *titled* "Room Revenue" fed by room-RATE txns (wording trap). No re-backfill
>   needed — existing backfill (Room Rate) is correct. See memory
>   `monica-revenue-methodology`.
> - **[x] /report REDESIGNED & pushed** (`7e2a147`): nav rail (All + 8 props) →
>   "All" shows portfolio KPI tiles + clickable leaderboard; per-property = KPI
>   tiles + Actual/On-the-Books toggle + that one detailed table. No more 16
>   stacked tables; Excel/PDF unchanged. Also shipped (`5a9d018`): global **Log
>   Out** in top nav + route-transition **loading overlay**.
> - **[ ] Verify on prod (Kyle):** new `/report` overview + drill-down; Log Out on
>   every page; loading overlay on nav. Then optionally run the revenue fix above.
> - **(held)** fuller Claude-design `/report` mock — prompt saved (scratchpad
>   `report-redesign-prompt.md`).
>
> **Pickup — 07/23/26: SHIPPED & DEPLOYED to production** (`dpl_3WDWRT7k…`, commit
> `d0d0f52`, READY, serving dashboard.rentstayable.com; all routes smoke-checked
> 307→/login). Live now: revenue report → Teams (+ backfill route + partial-cell
> blanking), role-based login, `/elise` (ELISE pin), 4 Ops category PDFs
> (occupancy/ooo/leasing/reviews), OOO Out-of-Order/Other/Total breakdown.
> **REMAINING (Kyle):** (1) set `TEAMS_FLOW_URL` in Vercel (Prod, Sensitive) →
> redeploy so the daily Teams card posts (until then it no-ops, no crash);
> (2) run the revenue backfill in monthly chunks: `GET /api/cron/backfill-revenue?
> start=&end=` with the `CRON_SECRET` bearer, Jan→Jul, to fill MTD/YTD revenue;
> (3) verify on prod: login nav, `/report` 8 props, OOO breakdown vs Bea's 35,
> "X of 8 reporting" header, `/elise` with ELISE pin. Then drop prod
> `/report/latest.xlsx` + Monica's 7-21 report in `outputs/` for the full compare.
>
> **(superseded) 07/22 pre-deploy pickup:** REVENUE/OCCUPANCY REPORT → TEAMS built
> (11 tasks, review clean).** Recreates Monica's daily
> report from Cloudbeds; gated `/report` page + `/report/latest.xlsx|pdf`; daily
> cron (`/api/cron/revenue-report`, 10:00 UTC) persists a daily snapshot, builds
> the report, and POSTs an Adaptive Card to Teams via the Power Automate flow
> (`TEAMS_FLOW_URL`). MTD/YTD accumulate from Neon `report_daily_snapshot` going
> forward (revenue exact; counts fill over time; LY null until a year banks).
> Lease/transient by rate plan (`classifyForReport`: monthly/weekly lease + long
> term = lease). 108 vitest tests, build green, whole-branch review = ready to
> merge. Spec `docs/superpowers/specs/2026-07-21-…`, plan `…/plans/2026-07-22-…`.
> **NEXT (Kyle / Task 12):** `git push`; set `TEAMS_FLOW_URL` (+ optional
> `PUBLIC_BASE_URL`) in Vercel (Production, Sensitive); deploy; open `/report`
> (MAIN pin) to verify all 8 properties; Vercel → Cron Jobs → Run `revenue-report`
> → expect a card in Test Channel + `{ok:true,status:202}`. Then compare to
> Monica's report for 2–3 properties. Open follow-ups: KE adjusted-% distortion
> during the snapshot fill phase; one-time historical REVENUE backfill (optional).
>
> **Prior pickup:** Branch `claude/nifty-thompson-ts8zny` — all
> pushed (`40a5f5a`). **LIVE & DEPLOYED at `dashboard.rentstayable.com`**.
> Build green; **89 vitest tests pass** (16 files). Only untracked file:
> `outputs/EliseDataAccess_Email_070226.md` (unrelated prior-session draft; left
> out of commits by design).
>
> **Session 07/09/26 — HOME §4 ZONES + HOME GATED BY `MAIN` (shipped, deployed,
> verified live).** Two commits: `899cdce` (Zones + gate) and `40a5f5a` (legend
> tweak). Both deployed to production (`dpl_7tMGiz…` READY, aliased to the custom
> domain).
> - **§4 Zones (home `/`)** — new section, **tabbed per property** (mirrors the
>   Detail tab pattern; nav item #4 "Zones"). Rooms grouped into buildings/zones
>   from **`ROOM-ZONING.md`** → `config/zones.ts` (`ZONE_CONFIG` keyed by CODE;
>   inclusive ranges; KW parity-split). Pure logic `lib/zones.ts`
>   (`zoneForRoom`/`buildZoneGroups`, unit-tested). Unmatched rooms → "Other".
>   Room chips **colored by live status** + Legend: **blue = Occupied · white =
>   Vacant · yellow = OOO**. Per-zone counts + CSV/PDF export.
> - **Data path:** `getPortfolioRooms(asOf)` in `lib/cloudbeds.ts` →
>   `getRoomsWithStatus` = getRooms (names) + getRoomBlocks (OOO overlay) +
>   **per-room occupancy**. Occupancy is **PII-FREE**: DI Reservations dataset 3
>   grouped on `room_numbers` + `reservation_status="In-House"`, measure
>   `room_count`, filter checkin≤asOf≤checkout, `details:true`. `room_numbers`
>   match getRooms `roomName` exactly (Davenport 114/114). Probe:
>   `scripts/probe-room-occupancy.mjs`. New component `components/ZonesSection.tsx`.
>   See memory `room-zones-and-occupancy`.
> - **Home `/` NO LONGER PUBLIC** — gated at `base` level by PIN **`MAIN`** (Neon
>   `dashboard_pins`, seeded via `scripts/seed-pins.mjs base=MAIN`). `middleware.ts`
>   no longer short-circuits base routes; `canAccess` now lets ANY authed level see
>   the shared home (keeps per-user "← Dashboard" back-link working); `api/cron`
>   added to matcher exclusions so the Elise cron still runs (self-checks
>   CRON_SECRET, no cookie). `findLevelByPin`/seed `LEVELS` include `base`.
>   Verified live: `/` → 307→/login, wrong PIN → 401, `MAIN` → 200. See memory
>   `home-gated-by-main-pin`. **Current PINs:** base=`MAIN`, exec=`STYBLCEO`,
>   crystal=`CRYSTL`, monica=`MONICA`, bea=`BEAOPS`, ops=`OPERATIONS`.
> - **Open follow-ups:** (a) **Distribute the `MAIN` PIN** to anyone who used the
>   home without a PIN — they now hit the login wall. (b) KW/JW/DP wing→zone
>   assignments are inferred from unlabelled floor maps (flagged provisional in
>   the UI) — confirm on-site to lock them in `config/zones.ts`. (c) Zone occupancy
>   overlay is "today" (asOf=range end) — make range-aware only if asked.
> - **Note:** during cleanup I accidentally killed a SEPARATE app the user had on
>   port 3000 (a RISE8 marketing dev server) — restartable, not this repo.
>

> **Session 07/08/26 — LEASING §2 SHIPPED, DEPLOYED & VERIFIED (EliseAI → Neon).**
> Reader Account provisioned by Steph; connected, schema mapped, funnel built,
> committed (`0dddf30`), pushed, and **LIVE on production** (deploy
> `dpl_9k7Hrp…`). Cron endpoint verified **401 with a wrong bearer** → route live
> + `CRON_SECRET` enforced. `SNOWFLAKE_*` + `CRON_SECRET` env vars set in Vercel
> (Production). `/ops` §2 renders from the already-backfilled Neon data.
> - **What shipped:** `/ops` §2 Leasing is now LIVE (was a placeholder). Funnel
>   Leads→Engaged→Tours(booked/attended)→Apps(started/approved)→Leased + Lead→Tour
>   / Tour→Lease conversion tiles + Cancelled + current pipeline snapshot
>   (Inquiry/Applicant/Leased/Cancelled) + per-property table + CSV/PDF export.
>   Per-property/All toggle + PeriodControls (windowed by event date).
> - **Data path:** nightly PII-FREE aggregate sync Snowflake→Neon. `PROSPECT_EVENTS_
>   RISE8` (funnel) + `PROSPECTS_RISE8` (snapshot), GROUP BY at the Snowflake
>   boundary — no name/email/phone leaves the warehouse. New: `config/elise.ts` +
>   `config/elise-buildings.json` (building→Stayable map), `lib/snowflake.ts`,
>   `lib/elise-sync.ts`, `lib/leasing.ts` (12 unit tests), `lib/db.ts` funnel
>   read/write, `components/LeasingSection.tsx`, `scripts/elise-sync.mjs` +
>   `scripts/snowflake-probe.mjs`, Neon tables `elise_funnel_daily` +
>   `elise_pipeline_snapshot` (db-init), `app/api/cron/elise-sync` + `vercel.json`
>   (daily 12:00 UTC). **82 vitest tests pass; prod build green.**
> - **Backfill already ran against the SHARED Neon** (same DATABASE_URL local+prod)
>   → 8,134 funnel rows + 32 snapshot rows. So `/ops` renders leasing immediately
>   on deploy (verified: last-30 ALL = 2,256 leads / 142 leased).
> - **OPEN follow-ups (optional, non-blocking):**
>   1. **Prove the prod sync end-to-end:** Vercel → Project → Settings → Cron Jobs
>      → **Run** on `elise-sync` (injects the real secret). Expect
>      `{ok:true, funnel:~8134, snapshot:32, skipped:0}`. Can't trigger from CLI
>      (no secret value locally); Claude can confirm the result after Kyle runs it.
>   2. **TZ CAVEAT (verify):** funnel windows by Elise `EVENT_DATETIME::DATE`
>      (TIMESTAMP_NTZ, tz unconfirmed) — NOT tz-converted to Eastern. Day-boundary
>      ±1 possible. Check one property vs a known Elise report; add
>      `CONVERT_TIMEZONE('UTC','America/New_York',…)` in lib/snowflake.ts +
>      scripts/elise-sync.mjs and re-sync if it's UTC.
>   3. **Password expiry:** the reader-account pw rotates on Elise's schedule →
>      sync breaks until updated in Vercel. Consider asking Elise for key-pair
>      (RSA) auth to make it permanent.
> - **Backfill note:** local `node scripts/elise-sync.mjs` already populated the
>   SHARED Neon (8,134 funnel + 32 snapshot rows), so leasing renders now; the
>   nightly cron just keeps it fresh.
>
> **Follow-up timing (SUPERSEDED 07/08):** the 07/09–07/10 Elise chase is moot —
> account is provisioned and working. No follow-up needed. Prior open verify item
> still stands:
>
> **Next action:** verify the deployed `/ops` (PIN `OPERATIONS`) §5 **1-Star
> Reviews** renders live — count + Manager Responded + per-property collapsibles +
> the NEW **prior-vs-current trend bar chart**; set & save a date window (persists
> to Neon, shared) and confirm both segments re-pivot. Reviews/evictions can't
> render locally (no `SMARTSHEET_API_TOKEN` in `.env.local`).
>
> **Session 07/01/26 — reviews trend chart shipped (`0fe7ff0`, `76dc633`).** §5
> now charts each property's 1-star count for the locked window vs. the EQUAL-
> LENGTH window immediately before it (7d→prior 7d, 14d→prior 14d; self-scaling
> via `priorWindow` in `lib/dates.ts`). `buildReviewsView` (`lib/reviews.ts`) gains
> `priorCount` per property + `priorTotal`/`priorFrom`/`priorTo`; properties in
> EITHER window are included so a drop-to-zero still shows its prior bar. New
> `ReviewsTrendChart` in `ReviewsSection.tsx` = **vertical grouped bars** (prior =
> solid `slate-400`, current = `accent` blue) + per-property ▼/▲ delta badges +
> portfolio prior→current line; scrolls horizontally on overflow. +4 unit tests.
>
> **Session 07/01/26 — EliseAI access clarified (see memory `elise-data-share`).**
> Elise's "Reporting API" is a **Snowflake Data Share, NOT a REST API.** We're a
> non-Snowflake shop → we get a **Snowflake Reader Account** (free; Elise
> provisions login + db). **Decision (Kyle): nightly aggregate sync → Neon** —
> a daily job runs PII-free GROUP-BY SQL against Snowflake, writes funnel rollups
> (leads→engaged→tours→apps→leases per property/period) into Neon; dashboard reads
> Neon. PII (names/emails/phones/transcripts/recordings) NEVER enters our app.
> Leasing §2 source = `events_leasing` + `prospects` + `calendar_events`.
> **BLOCKER:** Kyle to request the Reader Account from EliseAI and obtain
> connection details (account locator, username, temp password, database name,
> warehouse). Also need Elise↔Stayable property-ID map (8 properties). Nothing
> builds/tests until provisioned.
>
> **Open / next:** (a) Leasing §2 still BLANK — Snowflake Reader Account
> provisioning is the blocker (above); (b) §3 Lease-vs-transient still pending DI
> Reservations scope; (c) security re-issue all 8 Cloudbeds keys WITHOUT Guest
> scope (works ≠ correctly scoped); (d) reviews fetch scans ~7k rows/req (cached
> 10 min) — leaner later if needed.
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
>   5. **1-Star Reviews** — LIVE (session 06/30/26). Source: Smartsheet **"Review &
>      Feedback Tracking"** sheet `4932316188436356` via `getOneStarReviews`
>      (`lib/smartsheet.ts`), filtered to Rating==1 (stored "1.0"). Shows **count**
>      + **Manager Responded count** + **collapsible per-property** tables
>      (Review/Feedback · Source · Manager Response). **Lockable date window**
>      persisted in Neon `app_settings` key `ops_reviews_window` (shared, applies
>      to all viewers; set+save via `/api/reviews-window`, ops/exec only; defaults
>      to last 30 days until saved). Column-restricted read — **no Reviewer Name /
>      PII**. Builder `lib/reviews.ts` (7 unit tests). See memory `one-star-reviews`.
>   - Build green, 66 tests pass; smoke-tested authed (`OPERATIONS` → `/ops`, all 5
>     sections; save API 200 authed / 401 unauthed). Reviews+evictions degrade
>     locally (no token in .env.local) but render live on Vercel.
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
