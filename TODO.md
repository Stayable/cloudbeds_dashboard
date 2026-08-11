# TODO — Cloudbeds Dashboard

Status legend: `[ ]` open · `[~]` in progress · `[x]` done · `[?]` needs decision

---

## 08/11/26 (session 9n) — MCP SERVER BUILT: 9 OF 10 TASKS, LIVE AND FAIL-CLOSED

> **Pickup — 08/11/26 (ET). DEPLOYED. One env var from working.** Branch level
> with origin at **`e3dc4e4`**; every push to this branch auto-deploys as Vercel
> **production**. **583 tests**, `tsc` clean, build clean.
>
> **[x] MCP TASKS 1-9 COMPLETE AND REVIEWED CLEAN**, plus a final whole-branch
> review and its fix wave. Ten read-only tools for Rob in Claude Desktop:
> `list_properties`, `get_occupancy`, `get_portfolio_summary`,
> `get_daily_report`, `get_report_file`, `get_today`, `get_evictions`,
> `get_contractor_schedule`, `get_reviews`, `get_leasing_funnel`.
>
> **[x] LIVE VERIFICATION AGAINST PRODUCTION (08/11/26):**
> - wrong secret → **404**
> - **correct secret → 404, because `MCP_SECRET` is not set in Vercel.** That is
>   the fail-closed rule working in production: a missing env var makes every
>   request dead, never every request valid.
> - `/kb` unauthenticated → **307** (KB ship criterion, verified live)
> - `/login` → 200
> - a `*.vercel.app` deployment URL → **302 SSO wall**
>
> **[!] THE CONNECTOR URL MUST USE THE CUSTOM DOMAIN.** Vercel Authentication is
> ON for this project as `all_except_custom_domains`. `dashboard.rentstayable.com`
> is exempt; every `*.vercel.app` URL is not. Hand Rob a deployment URL and
> Claude Desktop gets an SSO page instead of an MCP response — which looks like a
> broken connector, not a protection setting.
>
> **▶ THE ONE THING BLOCKING DELIVERY — KYLE:**
> Set **`MCP_SECRET`** in Vercel → `cloudbeds-dashboard` → Environment Variables
> → **Production**. The value is in the gitignored `.secrets/mcp-secret.txt`
> (64 hex chars, never printed to chat, never committed). Then redeploy, and the
> live check above flips from 404 to a real MCP handshake. There is no Vercel CLI
> in this environment, which is why this cannot be automated.
> Then Rob gets **Name `Stayable Dashboard`** + the URL in
> `.secrets/mcp-connector-url.txt`. Leave the OAuth fields EMPTY.
>
> **[!] THE FINAL REVIEW FOUND THREE CRITICALS, ALL ON THE OUTPUT SIDE.** Its own
> diagnosis of why: *the spec is unusually good on reasoning and unusually weak on
> output contracts — every tool's inputs are specified precisely and not one
> tool's return shape is.*
> 1. **`get_daily_report` returned figures every rendered surface blanks.** When
>    `countsPartial` is true the PDF, Excel and web view all print "—"; the MCP
>    JSON printed the number. Rob would have quoted an understated YTD occupancy
>    with the PDF beside him showing a dash.
> 2. **`get_portfolio_summary` had no portfolio figure** despite its name, and hid
>    `excludeFromAggregate`, so the model would have silently included
>    Jacksonville North and probably averaged percentages instead of summing
>    nights.
> 3. **`get_contractor_schedule` forwarded the "Latest WhatsApp Update" column
>    verbatim** — crew messages that routinely name an occupant ("guest in 214
>    says the AC is out"). **This one was my miss.** I had explicitly ruled
>    contractor data acceptable as vendor names; the exposure was never the names,
>    it was the free text beside them, and my own deferral list repeated the wrong
>    framing. Same risk class `stripReviewsPII` blocks 90 lines earlier in the
>    same file.
>
> **[!] THE PLAN CAUSED MOST OF THE DEFECTS, AND THAT IS THE LESSON.** Every one
> of the nine tasks needed a fix round, and nearly all traced to my own plan
> rather than to an implementer: a mathematically wrong reference implementation
> shipped as the DEFAULT (per-day counts from period-average inventory); a brief
> that named two builders to check for PII and omitted the third, which is exactly
> why Critical 3 existed; a portfolio aggregate promised in the spec table and
> never specified; and a Task 9 that built the freshness guarantee and quietly
> dropped the output-PII half. **A detailed plan makes implementation fast and
> carries its defects in verbatim. The review loop is the only thing that caught
> them.**
>
> **[x] Also fixed along the way, unrelated to MCP:** two `lib/db.ts` queries had
> no `try/catch` and would have crashed `/report` on a dead database; a PII regex
> flagged the word "port**folio**"; and there is now ONE definition of
> `isValidYmd` in `lib/dates.ts` instead of two.
>
> **[?] `cloudbeds-mcp02`** — a separate Vercel project in this team from ~June.
> Nothing to do with this build. Superseded attempt worth deleting?
>
> **[~] KNOWLEDGEBASE: TASKS 1-8 COMPLETE.** Everything buildable is built.
> Task 9 (author the real corpus) is blocked on Kyle for two things, unchanged:
> the four SharePoint files (in Bea's personal OneDrive, which the M365 connector
> cannot reach), and rulings on four contradictions the website has with itself —
> check-in 3PM vs 4PM, Lakeland's email, the weekly discount %, the deposit
> amount. Website source material is captured and waiting.

---

## 08/11/26 (session 9m) — MCP SERVER FOR ROB: SPEC + PLAN + TASK 1 · KB HELD

> **Pickup — 08/11/26 (ET). NOTHING DEPLOYED. Branch pushed through `1626dc1`.**
> TWO plans are live in this repo and they are separate — do not merge their
> ledgers:
> - `docs/superpowers/plans/2026-08-11-mcp-server.md` — **1 of 10 tasks done,
>   reviewed clean; resume at Task 2, BASE `5b3fab8`**
>   (ledger `.superpowers/sdd/2026-08-11-mcp-server/progress.md`)
> - `docs/superpowers/plans/2026-08-10-knowledgebase-kb.md` — **7 of 10 done,
>   HELD** (ledger `.superpowers/sdd/2026-08-10-knowledgebase-kb/progress.md`)
>
> **[x] TASK 1 IS COMPLETE AND REVIEWED CLEAN** (`5b3fab8`). The fix round landed
> after the checkpoint was written: the tree is clean, everything is pushed, and
> the earlier "uncommitted work" warning no longer applies. **440 tests.**
>
> **[x] MCP SERVER — DESIGNED, APPROVED, PLANNED, AND THE ENDPOINT IS ALIVE.**
> Rob (CEO) will connect from Claude Desktop by pasting one HTTPS URL. Kyle's
> decisions, in order taken:
> 1. **Remote connector, nothing installed on Rob's laptop.** No repo, no Node,
>    no `.env` — and no production credential ever leaves Vercel.
> 2. **Full OAuth 2.1 → reversed to a secret in the URL.** Kyle chose OAuth
>    first, then reversed once the cost was concrete. The downsides are recorded
>    in the spec rather than glossed: anyone with the URL has full read access,
>    there is no per-user revocation, and **a second user is the trigger to
>    revisit the decision, not to forward Rob's link.**
> 3. **All four tool areas** — occupancy/revenue, the report files, live state,
>    Smartsheet + EliseAI.
> 4. **No guest PII.** The `/bea` §3 exception does NOT extend here: a secret URL
>    in a desktop app's settings pane is a weaker gate than the PIN, so the
>    weaker gate carries the less sensitive data.
>
> **[x] Task 1 shipped and PROVEN LIVE (local):** wrong secret → `404`; correct
> secret → a real MCP `initialize` naming `stayable-dashboard`. `mcp-handler`
> 2.1.0 + `@modelcontextprotocol/server` 2.0.0 + `zod` 4.4.3. 438 tests.
>
> **[!] I HAD THE MCP STACK WRONG FROM MEMORY** — corrected by reading the
> published tarball, which is why the plan is buildable at all: v2 needs
> `@modelcontextprotocol/server` ^2 and `zod` ^4 (NOT `@modelcontextprotocol/sdk`
> 1.x, which pairs with mcp-handler 1.x); **three new dependencies, not one**;
> 2.x removed SSE and Redis entirely; there is no `basePath`, which is exactly
> what makes the secret-in-the-path design work.
>
> **[!] THE PLAN'S DELIVERY STEP WOULD HAVE COMMITTED THE SECRET.** It said to
> save the connector URL under `outputs/` — which this repo versions on purpose.
> The URL **is** the credential; there is no separate token to rotate. Now a
> gitignored `.secrets/`, with the `.gitignore` change committed first and a
> `git status` check gating it.
>
> **[!] TWO PLAN-MANDATED DEFECTS IN TASK 1, both mine.** My stated constraints
> contradicted my own code, and the constraints govern — the same pattern as the
> KB phrase-ranking bug:
> 1. the secret compare returned early on a length mismatch, leaking length
>    through timing → digest both sides, then `timingSafeEqual`
> 2. `api/mcp(?:/.*)?` matches by PREFIX, so a future `/api/mcpfoo` would be
>    silently un-gated → require a segment boundary
>
> **[?] CARRIED, not yet acted on:**
> - **Every other matcher alternative has the same prefix looseness**
>   (`api/cron`, `api/submit`, `api/report-file`, …). Pre-existing; deliberately
>   NOT touched inside a task about the MCP endpoint. For the final review.
> - **The rate limiter is one global in-memory bucket**, per-instance on
>   serverless — best-effort at most, and Rob's own concurrent tool calls could
>   429 each other once tools exist.
> - **Once tools exist, send a malformed JSON-RPC body** with the correct secret
>   and confirm `mcp-handler`'s own protocol errors leak no stack trace.
>
> **[?] TASK 10 NEEDS KYLE.** There is no Vercel CLI here, so `MCP_SECRET` cannot
> be set in Production programmatically. I generate it and hand it over; Kyle
> pastes it. Then Rob gets **Name `Stayable Dashboard`** + the URL (clipboard,
> backup in gitignored `.secrets/`). Leave the OAuth fields EMPTY.
>
> **[~] KNOWLEDGEBASE — UNCHANGED, STILL HELD AT TASK 8.** Blockers are the same
> two and both are Kyle's: the four SharePoint files (in Bea's personal OneDrive,
> which the M365 connector cannot reach), and rulings on four contradictions the
> website has with itself — check-in 3PM vs 4PM, Lakeland's email, the weekly
> discount %, the deposit amount.
>
> **▶ NEXT SESSION — START HERE:**
> 1. **[ ] MCP Tasks 2-9.** ~2 hours. Task 5 is the one likely to overrun — see
>    the plan's Self-Review on `rollupToRows` reconstructing per-day counts from
>    per-day percentages.
> 2. **[?] Kyle: the four SharePoint files + the four content rulings** → KB
>    Task 9.
> 3. **[?] Kyle: set `MCP_SECRET` in Vercel** → MCP Task 10.
> 4. **[?] KB open decision:** `kb_queries` stores raw search strings, so a guest
>    name typed into the box is persisted. Accept / redact / retention window?

---

## 08/11/26 (session 9l) — KNOWLEDGEBASE `/kb`: SPEC APPROVED, 5 OF 10 TASKS BUILT

> **Pickup — 08/11/26 (ET). NOT DEPLOYED. Nothing is live yet.** Branch
> `claude/nifty-thompson-ts8zny`, local only — **not pushed**. Session ended on a
> laptop battery warning, mid-fix-round on Task 5.
>
> **Resume by reading the ledger first:**
> `.superpowers/sdd/2026-08-10-knowledgebase-kb/progress.md`. It is the recovery
> map — it names every commit, every deferred minor, and every ruling. Trust it
> and `git log` over anything remembered. Then re-enter
> **superpowers:subagent-driven-development** and continue the task loop.
>
> **[x] KB SPEC REVIEWED AND APPROVED BY KYLE (08/10/26).** The three parked
> questions are answered, and the spec records each one in place:
> 1. **Query logging — KEPT** in v1 (query text + result count, no identity).
> 2. **Markdown renderer — `marked`, NOT the hand-rolled ~100 lines.** This
>    reversed the spec's own proposal; its recorded counter-argument won. It cost
>    one line to change because the renderer was already behind a single
>    function, which was the stated reason for putting it there.
> 3. **Per-document permissions — confirmed not needed.** One visibility level.
>    The constraint is now load-bearing: nothing enters `content/kb/**` that
>    needs narrower distribution.
>
> **[x] PLAN WRITTEN** — `docs/superpowers/plans/2026-08-10-knowledgebase-kb.md`
> (`8363856`). 10 tasks, TDD throughout. Tasks 1-8 build against committed
> fixtures; **Task 9 (author the real corpus) is the only content-blocked task**
> and is what ship criterion 2 gates on.
>
> **[~] TASKS 1-7 COMPLETE AND REVIEWED CLEAN. HELD AT TASK 8** (laptop battery).
> `432/432 tests` at `6ac3b0a` (was 325 before this work). `tsc --noEmit` clean,
> `npm run build` clean with `/kb` in the route table. **All of it is PUSHED.**
> - **Task 1** `ce1a08f` — `lib/kb-parse.ts`: frontmatter + heading chunking.
>   Anchors have exactly ONE producer (`splitSections`); nothing downstream
>   re-slugifies.
> - **Task 2** `b8abdc3` — snapshot age that errs old.
> - **Task 3** `89fbb65` — `lib/kb-search.ts`: ranking, snippets, outline.
> - **Task 4** `06d5dac` — `lib/kb-markdown.ts` via **`marked` 18.0.9**.
> - **Task 5** `e7d641b` — corpus loading, fixtures, PII validator, `next.config.mjs`
>   tracing. Took TWO fix rounds; the second is the interesting one, below.
> - **Task 6** `58b97ed` — query logging. `kb_queries` DDL ran locally.
> - **Task 7** `6ac3b0a` — **the search page is built.** Three states, honest
>   no-result, `/kb` in the nav.
>
> **▶ RESUME AT TASK 8.** `.superpowers/sdd/2026-08-10-knowledgebase-kb/progress.md`
> ends with a HELD marker giving the exact next command and BASE sha.
>
> **[!] FIVE REAL DEFECTS THE REVIEWS CAUGHT, all of which would have shipped:**
> 1. **An unclosed code fence silently swallowed every later heading** — a single
>    missing ``` in a non-engineer-authored SOP would have removed real sections
>    from search with no signal. Now throws, naming the file.
> 2. **`2026-02-30` rolled to March 2 and UNDERSTATED age.** It passed the
>    shape-only `YYYY-MM-DD` regex. Three places each had their own idea of a
>    valid date; they now share one round-trip predicate.
> 3. **The phrase-ranking bonus used a bare `.includes`**, so a heading "Chart
>    data" won the top tier for the query "art". **This one was mandated by my
>    own plan** — the plan's stated constraint says "exact phrase", so the
>    constraint governed and the code snippet was the defect.
> 4. **`[click me](javascript:alert(1))` rendered as a live link.** HTML-escaping
>    cannot see it: it is markdown link syntax resolving to a dangerous
>    attribute, not markup. Now an allowlist on `link` and `image` that fails
>    closed; a rejected URL keeps its text rather than silently vanishing.
> 5. **My own first fix to the PII validator created a worse bug than it fixed.**
>    Asking it to catch a bare 10-digit phone number made it fire on ordinary
>    SharePoint links — and Task 9's corpus is authored FROM SharePoint links, so
>    it would have failed the build on legitimate content while blaming guest PII
>    in a URL containing none. Narrowed to NANP shape (area and exchange codes
>    cannot begin with 0 or 1), which rejects `1234567890` and keeps `4075550142`.
>    A fix round is not automatically an improvement.
>
> **[!] TWO DEPLOYMENT TRAPS THAT PASS LOCALLY AND FAIL IN PRODUCTION** — both
> handled, both must be verified on the deployment at Task 10:
> - `readFileSync` on a computed path is **not traced by Next**, so `content/kb/`
>   would be absent from the Vercel build and `/kb` would render an EMPTY corpus
>   while working perfectly on localhost. `outputFileTracingIncludes` is in
>   `next.config.mjs`; **Task 10 step 4.3 checks the prod corpus is non-empty.**
> - A missing `kb_queries` table fails **silently**, because the logger swallows
>   its own errors by design. Run `node scripts/db-init.mjs` and confirm.
>
> **[?] CONTENT — THE ONLY THING BLOCKING TASK 9. NEEDS KYLE.**
> - **[x] Source #1, the website:** captured, 23 pages →
>   `.superpowers/sdd/2026-08-10-knowledgebase-kb/source-website.md`.
> - **[!] Sources #2-#5: I CANNOT REACH THEM.** All live in
>   `bea_rentstayable_com`'s **personal OneDrive**. The M365 connector searches
>   my own drive and the sites I belong to; it does not index another person's
>   personal OneDrive, and a sharing link cannot be resolved to a file ID with
>   the tools available. Three searches, nothing. **Kyle to download the four
>   files into the repo folder** (or move them to a SharePoint site / his own
>   OneDrive). Note #5 is the SAME file as #2 — identical document ID, different
>   share token. Tab structure recorded: #2 tab1 transient / tab2 leases;
>   #3 tab1 General / tab2 Guest Wifi Policy / tab3 Pet Policy; #4 a Word doc,
>   contents unknown.
> - **[?] FOUR CONTENT CONFLICTS need Kyle's ruling before authoring.** The site
>   contradicts itself and I will not pick a winner on a policy:
>   1. **Check-in time: 3:00 PM (FAQ) vs 4:00 PM** (homepage AND the Rules &
>      Regulations doc dated 07/22/26).
>   2. **Lakeland email: `lakeland@` (contact page) vs `frontdesk@`** (property page).
>   3. **Weekly discount: "up to 25%" vs "20-35% typical".**
>   4. **Deposit: a flat $100 (Deposit Terms) vs "varies by location"** (FAQ).
> - **[x] Applied Kyle's correction:** OBT's own property page lists a pool.
>   Recorded verbatim AND flagged — the site is wrong, not us.
> - Things the site never answers, recorded as `NOT STATED ON SITE`: any dollar
>   room rate, room square footage, the exact pet fee, the after-hours emergency
>   number, and an explicit cancellation window.
>
> **[?] ONE DECISION FOR KYLE, not a bug.** `kb_queries` stores the raw search
> string, so someone typing "does the lease for <guest name> cover pets" persists
> a guest name indefinitely. This is exactly what the spec asked for. But
> CLAUDE.md §5 rule 2 is written about DISPLAY surfaces, and this is a write-only
> analytics table with no scoped exception like `/bea` has. **Accept as-is, add
> redaction, or add a retention window?** Blocks nothing.
>
> **[?] VERIFY:** Task 6 ran `db-init` with a local `DATABASE_URL`, so
> `kb_queries` may already exist in PRODUCTION Neon. The DDL is idempotent and
> append-only so it is safe either way — but confirm which database was touched.
>
> **▶ NEXT SESSION — START HERE:**
> 1. **[ ] Task 8** (document page), then 9 and 10. The ledger has the base SHAs.
> 2. **[?] Get the four SharePoint files from Kyle** — Task 9 cannot start
>    without them, and launch gates on real content.
> 3. **[?] Get Kyle's ruling on the four content conflicts above.**
> 4. **[ ] Task 10: push, deploy, and run the six live checks** — especially
>    "`/kb` 307s to `/login`" and "the prod corpus is NOT empty".
> 5. Older open items from session 9k are unchanged and still below.

---

## 08/10/26 (session 9k) — ELISE IS UNBLOCKED. FUNNEL WHOLE, CRON BACK ON.

> **Pickup — 08/10/26 (ET). SHIPPED AND LIVE.** Branch level with `origin` at
> **`f1e00aa`**; production **`dpl_G4TwNaVENLhsW3XYAM96d4KPwFgk` READY**, aliased
> to `dashboard.rentstayable.com`. `tsc --noEmit` exit 0 · **325/325 tests**
> (no new tests — this was a credential + config change, not new behaviour).
>
> **[x] THE ELISEAI CREDENTIAL IS FIXED.** Kyle supplied the new `rise8_reader`
> password. Set in `.env.local` and in Vercel (**Production + Preview**, type
> `Sensitive`). `npx tsx scripts/elise-sync.mts` returned **6,839 funnel rows,
> 34 snapshot rows, 38,643 enrichment metric rows, 0 skipped**.
>
> **[x] THE THREE PURGED STAGES ARE BACK** — `tour_booked` 865 rows,
> `tour_attended` 425, `application_approved` 416. All seven stages present, newest
> day 08/09–08/10. The `1fac49f` purge is fully recovered; nothing left to backfill.
>
> **[x] THE BANNER CLEARED ITSELF, WHICH IS THE DESIGN WORKING.** `elise_sync_status`
> recorded `ok=true`, so the "leasing data is not updating" note on `/ops` §2 and
> `/elise` stopped rendering **with no code change and no deploy** — exactly what
> `dc9dba7` was built to do. The four failure rows stay in the table as history.
>
> **[x] CRON RESTORED** — `{ "path": "/api/cron/elise-sync", "schedule": "0 12 * * *" }`
> is back in `vercel.json` (`f1e00aa`). The route header no longer says "disabled";
> it now carries the incident and **the rule worth keeping: if auth fails again,
> REMOVE THE CRON ENTRY FIRST, then chase the credential.** Our own daily retries
> against a dead password are what locked the account on 08/08.
>
> **[x] VERIFIED IN PRODUCTION, NOT JUST LOCALLY.** A local sync only proves
> `.env.local`. Hit the deployed route with the `CRON_SECRET`:
> `GET dashboard.rentstayable.com/api/cron/elise-sync` → `{"ok":true,"funnel":6839,
> "snapshot":34,"metrics":38643,"skipped":0}`. **That is the proof the Vercel
> Production env var is right**, which matters because `Sensitive` vars cannot be
> read back — a sync is the only way to check one.
>
> **[?] ONE LOOSE END — the Preview-scope env var is unconfirmed.** `vercel env add
> --force` reports success for Preview, but `vercel env ls` still shows its original
> 34-day-old date while Production moved to "6m ago". Likely just createdAt on a
> row updated in place, but **it is not proven and cannot be read back.** Low
> priority: this branch deploys with `target: production`, so Preview env is
> effectively unused. Settle it the next time a preview deployment is needed.
>
> **▶ NEXT SESSION — START HERE (unchanged from 9j except item 2 is now done):**
> 1. **[?] KB spec review** → then writing-plans. Still blocked on Kyle only.
> 2. **[?] Retire `/elise` entirely?** Still open — and note the argument shifted:
>    the "it depends on someone else's account" case is now weaker, since that
>    dependency was repaired in a day. Still needs to know what Rob and Crystal use.
> 3. **[?] KE's YTD OOO is still short** — Jan–Jul are `is_final`; see 9i item 1.
> 4. **[ ] JW +4.7 / SA +2.9 vs Data Insights** (9i item 2).
> 5. **[ ] DP MTD 43 vs 105** — unexplained (9i item 3).
> 6. **[ ] Audit other endpoints for unpaged reads** (9i item 4).

---

## 08/08/26 (session 9j) — ELISE SAYS WHY IT'S BROKEN · KB SPEC PARKED

> **Pickup — 08/08/26 (ET). SHIPPED AND LIVE.** Branch level with `origin` at
> **`dc9dba7`**; production **`dpl_Aoxs64ikc6654TXiZJ4EQEcW1JfH` READY**, aliased.
> `tsc --noEmit` exit 0 · **325/325 tests** (17 new). Live smoke: `/ops` 307,
> `/elise` 307, `/login` 200.
>
> **[x] THE DAILY REPORT IS BACK TO NORMAL, UNATTENDED.** The 08/08 14:30 UTC cron
> returned **200**, so 08/07's report posted to the Revenue chat by itself — the
> dated hold went inert as designed and the Power Automate flow is on. The held
> 08/06 report was sent manually the day before (`?force=1`, `posted: true`, 202).
> Nothing about the report needs attention.
>
> **[x] ELISE: THE DASHBOARD NOW STATES THE FAILURE INSTEAD OF SHOWING STALE
> NUMBERS SILENTLY** (Kyle: "make it so that the dashboard says the error and say
> waiting for elise to reply"). `/ops` §2 and `/elise` both render:
> *"Leasing data is not updating. Last attempt 08/08 16:50 UTC (today) — failed.
> Newest data we hold is from 08/06 17:07 UTC (2 days ago). Reported error:
> Incorrect username or password was specified. 3 consecutive failed attempts."*
> plus the waiting-on-EliseAI note.
> - **The note self-clears.** New `elise_sync_status` table records every attempt;
>   `lib/elise-status.ts` composes the wording from it, and `BLOCKED_NOTE` renders
>   ONLY while the stored status is failing. One successful sync deletes the whole
>   banner with no code change — which is what `1fac49f`'s "no stale hardcoded
>   banner" rule demanded.
> - Recording lives **inside `runEliseSync()`**, not at each call site, so a
>   hand-run recovery clears the banner exactly as the cron would.
> - Seeded the four pre-existing attempts from evidence
>   (`scripts/seed-elise-sync-status.mts`, dry-run first, refuses to double-seed),
>   because with the cron disabled no new attempt would arrive to correct a false
>   "never synced".
>
> **[x] DIAGNOSIS — THE PASSWORD DIED FIRST; OUR OWN CRON LOCKED THE ACCOUNT.**
> 08/07 12:00 cron failed with *"Incorrect username or password"*; 08/08 12:00 with
> *"temporarily locked"*; one deliberate login test on 08/08 got **390100** again,
> proving the lockout had expired and the credential is the live problem. **So the
> lockout is a symptom, not the cause.**
> - **[x] `elise-sync` CRON REMOVED FROM `vercel.json`.** Leaving it scheduled
>   would re-lock the account the moment EliseAI resets it — making us the cause of
>   our own blocker. The route still works and documents how to re-enable; the note
>   lives in the route, not `vercel.json`, because unknown top-level keys risk
>   failing Vercel's schema validation on deploy.
> - **Answered for the record: Elise is NOT solved.** Three funnel stages
>   (`tour_booked`, `tour_attended`, `application_approved`) are still absent —
>   purged in `1fac49f` on 08/07 expecting a re-sync, and every sync since has
>   failed. `lib/snowflake.ts` asks for all seven stages, so the vocabulary is
>   right; only the credential is missing.
>
> **[x] TWO BUGS CAUGHT BEFORE SHIPPING, both likely to recur elsewhere:**
> 1. **Neon returns `timestamptz` as a JS Date.** `String(date)` gives
>    "Sun Aug 09 2026 00:50:00 GMT+0800", so slicing rendered
>    **"Sun Aug 09 2026  UTC"** and leaked the server's zone. Identical to the trap
>    already documented for Snowflake DATEs (`lib/snowflake.ts` `ymd`). Normalised
>    at the DB boundary AND parsed in the formatter, with a regression test on that
>    exact string. **Grep for other `String(...)`-then-slice on a timestamptz.**
> 2. **`daysBetween` floored elapsed hours**, so 08/06 17:07 read at 08/08 17:00
>    rendered "1 day ago". For a staleness warning understating is the dangerous
>    direction — it now counts UTC calendar days and errs toward "older than you
>    think". The test asserted the human answer and the code was wrong, not the test.
>
> **[~] KNOWLEDGEBASE `/kb` — SPEC WRITTEN, PARKED AT KYLE'S REQUEST.**
> `docs/superpowers/specs/2026-08-07-knowledgebase-design.md` (`a015ed7`).
> **DO NOT invoke writing-plans until Kyle has reviewed it.** Design: search box
> with cited section results, **no chatbot, no LLM, no database, no embeddings**;
> markdown in `content/kb/*.md`, in-process index behind one `searchKb()`
> interface; `/kb` is MAIN-pin gated automatically because `canAccess` already
> falls through for unrecognised routes.
> - **Three questions for Kyle at review:** (1) query logging in v1 — keep or veto,
>   (2) hand-rolled ~100-line markdown renderer vs just taking `marked`,
>   (3) confirm no per-document permissions is acceptable.
> - **Corpus not yet in hand** (website + live SharePoint Excel + possibly one
>   more). Kyle consolidates, we author into the repo. Build against fixtures;
>   **launch still gates on real content** — an empty KB is worse than no KB.
>
> **▶ NEXT SESSION — START HERE:**
> 1. **[?] KB spec review** → then writing-plans. Blocked on Kyle only.
> 2. **[ ] EliseAI credential.** Chase Steph for a new `rise8_reader` password
>    (account `ihpsnqz-rise8_reader`). Then set it in `.env.local` **and** Vercel,
>    run `npx tsx scripts/elise-sync.mts` — that repopulates the three stages,
>    clears the banner, and is the moment to restore the cron entry.
> 3. **[?] Retire `/elise` entirely?** Kyle raised it and it is still open. The
>    honest case for it got stronger: the pipeline depends on someone else's
>    account, and our funnel reproduces EliseAI's own Leasing Dashboard. Needs to
>    know what Rob and Crystal actually use.
> 4. **[?] KE's YTD OOO is still short** — Jan–Jul are `is_final`; see 9i item 1.
> 5. **[ ] JW +4.7 / SA +2.9 vs Data Insights** — not pagination; a calendar
>    screenshot settles it the way KE was settled (9i item 2).
> 6. **[ ] DP MTD 43 vs 105** — unexplained by anything in 9i (9i item 3).
> 7. **[ ] Audit other endpoints for unpaged reads** (9i item 4).

---

## 08/07/26 (session 9i) — **OOO WAS READ UNPAGED. JN REPORTED 20 OF 104.**

> **Pickup — 08/07/26 (ET). SHIPPED, LIVE, AND THE HELD REPORT IS POSTED.**
> Branch level with `origin` at **`51200f9`**; production
> **`dpl_DyxzrNa1rG2C1TiA9fcdKNW1NmsT` READY**, aliased. `tsc --noEmit` exit 0 ·
> **308/308 tests** (2 new). Four releases: `3549f5a` (post hold) → `2f995cc`
> (reconciliation tool) → `022d6af` (**the fix**) → `4912329` (tooling) →
> `51200f9` (JN override removed).
>
> **▶ THE FINDING — `/getRoomBlocks` PAGES AT 20 RECORDS AND WE NEVER PAGED.**
> All three call sites passed no pagination params, so any property with >20 block
> records in the window silently lost the rest. No error: a valid short page.
> Found from Kyle's Cloudbeds calendar screenshots, which showed dozens of red
> "Reno Room" bars at JN where the API returned 20.
>
> | property | blocks bare → paged | OOO bare → true |
> |---|---|---|
> | JN (812) | 20 → **110** | 20 → **104** |
> | KE (2295) | 20 → 32 | 24 → **31** |
> | OR (8700) | 20 → 21 | Other 4 → 5 |
>
> Far worse over ranges, which is what MTD/YTD use: **JN 07/01–07/19 read 380 OOO
> room-nights against a true 1,905 (5×).**
>
> **[x] THIS OVERTURNS THE 08/04 CONCLUSION (items 2 and 4 of that entry).**
> "~7 rooms are out of service in Cloudbeds' occupancy data with NO room block
> against them — operational fix, get them blocked" was **wrong**. The rooms were
> blocked all along; our reader was short. **Data Insights was the accurate source
> and our block count was the broken one** — the reverse of what we believed. The
> parked question "which 7 KE rooms?" is void, and there is nothing for KE or JN
> ops to do.
>
> **[x] VERIFIED TO THE ROOM, TWICE, AGAINST THE CALENDAR.**
> - **JN:** 104 red bars counted across 5 screenshots = API's 104. And it closes to
>   inventory: 104 red + 20 green (= banked room-nights) + 3 standalone grey = **127**.
> - **KE:** 31 red bars = API's 31, every room number matching the predicted list
>   with no extras and no misses; 20 of them labelled "Renovation", which
>   **independently confirms KE's `capacityAdjustment: -20`** for the first time.
>   All 5 `blocked_dates` rooms (114/151/199/219/239) confirmed as lease-expiry bars.
> - **Colour mapping:** red = `out_of_service` = our OOO line. **Grey is NOT 1:1
>   with Other blocks** — Cloudbeds paints checked-out/expired reservations grey
>   too, so only some grey bars are `blocked_dates`. Grey cannot be counted by eye;
>   the API is the arbiter. (I overstated this at JN before KE disproved it.)
>
> **[x] JN's `sellableOverrides` DELETED (`51200f9`) — it was papering over our bug.**
> Its own arithmetic gives it away: 104 `out_of_service` + 3 `blocked_dates` = the
> 107 it forced, leaving exactly the "20 sellable" it was built from. It measured
> **unsellable**; the field it fed is **out-of-order only**, and the report already
> counts those 3 rooms under Other blocks — that double-count is what drove JN's
> **Available to −2**. Now Cloudbeds-derived like every other property (§6). The
> *mechanism* is kept for a future property that needs it, with tests moved onto a
> synthetic fixture plus two new tests pinning the removal.
>
> **[x] BANKED HISTORY REPAIRED FOR AUGUST — two scripts, both dry-run-first.**
> - `scripts/repair-ooo-pagination.mts` (raise-only, skips `is_final`, never writes
>   a failed read, leaves `other_blocks` alone so its comp half survives):
>   **+51 room-nights over 08/01–08/06** — KE +43, LL +6, KW +1, JW +1. 15 days
>   re-read *lower* and were left untouched (erosion).
> - `scripts/correct-jn-override-ooo.mts` — the **only downward write in this
>   codebase**, conditioned on `ooo_source='override'` and `is_final=false`:
>   JN 107 → 102/102/102/103/103/104, **−26 room-nights**. Justified because the
>   107 was never a Cloudbeds reading. Confirmed it survived the subsequent
>   re-bank (raise-only kept 104; nothing reverted).
>
> **[x] THE HELD 08/06 REPORT IS POSTED.** `?force=1` against production returned
> `posted: true`, HTTP **202**, `asOf 2026-08-06`, 8 properties, `gapsLast14d: 0`.
> Final numbers: JN 104 / Available 1 / MTD 616 · KE 31 / Available 13 / MTD 186 ·
> **zero negative-bearing properties**, no override notes.
> - **`attached: 0`** — no PDF. `TEAMS_FLOW_ATTACHMENTS` is unset in production, so
>   the card posted alone. That is the 08/04 parked decision, not a fault, but it
>   *is* a visible difference from Monica's posts. Card file buttons need no PIN.
> - Report holding worked as designed: `POST_HOLD_DATES` in the cron route gates
>   **only the send** — snapshots still banked 8/8 at 14:31Z on the held day. The
>   dated entry is now inert and self-expiring; `?force=1` overrides it.
>
> **▶ NEXT SESSION — START HERE:**
> 1. **[?] KE's YTD OOO is still short.** Jan–Jul are `is_final = true` so the
>    repair skipped them. Rewriting closed months is a real decision, and eroded
>    blocks mean a re-read recovers KE's long-lived Renovation set but not expired
>    short maintenance blocks — **better but still not true**. Run
>    `repair-ooo-pagination.mts 2026-01-01 2026-07-31 --include-final` to see the
>    dry run before deciding.
> 2. **[ ] JW +4.7 and SA +2.9 rooms vs Data Insights — unexplained.** NOT
>    pagination (both return <20 blocks). Either genuinely unblocked-but-unsellable
>    rooms, or a DI artefact. `scripts/dump-blocks.mts JW 2026-08-07` plus a
>    calendar screenshot settles it the same way KE was settled.
> 3. **[ ] DP MTD 43 vs Monica's 105 survives** every finding here — DP returns 17
>    blocks, nothing truncated. Still unexplained (long-standing, `lib/cloudbeds.ts`
>    block-nights note).
> 4. **[ ] Audit other endpoints for the same unpaged read.** `/getRooms` pages
>    correctly; `/getRoomBlocks` did not; session 9f already hit a short-page bug on
>    guest records at JN and OR. Assume nothing else is safe until checked.
> 5. **[ ] Trailing hold cleanup (cosmetic).** `POST_HOLD_DATES` still lists
>    `2026-08-07`; inert, prune when convenient.
> 6. **[ ] Snowflake password** — unchanged from 9h, still the only people-blocker.
>
> **Tools added:** `scripts/reconcile-ooo.mts` (banked vs live blocks vs
> DI-derived, per property per day, `--csv`), `scripts/dump-blocks.mts` (paged,
> resolves roomIDs → room codes so output is checkable against the calendar).
> **Two corrections to the session-9a notes, both found by running them:** the DI
> column is **`mfd_occupancy`**, not `adjusted_occupancy` (400 Unknown field), and
> `capacity` is one of the silently-dropped count columns — so the capacity term
> comes from our own banked inventory, which is what we want anyway (DI's own
> capacity wobbled 168/169/171/175 at KE where the truth is 167).
>
> **Also learned:** the tool written to investigate the bug **contained the bug** —
> `dump-blocks.mts` read page 1 only. Fixed in `4912329`. And the Smartsheet "OOO
> Tracker" / "OOO Tracker Duplicate" sheets are **dead** (last activity 2025-09-01
> and 2025-04-15, Status blank on all 438 rows, picklist still lists Gainesville
> and has no Davenport) — they say 0 rooms out of order against Cloudbeds' 189.
> Not a usable third source; do not reach for them.

---

## 08/07/26 (session 9h) — REPORT LINKS FOLLOWED "LATEST" · ELISE FUNNEL SPEC

> **Pickup — 08/07/26. SHIPPED AND LIVE.** Branch level with `origin` at
> **`1fac49f`**; production **`dpl_AGQdgc6rw9RAuQprTXSDThpPyNBf` READY**, aliased
> to `dashboard.rentstayable.com`. `tsc --noEmit` exit 0 · `next build` green ·
> **306/306 tests** (11 new across the session).
> - **Live smoke after `1fac49f`:** `/login` 200 · `/test` 200 · `/ops` `/bea` `/`
>   `/report` `/elise` all 307.
> - Two releases in this block: **`581036a`** = the report-link fix
>   (`dpl_6w3NPQHsajZ5gnSWLufRUumKgke8`), then **`b57c75f`** + **`1fac49f`** =
>   the Elise funnel swap and its empty-stage warning. Rollback target for the
>   latest is **`dpl_9qbuvwVb11w8MugWf5ntTBJoUz8X`** (`b57c75f`).
> - Report-link specifics below refer to the `581036a` release.
>
> **▶ NEXT SESSION — START HERE. One blocker, and it is Kyle's:**
> 1. **[ ] The Snowflake password.** Put the new EliseAI temporary password in
>    `SNOWFLAKE_PASSWORD` — **`.env.local` AND Vercel** — expecting Snowflake to
>    force a permanent one on first login; use the permanent value in both. Then
>    **`npx tsx scripts/elise-sync.mts`** repopulates Tours booked / Tours
>    attended / Apps approved and the `/ops` §2 warning clears itself. Nothing
>    else is waiting on anything. Detail: item 3a / 3d.
> 2. **[ ] Two things to confirm with people, not code:** Bea can see Michael
>    Krick on `/bea` §3 (she reported it, so her confirmation closes it), and the
>    first Teams card posted after `581036a` serves the right day — click
>    yesterday's button and today's and check they differ. Both are unprovable
>    from here (gated page; deployment-side signing secret).
> 3. **[ ] Then the real backlog**, none of it blocked: the OR (8700) taxed
>    long-term lease · the three large transient balances · `AUTH_SECRET` ·
>    the Revenue trigger URL · the DP availability guard threshold.
> - **The new rejection paths are confirmed in production**, and they answer as
>   JSON (so our handler ran — middleware would have sent a 307): no token → 403
>   · forged token → 403 `invalid or expired link` · `asOf=notadate` → **400
>   `bad asOf`**, which only the new build emits.
> - **The accept path still cannot be exercised from here** — prod's signing
>   secret differs from local, so a locally-minted token is correctly refused.
>   Unchanged limitation from 9b item 11: the first real proof is a posted card.
> - **Rollback target `dpl_2opTMgcJAxtCbSExVDUGyTcdc3tc`** (`bf205a4`). Clean —
>   read-only, writes nothing. One asymmetry: cards posted *after* this release
>   carry `&asOf=` and stay-date-bound tokens, and a rollback would make those
>   buttons **403** (old code verifies the unbound message). So once a card has
>   gone out on this build, fix forward rather than roll back.
>
> **[x] 1. MONICA'S BUG: every card's file button downloaded the SAME report.**
> "The same button from yesterday's report and today's report downloads the
> identical Aug 6 report."
> - **Cause, and it was a one-word omission:** `/api/report-file` called
>   `buildRevenueReport()` **with no argument**, so it rendered whatever was
>   latest **at click time**. The token carried only an expiry — nothing said
>   which day the card was for. So every link in the chat, however old, always
>   served the current report. It has behaved this way since the route shipped
>   (`5c17349`, 08/03/26).
> - **Fix:** the stay date is now **inside the signed token** and on the URL
>   (`&asOf=`). A link yields the one report it was minted for, for its whole
>   30-day life, and editing the date fails the signature rather than fetching
>   another day. The cron signs `report.asOf`, so a `?asOf=` catch-up post pins
>   to the day it actually rendered rather than to the day it was posted.
> - **[!] ALREADY-POSTED CARDS ARE NOT REPAIRED, deliberately.** ~2 weeks of
>   cards carry unbound tokens; those still verify (so the buttons are not dead)
>   and still render latest. **Their intended date is not recoverable:**
>   mint-time − 1 day would work for the daily cron but is *wrong* for `?asOf=`
>   catch-up posts, so guessing trades one wrong file for a differently wrong
>   one. **Only cards posted from 08/07/26 are correct.** Both failure directions
>   fail closed and are tested: a bound token refuses a different date, and
>   refuses having `&asOf=` stripped off (which would otherwise reopen the bug).
> - **[ ] Verify on the first card posted after deploy** — click yesterday's
>   button and today's and confirm they differ. The signing secret is
>   deployment-side, so this cannot be proven from here (same limit as 9b item 11).
>
> **[x] 2. RENDERED THE AUG 5 REPORT FOR MONICA** —
> `outputs/Occupancy Report as of August 5, 2026.pdf` (594 KB), i.e. **stay date
> 2026-08-04**, her label = stay date + 1. This is the file yesterday's button
> should have served.
> - **[!] Caveat worth passing on if she reconciles it:** re-rendering a past
>   date takes the **Yesterday column from a LIVE fetch**, not from the banked
>   snapshot (`getRevenueReportInputs`, session 9 open item), so per-property OOO
>   can differ by a room or two from what a card posted that morning showed.
>   MTD/YTD come from the store and are unaffected.
>
> **[x] 3. ELISE FUNNEL PARITY — BUILT AND VERIFIED. Code correct; 3 of 7 stages
> still hold stale DATA, and that needs one command once the Snowflake password
> is back (item 3d).**
>
> **[x] 3a. The share was queryable after all** — my earlier note that it "cannot
> be queried until the new password lands" was **wrong**. `rise8_reader` worked
> throughout; the password Steph reset is a different (UI) login. Corrected.
> **Then the credential DIED mid-session at ~01:04** — "Incorrect username or
> password was specified", persistent, right after the sync finished. Almost
> certainly Steph's reset landing. **[ ] Kyle: put the new temporary password in
> `SNOWFLAKE_PASSWORD` (`.env.local` AND Vercel), and expect Snowflake to force a
> permanent one on first login.** Until then the nightly `elise-sync` cron fails
> and the funnel goes stale (it does not go wrong — the rollup is already banked).
>
> **[x] 3b. VERIFIED TO THE ROW against Steph's reference query.** New
> `LEASING_FUNNEL_SQL` in `lib/snowflake.ts` reproduces all seven June-2026 stages
> exactly — **1,863 leads · 781 engaged · 223 tours booked · 90 attended · 274 apps
> started · 146 approved · 146 signed** — and summing our per-day rollup over the
> month equals her single windowed query
> (`scripts/probe-leasing-parity.mjs`). Four rules, each of which moves the number:
> dedupe on `(GLOBAL_SESSION_ID, EVENT_TYPE)` earliest-wins · `IS_INTEREST=FALSE`
> **applied AFTER the dedupe** (before gave 1,865, not 1,863) · bucket by
> `America/New_York` local date · the dedupe is **global**, not per-window, which
> is what makes a day rollup summable back to her figure.
> - Checked rather than assumed: `GLOBAL_SESSION_ID` is NULL on **zero** funnel
>   rows (it is null on ~98k message-grain rows, which would have silently
>   collapsed into ONE partition), and `IS_IGNORED` is false on every funnel row.
>
> **[!] 3c. THE DUPLICATED-SQL TRAP BIT ME, TWICE, AND BOTH ARE NOW CLOSED.**
> - `scripts/elise-sync.mjs` kept its **own copy** of the Snowflake SQL. I ran it,
>   it reported "9,791 rows upserted", and it populated **none** of the new
>   stages — it re-synced the old vocabulary. **Deleted and replaced with
>   `scripts/elise-sync.mts`**, which calls the real `runEliseSync()` so there is
>   one definition and it cannot drift from production again.
> - The seven stage keys were **copied as string literals** into
>   `LeasingSection`, `ops-pdf-leasing`, `ops-insights` — and their tests build
>   their own stage arrays, so all three would have rendered **ZEROS in production
>   with a fully green suite**. Now every consumer reads `STAGE` from
>   `lib/leasing.ts`, and both test fixtures derive from `FUNNEL_STAGES`.
>
> **[!] 3d. DATA RESIDUE — 3 of 7 stages read high until a re-sync.**
> `tour_booked`, `tour_attended` and `application_approved` exist in **both**
> vocabularies. The old query bucketed by UTC and did not dedupe; the new one
> buckets local and does. Where the two disagree on the day, **both rows survive**
> and reads sum them. June reads **286 / 98 / 195** against Elise's
> **223 / 90 / 146**. The other four stages are exact.
> - Caused by my running the stale `.mjs` before replacing it. There was no write
>   timestamp, so the two generations are indistinguishable after the fact.
> - **Fixed the underlying gap:** `elise_funnel_daily.updated_at` added
>   (`db-init.mjs` migration, applied) and stamped on every upsert.
> - **[x] Purged 6,857 rows of 15 RETIRED event types** (prospect,
>   prospect_engaged, application_started, lease_completed, …) — dead weight no
>   stage read, and `lease_completed` sitting next to `lease_signed` was a trap.
> - **[ ] REMEDIATION, one command once the password works:**
>   `npx tsx scripts/purge-elise-funnel.mts --overlap --apply` then
>   `npx tsx scripts/elise-sync.mts`. Do not run the purge before the credential
>   works — it empties those three stages until a sync repopulates them.
> - **[x] Kyle chose ZERO THEM (08/07/26).** Purged 2,157 rows across the three
>   types, so they read 0 until a sync repopulates them. Because zero is an
>   honest count but the derived rates keep rendering off it — Lead→Tour showed a
>   confident **0% against 1,863 leads** — `/ops` §2 now warns whenever a
>   MID-funnel stage is 0 while leads are non-zero (`1fac49f`). Data-driven and
>   names no cause, so it clears itself on the next good sync instead of becoming
>   a stale banner. Leads is excluded (0 leads is just an empty window) and so is
>   the last stage (a month with no signed leases is genuinely possible).
>
> **[!] 3e. ONE KNOWN INCONSISTENCY LEFT, deliberately.** The enrichment
> `lead_source` metric still counts undeduplicated PROSPECT_EVENTS `prospect`
> rows, so its totals run ~21% above the funnel's Leads for the same window (June:
> 2,260 vs 1,863) and the two will not tie out on `/elise`. Steph's spec covered
> the funnel only, and migrating enrichment needs its own verification pass —
> `EVENTS_LEASING_RISE8` does carry `MARKETING_SOURCE` and `CHANNEL`, so it is
> possible when wanted. Flagged in `lib/snowflake.ts` at the query.
>
> **[!] 3f. Measured facts worth not rediscovering:** `application_approved` and
> `lease_signed` are **always emitted together** (671/671 rows, 667/667 sessions
> all-time; 146/146 in June), so `lease_signed` carries no information the former
> does not and an approved→leased rate would read 100% by construction —
> deliberately not computed. Tour attendance stays badly under-recorded in the new
> source too (1,660 booked vs 566 attended all-time, 34%), which is why Tour→Lease
> is measured against tours **booked**. `/elise`'s methodology note and the PDF
> footer (which claimed "counts are raw events (no de-dup)") are both rewritten.
>
> **Spec as received, for the record:**
> - Table **`RISE8_DATA.DA.EVENTS_LEASING_RISE8`** (not the funnel source we were
>   using).
> - **Dedupe on `(GLOBAL_SESSION_ID, EVENT_TYPE)`**, keeping earliest
>   `EVENT_DATETIME` — this is the part we did not have.
> - **`IS_INTEREST = FALSE`.**
> - **Timestamps are UTC**; the dashboard shows each community's local time, so
>   convert per property (`CONVERT_TIMEZONE`) — all 8 are `America/New_York`.
> - Event → stage map: `state` = leads · `first_lead_engagement` = engaged ·
>   `tour_booked` · `tour_attended` · `lease_applied` = apps started ·
>   `application_approved` = apps approved · `lease_signed`.
> - **Her caveat, and it matches our own posture:** she does *not* recommend
>   trying to replicate the Leasing Dashboard exactly — the share is raw data to
>   derive from. Consistent with the CB rule (§6): match once to validate, then
>   own the derivation. **Consequence: our funnel and Elise's dashboard WILL
>   diverge on timezone-boundary days, and there is no third party to arbitrate.**
> - Reply sent: `outputs/ReplyEliseAI_DataShare_080726.md`.
> - Supersedes the funnel approach in the `elise-data-share` memory.

---

## 08/06/26 (session 9g) — BEA'S MISSING GUEST · CB IS NOW THE ONLY SOURCE OF TRUTH

> **Pickup — 08/06/26. SHIPPED AND LIVE, two releases.** Branch level with
> `origin` at **`25748cb`**; production **`dpl_BaTC5ScZmrqRT2exwxK2GN6enN1C`
> READY**, aliased to `dashboard.rentstayable.com`. (The fix itself shipped first
> as `b6ffde1` → `dpl_2bpEFLvVwirx4cNFvGVghKMaRmjh`; `25748cb` adds the
> identifier columns, item 6.) `tsc --noEmit` exit 0 · `next build` green ·
> **295/295 tests** (3 new).
> - **Live smoke:** `/login` 200 · `/test` 200 · **`/bea` 307 → `/login`** (the
>   guest PII is still gated, the check that matters) · `/` 307 · `/report` 307.
> - **Live smoke after `25748cb`:** `/login` 200 · `/test` 200 · `/bea` 307 ·
>   `/` 307 · `/report` 307 · `/rob` 307.
> - **Rollback target `dpl_Fno12VQnnAWwAB24KqQsMcgDkDMF`** (`346842c`). Clean:
>   the change is a read-only filter plus a display column and writes nothing.
>   (I initially quoted the 9e deploy as the rollback target — wrong; that one is
>   two releases back.)
> - **[ ] The proof that counts is Bea loading `/bea` §3 and seeing Michael
>   Krick.** Verified from here via the API, not through the gated page.
>
> **[!] 1. MONICA IS NO LONGER PRODUCING REPORTS (Kyle, 08/06/26).** "She won't be
> creating any reports from now on so we are on our own. The source of truth will
> always be CB from now on." Recorded in **CLAUDE.md §6** and the
> `cloudbeds-source-rule` memory, because it changes how to work here:
> - **The independent validation signal is gone.** Five days of head-to-head
>   parity, the OOO reconciliation and the rate-plan ruling were all her files.
>   This app IS the report now, not a second opinion on it. Nothing external will
>   catch our errors — measure rather than infer, and record uncertainty in the
>   code where the number is produced.
> - **Three questions parked on her are CLOSED UNANSWERED**, per Kyle: the ~7
>   unblocked KE (2295) rooms · how the MTD out-of-order line accumulates · one
>   raw JW/SA export. Whatever the code does now is the answer until Cloudbeds
>   says otherwise. Do not reopen them as "ask Monica".
> - Her files stay as a **historical seed + regression fixtures**
>   (`diff-reports.py`, `parse-monica-pdf.py`). Evidence about the past, not a
>   live check. **[ ] The DP availability guard is the same case** — re-base the
>   threshold per property against banked CB data; it needs nobody's confirmation.
> - **[x] The Excel version of the guest-count memo is CANCELLED** (Kyle: not
>   needed). The `.md` memo stands as the deliverable.
>
> **[x] 2. BEA'S DEFECT, FOUND AND FIXED: `/bea` §3 was hiding guests by date, not
> by balance.** Bea reported that **Michael Krick** has a balance due and cannot be
> seen. He is **Davenport (44199)**, res `6872348591162`, **$4,793.60**, checkin
> 07-01, checkout **08-06 — today**, and Cloudbeds status **In-House**.
> - **Cause:** the filter was `status = In-House AND checkin <= asOf AND
>   checkout > asOf`. That third clause drops the two row types a collections
>   table exists to show — guests **departing today** (the last day Bea can
>   collect) and **overstays / evictions** (checkout already past, still In-House).
>   His guest record is literally named "Michael Krick Active Eviction".
> - **Fix:** trust Cloudbeds' own `reservation_status`. It is the authority on who
>   is physically in a room and a date window cannot outvote it. `checkin_date <=
>   asOf` stays as a future-arrival guard; there is **no** checkout clause now, and
>   the file header says never to reintroduce one.
> - **Measured blast radius: 8 reservations / $15,098.87 hidden across 7 of 8
>   properties** on this one day — DP 2 ($5,259.90), JW 2 ($4,820.42), JN 1
>   ($2,269.01), LL 1 ($1,348.06), SA 1 ($875.60), KE 1 ($525.88). Every one of
>   them checking out today. It would have recurred every single day.
> - **Also new, because the missing field was the explanation:** rows now carry
>   **Checkout** with a flag — `Checkout passed` (warn) for an overstay,
>   `Leaving today`. Footnote counts overstays; both new fields are in the export.
> - **[x] Verified live on all 8:** `npx tsx scripts/check-balance-due.mts` shows
>   Krick at DP room 130 flagged LEAVING TODAY. Portfolio **$148,086.40 / 137
>   reservations**. Seven of eight properties reconcile **exactly** to the
>   independent probe; the eighth (a $10 KW row) is explained in item 4.
> - **[ ] Tell Bea it is fixed** — she is the one who caught it, and it is her
>   confirmation that closes it.
>
> **[x] 3. BEA'S TAX QUESTION, ANSWERED WITH A MEASUREMENT.** She asked (Taglish)
> whether the table is only the tax-exempt leases and excludes regular guests.
> **There is no boolean tax-exempt column in DI dataset 1 or 3** — checked with the
> new `probe-di-columns.mjs`; only `tax_classification`/`tax_type` (dataset 1) and
> `taxes_value_amount` (dataset 3), so **$0 taxes is the only available signal.**
> In-house rows carrying a balance, portfolio:
>
> | rate-plan class | tax | res | balance |
> |---|---|---:|---:|
> | lease-monthly | $0 (exempt) | 119 | $116,867.50 |
> | transient | taxed | 7 | $23,507.25 |
> | lease-weekly | $0 (exempt) | 3 | $3,484.05 |
> | lease-weekly | taxed | 5 | $3,327.91 |
> | lease-monthly | taxed | 2 | $630.74 |
>
> - **She is right about the shape, wrong about the exclusion.** ~81% of the money
>   is tax-exempt monthly leases, and **no transient row is exempt** — but regular
>   guests ARE included: 7 reservations, ~16% of the total. Nothing filters on tax
>   status or on lease type; the skew is real behaviour (long-stay leases accrue
>   nightly, transients who owe have usually already checked out — item 4).
> - **▶ ONE GENUINE TAX FLAG: Orlando OBT (8700) res `9687974803447`,
>   lease-monthly, taxed $280.12, resident since 2025-01-08** — 19 months. The
>   other taxed leases are weekly/short-stay where tax is expected. FL exemption
>   turns on ~6 months' continuous residency, so this one looks like the exemption
>   was never applied. **[ ] Worth Bea or accounting checking** — I am not
>   asserting a tax error from a rate-plan name, only that this row does not fit
>   the pattern.
> - Covers 136 of the 137 rows: one reservation does not resolve a
>   `public_rate_plan` in the 2-column grouping. $349 — noted, not chased.
>
> **[?] 4. THE REAL SCOPE QUESTION, AND IT IS KYLE'S/BEA'S TO ANSWER: §3 shows
> IN-HOUSE ONLY, and that is where most of the arrears are NOT.** Measured:
> **Checked Out and still owing = 668 reservations / $351,468.26** since
> 2025-01-01, against ~$148k in-house.
> - **[!] DO NOT QUOTE $351k AS COLLECTIBLE.** $282,764.50 of it is **2025**
>   checkouts, and **JN (812) alone holds $158,213.82 over 40 reservations**
>   (largest single **$21,465.94**, out 2025-11-14) — wildly out of scale for the
>   portfolio's smallest property. That looks like unreconciled Yardi→Cloudbeds
>   migration folios rather than money anyone can chase. **Unverified inference.**
> - The 2026 slice is **$68,703.76 over 153 reservations** and is the part
>   plausibly live.
> - **[?] Decision needed: should §3 include departed guests?** It would change
>   the section from "who is here and owes" to AR, add cancelled/no-show noise, and
>   need the 2025/JN residue triaged first. Not built — this is a product call.
> - The $10 KW row the probe saw and the table does not: an In-House reservation
>   whose **checkin is after asOf**, correctly excluded by the future-arrival
>   guard. Immaterial, and now printed by `probe-balance-composition.mts`.
> - **[x] Zero true overstays portfolio-wide today** (checkout already past, still
>   In-House). Krick becomes one tomorrow if he stays — which is exactly why the
>   overdue path exists rather than a `>=` patch.
>
> **[x] 5. Session 9d's "three large transient balances" partly resolves itself:**
> DP room 130 $4,713.10 was **Krick** — same reservation, now $4,793.60 (+$80.50
> in two days ≈ $40/night, nightly accrual as documented). KE room 114 is now
> $10,313.44 (was $10,138.68) and JW room 114 $4,729.46. All three still growing,
> all three still worth someone's attention.
>
> **[x] 6. IDENTIFIERS ADDED TO BOTH §3 TABLES (Kyle, same session).** The tables
> named the guest but carried nothing lookup-able.
> - Row table gains a **Reservation** column. **Deliberately not a guest ID** —
>   Cloudbeds mints a new guest profile per booking (proved in session 9f: guest
>   IDs never repeated once across 92,282 records), so a guest ID identifies a
>   booking, not a person, and would mislead in a collections workflow. The
>   reservation number is what finds the exact folio.
> - The All-properties table, the property cards and the drilled-in header now
>   carry the **business property ID** (CLAUDE.md §3/§7), and the All export gains
>   a **Property ID** column so a row lifted out of the spreadsheet still says
>   where it came from.
> - Scoped to `/bea` §3 only. Other surfaces' tables were not touched — say so if
>   the same treatment is wanted elsewhere.
>
> **New/changed files:** `lib/balance-due.ts` (filter + `checkout`/`departure` +
> `overdueCount`/`overdueTotal` + header note), `components/BeaBalanceExplorer.tsx`
> (Checkout column, flag, footnote, export cols), `lib/__tests__/balance-due.test.ts`
> (12 tests, 3 new pinning the regression), `scripts/check-balance-due.mts`,
> and three new read-only probes: `probe-missing-balance.mts`,
> `probe-di-columns.mjs`, `probe-balance-composition.mts`.

---

## 08/05/26 (session 9f) — UNIQUE GUEST COUNT FOR THE INSURANCE APPLICATION

> **Pickup — 08/05/26. DELIVERED. No app change; a one-off count + a memo.**
> Write-up: **`outputs/UniqueGuestCount_Stayable_080526.md`** (counts only, no
> personal data — safe to send to a broker). Tool:
> **`node scripts/count-unique-guests.mjs [--json out.json]`**.
>
> **THE NUMBERS (all 8 properties, records dated 2020-07-07 → 2026-08-04):**
> | Measure | Count |
> |---|---:|
> | Named guest records | **92,282** |
> | Distinct people (name + email) | **88,671** |
> | Distinct email addresses | 82,939 |
> | Counted by Cloudbeds, never served | 3,112 |
> | Cloudbeds' own `total` | 95,394 |
>
> Per year, by year the guest record was created — **records** sum to the total;
> **people** deliberately do NOT (a 2024-and-2026 repeat guest counts in both):
> | Year | Records | People |
> |---|---:|---:|
> | 2020 (from 07-07) | 3,577 | 3,479 |
> | 2021 | 11,977 | 11,806 |
> | 2022 | 25,108 | 24,662 |
> | 2023 | 15,618 | 15,442 |
> | 2024 | 16,378 | 16,049 |
> | 2025 | 12,976 | 11,742 |
> | 2026 (to 08-04) | 6,648 | 6,000 |
> | **Total** | **92,282** | **88,671** |
>
> Most recent COMPLETE year = **2025: 12,976 records / 11,742 people**. 2020 and
> 2026 are partial. 2022 is a real outlier (~2× neighbours) and volume steps down
> after it — consistent with the shift toward extended-stay leases, where one
> guest holds a room for months instead of many guests turning over. Worth having
> ready if the insurer asks why the trend declines.
>
> **[x] 1. A CLOUDBEDS GUEST ID IS NOT A PERSON — this is the finding that
> matters.** Guest IDs never repeated once across 92,282 records at any property,
> which is impossible for a stable person identifier: Cloudbeds mints a **new
> guest profile per booking**. So "distinct guest IDs" counts bookings, and the
> person-level figure has to come from name+email. IDs are also issued per
> property, so one human at two hotels holds two IDs.
>
> **[x] 2. `total` IS NOT A SERVABLE-ROW COUNT.** Cloudbeds reports 95,394 but the
> endpoint only ever serves 92,282. Verified at DP: it serves 1,175 rows then
> returns empty pages indefinitely (tested pages 13, 14, 20) while `total` holds
> at 1,338. Almost certainly anonymized / merged / deleted profiles filtered
> server-side — **that "why" is inference, not confirmed by Cloudbeds.** They have
> no retrievable name, so they are correctly outside the count. **[ ] If the
> insurer wants 95,394 explained, that is a question for Cloudbeds support.**
>
> **[x] 3. MY OWN BUG, CAUGHT BY CHECKING AGAINST THE API'S TOTALS.** The first
> walk stopped whenever a page returned fewer rows than the page size — but
> Cloudbeds returns short pages MID-RUN. That undercounted by **8,263 records**,
> concentrated at **JN (−2,983)** and **OR (−2,167)**. The tell was that OR is an
> active property with 119 in-house guests yet its newest guest record read
> 2024-02-07. Only an empty page may end the walk. The script now prints
> served-vs-reported per property so this cannot recur silently.
> - I also told Kyle mid-run that the fix "changed nothing" — true for five
>   properties, wrong for those two. Corrected in the same session.
>
> **[x] 4. Method, stated because every choice moves the number:** source is v1.3
> `/getGuestList` per property; **all** reservation statuses (checked in/out,
> pending, cancelled, no-show — it is the guest master, not status-filtered);
> excludes nameless (0 found) and GDPR-anonymized (0 found) records; collapses
> merged duplicates onto the surviving ID (2, both at KE). Names/emails are held
> in memory only to deduplicate — never printed or written.
>
> **[ ] 5. NOT BUILT, offered and not taken up:** an Excel version of the memo for
> attaching to the application. The per-year table was sent in chat and is
> recorded above; the `.md` memo has the full method and caveats.
>
> **[!] 6. Each full run takes ~25 min** (92k records, ~930 paged requests across
> 8 properties). Budget for that, or narrow to one property with the CODE arg on
> the probe script.

---

## 08/05/26 (session 9e) — ROB §6 CONTRACTOR SCHEDULE (Smartsheet, day tabs)

> **Pickup — 08/05/26. SHIPPED AND LIVE.** Branch level with `origin` at
> **`38d8eb7`**; production **`dpl_G56dPFfEsMHFJziyZFvZCL42eJcb` READY**, aliased
> to `dashboard.rentstayable.com`. `tsc --noEmit` exit 0 · `next build` green ·
> **292/292 tests** (18 new).
> - **Live smoke:** `/login` 200 · `/test` 200 · **`/rob` 307 → `/login`**
>   (exec-gated) · `/bea` 307 · `/` 307.
> - **Rollback target `dpl_XA58Mm2shb912pUSspdKAhiWgbdm`** (`4e1724a`). Clean:
>   §6 is additive, read-only, and writes nothing anywhere.
> - **[ ] First real proof is Rob (or exec PIN) loading `/rob` §6.** Everything
>   below the HTTP layer — the Smartsheet token in prod, the live fold — is
>   unverified from here because `/rob` is gated and the token is Vercel-only.
>   If the token were rotated, §6 says so in plain words instead of failing
>   silently.
>
> Kyle: add Smartsheet **1391340150542212** (the contractor schedule) to `/rob`,
> tabbed by day Mon–Fri off the **Date** column, showing **Contractor, Property,
> Task, Status, Latest WhatsApp Update**, defaulting to the current day (ET);
> plus a link so Rob can open the sheet itself.
>
> Shipped as `/rob` **§6 Contractor schedule** — `lib/contractor-schedule.ts`
> (fetch + pure `foldSchedule`), `components/ContractorSchedule.tsx` (day tabs),
> nav item 6, and an **"Open in Smartsheet ↗"** button in the section header
> (`surfaceButton`, new tab, `noopener`).
>
> **The sheet:** "Contractor Schedule 08-03 to 08-07-26" — 65 rows, exactly
> Mon 08-03 → Fri 08-07, **13 assignments per day**, 4 at Davenport (44199), 3 at
> Jacksonville North (812), 6 at Boca Condo. `Latest WhatsApp Update` is populated
> only on Monday (the past day); forward days are blank, which is expected.
> Status picklist: Pending / In Progress / Completed / Delayed / Off.
>
> **[x] 1. DEFECT CAUGHT BEFORE IT SHIPPED — the Date column must be read RAW.**
> Smartsheet returns DATE cells with `value: "2026-08-03"` **and** a
> locale-formatted `displayValue` like `"08/03/26"`. My first `cellText` preferred
> `displayValue` everywhere, which would have made `weekdayOf` reject **every**
> row and render all five tabs empty. `cellText` now takes a
> `prefer: "display" | "raw"` and Date uses `"raw"`. Two regression tests pin it.
> - Weekday is derived by parsing `YYYY-MM-DD` as **UTC midnight**, not local —
>   this machine runs Philippine time, which would have shifted Monday to Sunday.
>
> **[x] 2. The `Day` text column is deliberately IGNORED.** The sheet carries both
> `Date` and a text `Day` ("Monday".."Friday"). Kyle said use Date, and Date cannot
> drift out of sync with itself — a test asserts Date wins when the two disagree.
>
> **[x] 3. `SMARTSHEET_API_TOKEN` — RESOLVED, and my initial alarm was WRONG.**
> It is absent from `.env.local`, so I could not verify the live fetch locally and
> cannot read Vercel env vars from here (no CLI; the Vercel MCP has no env tool).
> I flagged that as possibly breaking THREE sections. That was unfounded:
> - **The token was set in Vercel by Kyle during the evictions session**
>   (this file, line ~1798: "New env vars: `SMARTSHEET_API_TOKEN` (set by Kyle
>   this session)"), and its local absence is deliberate and already documented
>   at line ~1732: "Reviews/evictions can't render locally (no
>   `SMARTSHEET_API_TOKEN` in `.env.local`)."
> - So `/ops` Evictions and One-star reviews are **not** broken, and §6 will work
>   on deploy. **The lesson is mine: check the repo's own record before escalating
>   an env var to a blocker.** Not the `TEAMS_FLOW_URL` shape after all — that one
>   had no such record.
> - Residual (small): nobody has re-verified the token since ~07/08, and a revoked
>   or rotated Smartsheet token would fail silently in the same way. Failure IS
>   graceful and self-diagnosing — the section prints the reason and the rest of
>   `/rob` is unaffected — so the first load of §6 confirms it.
> - `.env.example` now documents the token and all four sheet IDs anyway; it had
>   **no Smartsheet section at all**, which is worth fixing regardless.
>
> **[x] 4. WEEKLY ROLLOVER — ANSWERED BY KYLE 08/05/26: ONE SHEET, THE NAME
> AUTO-CHANGES.** "The file name changes (automatically) for new schedule. but
> same sheet." So the sheet ID **1391340150542212 is stable** and the hardcoded
> default keeps working indefinitely. **No name-pattern resolution is needed** —
> the fix I had queued is cancelled, not deferred.
> - I deliberately did not guess this, and the guess would have been wrong in the
>   expensive direction (building sheet-discovery-by-name for nothing).
> - Two consequences worth knowing:
>   1. The section header printing the sheet's own name is still the right call —
>      it is now how Rob sees WHICH week he is looking at, since the name is the
>      only thing that changes.
>   2. **The sheet holds the current week only** (65 rows = 13 crew × 5 days), so
>      rows are replaced each week. There is no history in Smartsheet to read, so
>      a past-week view is not possible from this source. Not requested; noted in
>      case it ever is — it would need us to bank the rows nightly the way we bank
>      Cloudbeds snapshots.
>
> **[x] 5. Details worth knowing:**
> - Tabs for days with no rows are rendered but **disabled**, so the week's shape
>   is visible rather than the tab silently vanishing.
> - Weekend-dated and undated rows are **counted in a footnote**, never silently
>   dropped — the same principle as the credits footnote on `/bea` §3.
> - Default tab falls back to the first populated day when today is Sat/Sun or
>   today's tab is empty, so Rob never lands on a blank tab. `defaultKey` is
>   resolved **server-side** from `easternToday()` — the browser clock is the
>   visitor's timezone, and Rob's day is Eastern wherever he is.
> - Rows sort by contractor A→Z within a day, so a person holds position across
>   tabs. Deterministic tie-break (property, then task).
> - **This is not guest PII** — contractor names are vendor/crew names, unrelated
>   to the §3 exception. It does name individual workers, so `/rob` staying
>   exec-gated matters; it already is.
> - Used `surfaceButton`, not `chromeButton`: the latter is styled for the navy
>   header (`text-chromeText`) and would be near-invisible on a light section.
>
> **[x] 6. Fixed a stale line in `.env.example`** claiming the home `/` is public
> (no PIN). It has been gated at `base` since 07/08/26.
>
> **[ ] 7. Pre-existing cosmetic bug, NOT fixed (out of scope, flagging):**
> `chromeButton` in `components/ui.tsx:358` reads `bg-white\[.06]` — a stray
> backslash where `bg-white/[.06]` was intended, so that background never applies
> to the four `/rob` header pills. One character; left alone because it is
> unrelated to this request.

---

## 08/04/26 (session 9d) — BEA §3 BALANCE DUE · FIRST GUEST-PII SURFACE

> **Pickup — 08/04/26. BUILT, VERIFIED LIVE, NOT PUSHED, NOT DEPLOYED.**
> `tsc --noEmit` exit 0 · `next build` green · **274/274 tests** (9 new).
>
> **Bea's request (via Kyle): a per-property table of Guest Name + current
> Balance Due + Due Date.** Shipped as `/bea` §3 "Balance due" — property cards
> + All, matching `BeaOosExplorer` and the per-user dashboard convention.
> Columns: **Guest · Room · Balance due · Type (lease/transient) · Check-in**,
> sorted by balance desc, `ExportMenu` for csv/xlsx.
>
> **[!] 1. THIS IS THE FIRST AND ONLY GUEST-PII SURFACE IN THE APP.** Kyle chose
> it explicitly over two PII-free alternatives I offered (room number instead of
> name; aggregate-only). CLAUDE.md §5 rule 2 and §6 are both amended to record
> the reversal rather than leaving the docs contradicting the code.
> - **Consequence, and it is real:** the standing "re-issue all 8 keys WITHOUT
>   Guest scope" security task **can no longer drop that scope.** §5.2 is now
>   enforced by code + the PIN gate, not by the key. Recorded in both files.
> - `/bea` must stay gated (`BEA_PIN` or exec/CEO). The page footer now warns
>   that the table names guests and that exports are confidential.
>
> **[x] 2. THERE IS NO DUE-DATE COLUMN, AND THAT IS A MEASUREMENT, NOT A PUNT.**
> Kyle's answer to "what is Due Date" was *Previous Rent Due*; the data cannot
> supply it.
> - **No such column exists.** Dumped every field of DI datasets 1 and 3:
>   **zero** due / lease / cycle / recurring / term columns. The only "due"
>   fields are balance *amounts* (`reservation_balance_due_amount`,
>   `balance_due_amount` — the latter is just a transaction amount, misleadingly
>   named).
> - **Rent accrues NIGHTLY, it does not post on a cycle.** All 19
>   balance-carrying reservations at LL had Room Rate charges on *every day* of a
>   90-day window, last charge dated **today**, every one. KE and DP match
>   (avg 13.6 charge-days per 28). So "date of last rent charge" would render as
>   today for all 145 rows.
> - A check-in-anniversary due date is derivable but **unverifiable**, and a wrong
>   date in a collections workflow sends Bea after the wrong tenant. Left out.
>   Kyle's call: "Why not use Balance Due" — the amount is the actionable field.
> - **[ ] If aging is ever wanted, the grounded derivation is "unpaid since":**
>   walk each reservation's debits and credits chronologically, take the last date
>   the running balance was ≤ 0. Measured, not inferred. Not built.
>
> **[x] 3. VERIFIED LIVE ON ALL 8 PROPERTIES** —
> `npx tsx scripts/check-balance-due.mts` (masks names by default, `--names` to
> reveal). Portfolio **$161,654.39 across 145 reservations**, and the two-query
> join on `reservation_number` **resolved 100% of rows** (0 missing check-in or
> rate plan). `group_rows` caps at 3 columns and the table needs 5 fields, hence
> two queries joined — same cap `diDataset1Rows` already documents.
>
> | property | outstanding | rows | lease / transient | in credit |
> |---|---|---|---|---|
> | Kissimmee East (2295) | $38,928.67 | 28 | 25 / 3 | 5 · $246.73 |
> | Kissimmee West (5399) | $27,033.74 | 22 | 22 / 0 | 2 · $1,048.38 |
> | St. Augustine (2535) | $20,360.30 | 17 | 17 / 0 | 6 · $1,079.18 |
> | Jacksonville West (6802) | $19,213.80 | 16 | 15 / 1 | 3 · $322.00 |
> | Davenport (44199) | $17,826.80 | 15 | 13 / 2 | — |
> | Orlando OBT (8700) | $16,418.82 | 23 | 23 / 0 | 8 · $3,995.98 |
> | Lakeland (4645) | $15,880.15 | 19 | 19 / 0 | 5 · $1,681.45 |
> | Jacksonville North (812) | $5,992.11 | 5 | 5 / 0 | 1 · $49.68 |
>
> **▶ 4. THREE LARGE TRANSIENT BALANCES WORTH SOMEONE'S ATTENTION** — arrears are
> overwhelmingly lease (139 of 145 rows), which makes these stand out:
> **KE room 114 $10,138.68** (in since 06-19), **JW room 114 $4,612.42**
> (07-10), **DP room 130 $4,713.10** (07-01). Long-staying transients accruing
> nightly without paying. Not a data defect as far as I can tell — but if it is
> one, it is the kind that costs money. **[ ] Worth Bea or Monica eyeballing.**
>
> **[x] 5. Reservations in credit are excluded from totals**, not netted, and
> counted in a footnote (30 portfolio-wide, $8,423.40). Netting would understate
> what Bea has to collect.
>
> **[x] 6. Two stale claims on Bea's page fixed while there:** the footer said
> "room numbers are inventory only (no guest data)" — false once §3 landed — and
> "(Davenport today)", left over from when only one key was configured.
>
> **[x] 7. PUSHED AND DEPLOYED.** Branch level with `origin` at **`f02cdba`**;
> production **`dpl_34hpdHJ31o95NdfXX3AE1v1woMkH` READY** (git-triggered by the
> push), aliased to `dashboard.rentstayable.com`. Rollback target
> **`dpl_6V9PGVSHmPpYxu3hNwdKRQ1FJ1X3`** (`6ff0ed2`).
> - **Live smoke:** `/login` 200 · `/test` 200 · **`/bea` 307 → `/login`** (the
>   PII is gated in production, which is the check that mattered) · `/` 307 ·
>   `/report` 307.
> - A rollback is clean here: §3 is additive, reads Cloudbeds live, and writes
>   nothing. No data to unwind, unlike the 9b OOO repair.
>
> **[x] 8. TWO THINGS I TOLD KYLE THAT WERE WRONG — corrected by checking:**
> - **PINs are NOT Vercel env vars.** I said to "confirm `BEA_PIN` in Vercel
>   Production". `lib/pins.ts` is explicit: PINs live only in the Neon
>   `dashboard_pins` table, with **no env-var fallback** (a level with no row
>   simply cannot log in — fail-safe). Verified with new
>   `node scripts/check-pins.mjs` (reports presence + length, never values):
>   **all 7 levels have a PIN, `bea` included.** Bea can log in today.
> - **"Make a failed Teams post loud" was ALREADY SHIPPED** in `d9a5fead`
>   ("fix(cron): make a failed Teams post loud instead of a cheerful 200") —
>   `TeamsFailure = unconfigured | network | http` in `lib/teams.ts` and the cron
>   returns 500 on failure. Sessions 9b/9c left it marked `[ ]` and I repeated
>   that. It is done; the item below is struck.
>
> **▶ NEXT:**
> 1. **[ ] Show Bea the table and confirm the columns are what she meant**,
>    including that Due Date is absent and why. She has never seen it.
> 2. **[ ] Someone look at the three large transient balances** (item 4 above) —
>    collection failures or a data defect, and either way it is real money.
> 3. Carried forward from 9b/9c, genuinely still open: regenerate the Revenue
>    trigger URL · the PDF-attachment question · the three Monica questions
>    (KE's ~7 unblocked rooms, MTD OOO accumulation, one raw JW/SA export) ·
>    the DP availability-guard false positive · `AUTH_SECRET` unset.
>    ~~make a failed Teams post loud~~ — already shipped, see item 8.

---

## 08/03/26 (session 9c) — LAUNCHED · ONE OCCUPANCY DERIVATION EVERYWHERE

> **Pickup — 08/03/26 ET. THE DAILY REPORT IS LIVE IN THE REVENUE CHAT.**
> Production **`dpl_H1gQryuUKVmTEEfM6hGsf57qaAZq`** (`e6a87f7`), aliased, all
> eight surfaces 200. Note the machine clock reads Philippine time — **Eastern
> is still Mon Aug 3**.
>
> **[x] LAUNCHED.** Four posts to the real Revenue chat, all `202`: the go-live
> post, then Fri/Sat/Sun as a chronological catch-up so the run reads
> continuously. `TEAMS_FLOW_URL` now holds the Revenue flow (`2dfcbfca…`).
> **The 10:30 ET cron takes over from here with no further action.**
>
> **[x] THE REHEARSAL EARNED ITS KEEP.** Kyle asked for a test post first; it
> found that **`TEAMS_FLOW_URL` was never set in Vercel at all**, so the daily
> post had been silently no-oping since 07/22 (see item 12 below). Without the
> rehearsal that would have been discovered by Monica's audience not receiving
> anything.
>
> **[x] SCHEDULE: 10:30 ET, year-round** (`a599187`). Was 10:00 UTC = 06:00 EDT.
> Kyle: the report must reflect the 10:00 ET state and land 10:30–11:00 ET. DST
> drift is 60 min and the window is 30, so no single UTC cron works — two
> entries (14:30 + 15:30 UTC) and a guard let exactly one through.
> `easternMinutesNow()` + 6 tests across both transitions. Bonus: **Monica
> generates her DI export at 14:02 UTC**, so we now read Cloudbeds ~28 minutes
> after her source snapshot instead of 4 hours before it.
>
> **[x] `?asOf=` catch-up** (`93651f3`) — posts a past stay date, refuses
> anything later than yesterday, bypasses the window, and deliberately does not
> re-bank. **[x] PIN line in the card** (`fff3104`) — "Dashboard PIN: MAIN. The
> report files above need no PIN."
>
> **[x] FIVE-DAY VALIDATION vs her real files** (she has now dropped Aug 1/2/3):
> YTD revenue +0.08 / +0.08 / +0.09%, nights +0.03 / +0.03 / +0.04%, inventory
> +0.01% throughout. **[ ] Naming nit: her August files are "Aug 1, 2026"; ours
> say "August 1, 2026". She spells July out and abbreviates August.**
>
> ---
>
> **[x] THE BIG ONE: every surface now derives occupancy the same way**
> (`e6a87f7`). Kyle's rule: **Cloudbeds is the source for PRIMITIVES —
> transactions, the room list, blocks as observed at capture time. We own every
> DERIVATION. Nothing consumes Cloudbeds' pre-computed percentages.**
>
> Measured before the change, 2026-07-05→08-02, `/report` vs home/`/exec`:
> JW **4.2pp**, SA 3.3pp, OR 1.6pp, DP 1.3pp, LL 1.0pp, JN 1.0pp, KW 0.8pp,
> KE 0.6pp — and KE read **83.0% on `/ops`** against 73.7% on `/report`, a
> **9.3pp spread on one property**.
>
> Three causes, in order of size:
> 1. **Numerator.** `/report` counts Occupied = transient + lease + other
>    blocks; DI counts rooms *sold*. Predicted gap from other blocks alone —
>    JW 3.8pp, SA 2.9pp, KE 0.6pp — is nearly the whole observed gap.
>    **Monica includes other blocks too** (her JN row: 20 = 18 sold + 2 other),
>    so `/report` was right and DI was measuring something else.
> 2. **Denominator.** DI divides by 168 at KE (real 167) and 134 at JW (133).
> 3. **`effOcc()` existed in THREE hand-maintained copies** — OccupancyView,
>    ops-insights, ops-pdf-occupancy — and drifted. That is the 9.3pp.
>
> Shipped: `getOccupancyRollup()` in `lib/db.ts` (ratio of sums, from the banked
> snapshots); `buildOccProperties` consumes it; one exported `displayOcc()`
> replaces the three copies and **does not fold in KE's −20** (an
> interpretation, not a measurement — `adjustedOcc()` exposes it separately, the
> way `/report` gives it its own row). ADR/RevPAR moved to the same source so no
> page can mix a snapshot occupancy with a DI rate. **Verified: all 8 properties
> now match the `/report` column to 0.1pp.**
>
> **[x] And room revenue on `/crystal`, `/monica`, `/rob` is no longer an
> estimate.** It was `RevPAR × capacity × days` labelled "est." because "the DI
> public API does not sum currency columns" — no longer true of us; we bank it
> daily and it reconciles to Monica to the cent. Portfolio ADR/RevPAR are now
> revenue-weighted rather than a mean of per-property means.
>
> DI still legitimately feeds pace/pickup and is untouched there.
>
> **[!] Snapshot coverage is now load-bearing for those surfaces:**
> 2025-01-01 → present, 8/8 properties, no gaps (DP from 2025-06-01 and JN 244
> days are their in-service windows, not gaps). **A custom range starting before
> 2025-01-01 will render empty** where DI used to return something.

---

## 08/03/26 (session 9b) — MONICA'S RAW FILE READ · KE GAP SOLVED (same ET day as 9c; the machine clock reads Philippine time)

> **Pickup — 08/04/26. PUSHED AND DEPLOYED.** Branch level with `origin` at
> **`2c03b90`**; production **`dpl_EWEmjuJP5LguBVKCJf6xxy2g4kNq` READY**, aliased
> to `dashboard.rentstayable.com`. Live smoke: `/`, `/login`, `/report`, `/test`
> all 200. Rollback target **`dpl_HEh5Gb2Yjxjqa9hdAXpsxZ8mF7C1`** (`97515f0`) —
> `docs/ROLLBACK.md` updated, including the note that a rollback does NOT undo
> the three repaired OOO rows (they are Neon data, and leaving them corrected is
> the safe combination).
>
> **Everything code-side that I recommended is done and live.** What remains is
> six items, and every one of them needs Kyle or Monica — they are listed at the
> bottom of this block. **The launch itself is now gated on exactly two of them:
> the Power Automate flow edit, and the `TEAMS_FLOW_URL` swap.**
>
> Kyle added four `Occupancy History and Forecast-KE-Jul 28..31.xlsx` in the repo
> root — the Cloudbeds **Data Insights** export she works from, Kissimmee East
> (2295) only, one generation per day at 14:02 UTC. Four snapshots of the same
> data is exactly the experiment we could never run.
>
> **[x] 1. THERE IS NO EROSION. The premise behind the 07/30 fix is wrong.**
> Across 4 generations × 33 stay dates, **not one value ever decreased.** OOO
> *accretes*: it builds as the date approaches and settles on or just after the
> stay day (07-28: 31 on the day → 32 at D+1 → 32 → 32; 07-29: 29 → 31 → 31 → 31),
> then freezes. Everything 07-01→07-26 is byte-stable across all four files.
> - The raise-only `observeBlocks` behaviour is still correct, and the end-of-day
>   cron is harmless. But **its rationale was wrong and it cannot close the KE
>   gap** — which is what five nights of `gain = 0` were already telling us.
> - Kyle's 07/29 report that Cloudbeds refuses past-dated blocks is not
>   contradicted; it just isn't what drives this number.
>
> **[x] 2. OUR KE `ooo = 24` IS A CORRECT READ — of the wrong measure.**
> Live `getRoomBlocks` for KE returns exactly 24 out-of-service rooms every day,
> and the reasons show why it never moves: **19 × "Renovation"** plus five named
> maintenance blocks (flooring, bathroom ceiling leak, deep clean, sliding
> door/walls, pest control). Long-lived blocks, stable for weeks.
>
> **[x] 3. HER KE FIGURE IS DATA INSIGHTS' "Out of Service Rooms" — and we can
> reproduce it exactly.** Dataset 7 drops the count columns over the API
> (`out_of_service_count` bare → omitted, `modifier:"sum"` → 400; the session-3
> finding still holds), but it is **derivable from two columns that do come back**:
>
> ```
> out_of_service = capacity × (1 − occupancy / adjusted_occupancy)
> ```
>
> Validated against her own raw export for all of July at KE: **exact to the room
> on 30 of 31 days.** The single miss is 07-31, where DI has since moved 29 → 31 —
> i.e. accretion, not a formula error. Derived rooms-sold matches hers too.
>
> **▶ 4. SO THE ANSWER TO THE KE QUESTION IS: ~7 rooms are out of service in
> Cloudbeds' occupancy data with NO room block against them.** Exactly the same
> species as JN's unblocked renovation rooms (open item 2), and it explains every
> symptom: constant on our side because blocks are constant, moving on hers
> because room status moves daily.
> - **Operational fix, not a code fix:** get those rooms blocked at KE — or add a
>   KE OOO override the way JN has one. Blocking them is better; the override
>   makes the report right while leaving Cloudbeds wrong.
>
> **[!] 5. DO NOT SWITCH OOO TO DATA INSIGHTS GLOBALLY.** The derivation is only
> validated at KE, against her raw file. Run across all eight, DI disagrees with
> **both** us and her published PDF at several: JW reads DI 12–14 where her report
> and ours both say 6–7; SA DI 17–19 vs 13–15 agreed; OR and KW differ by ±1–3.
> Since our block-based figure already matches her PDF at 7 of 8, blocks are
> evidently the right source there. **One more raw export (JW or SA) settles
> whether her workbook takes OOO from DI everywhere, or from blocks everywhere
> except KE.** Cheap ask, and it decides the whole design.
>
> **[x] 6. THE 429-ZERO ACTUALLY HAPPENED IN PRODUCTION** — session 6 recorded
> "no evidence production has hit this"; that is now superseded. Four
> property-days banked OOO = 0 between non-zero neighbours:
> **KE 07-20 (30 → 0 → 24), LL 07-20 (4 → 0 → 3), SA 07-20 (8 → 0 → 12)** — one
> bad run — plus **LL 06-12 (4 → 0 → 4)**. The `cbGet` retry shipped in `a35e707`
> prevents recurrence. **[?] Repairing the four is a write to banked history and
> needs Kyle's go-ahead** (raise-only means a re-query can only lift them).
>
> **[x] 7. REVENUE AND SOLD RECONCILE AT KE.** Her "Room Rate - sum" matches our
> banked room revenue **to the cent on 30 of 31 July days** (the exception is
> 07-31, still settling). Rooms sold within ±2 all month, +5 room-nights over the
> month (+0.13%).
>
> **[x] 8. HER CAPACITY IS 168 — and it wobbles.** The export reads 168 most days
> but 175 (07-01), 171 (07-15), 169 (07-03/07/08). Ours is 167 flat, and **her
> published PDF also shows 167**, so she does not carry the export's capacity into
> the report. Consistent with the known `getDashboard.capacity` +1 defect at KE,
> and further evidence her workbook re-bases inventory rather than trusting DI.
>
> **[!] 9. AND HER MTD DOES NOT EQUAL THE SUM OF HER OWN DAILIES — so DO NOT
> switch KE to Data Insights.** Her PDF's KE **daily** OOO matches the export
> exactly (31 on 07-30, 32 on 07-28), but her **MTD reads 923 where the export's
> 07-01→07-30 dailies sum to 866** — a 57-room-night gap inside her own two
> files. Switching KE's source to DI would fix the Yesterday column and leave MTD
> wrong by a *different* amount (−57 instead of today's −95). That is not a
> change worth making hours before launch, and it is now a question for her:
> **how does the MTD out-of-order line accumulate?** Recorded rather than acted
> on. Kyle authorised "do everything you recommend" — this is the one thing I
> recommended against, and the finding above is why.
>
> **[x] 10. THE THREE RECOVERABLE 429-ZEROED DAYS ARE REPAIRED.**
> `npx tsx scripts/repair-zero-ooo.mts [--apply]` — dry-run by default, writes
> through the production `getBlockNights` + `observeBlocks` path, and touches
> only the listed property-days rather than the whole portfolio for those dates
> (which would stamp `ooo_observed_at` on seven innocent rows and destroy the
> evidence for whether the nightly cron fired).
> - **KE 07-20 → 24, LL 07-20 → 3, SA 07-20 → 11.** All sit sensibly between
>   their neighbours; KE's 24 is its stable long-lived block set.
> - **LL 06-12 is NOT recoverable** — Cloudbeds now returns zero `out_of_service`
>   blocks for that date, so there is nothing to re-read. Left at 0 rather than
>   inventing a figure. It is the one remaining suspect zero portfolio-wide.
> - **[ ] Small residual:** `observeBlocks` writes `ooo`/`blocks_by_type` only, so
>   LL and SA 07-20 still show `other_blocks = 0` while their `blocks_by_type`
>   now records `blocked_dates` 1 and 3. Two rows, one row of the report,
>   deliberately not fixed by widening a write contract on launch day.
>
> **▶ NEXT — split by who can actually do it:**
>
> **Kyle only (all three block or shape the launch):**
> 1. **[~] ON HOLD (Kyle, 08/04) — checking whether the team actually needs the
>    PDF attached, or whether the card's buttons will do.** The pin-wall reason
>    for needing the attachment is now **gone**: see the token-download item
>    below. Whichever way this lands, the flow edit is no longer a launch gate.
> 2. **[ ] Swap `TEAMS_FLOW_URL` in Vercel** from the test flow to the Revenue
>    chat URL. That swap IS the first live post — do it after item 1.
> 3. **[ ] Regenerate the Revenue trigger URL** (plaintext in a 07/29 transcript,
>    six days old).
>
> **Ask Monica (both are one message, and both are now precisely framed):**
> 4. **[ ] The ~7 unblocked KE rooms** — which rooms, and can they be blocked in
>    Cloudbeds? Blocking them fixes it at source; failing that we add a KE
>    override like JN's.
> 5. **[ ] How does the MTD out-of-order line accumulate?** (item 9 — her own two
>    files disagree by 57.)
> 6. **[ ] One raw export for JW or SA** — decides whether her OOO is DI
>    everywhere or blocks everywhere except KE (item 5).
>
> **[x] 11. THE CARD'S FILE BUTTONS NOW WORK WITHOUT THE MAIN PIN** (`5c17349`,
> `dpl_BH68fdrYkALbqMLyp5MsBsDjFwEb`). Built because Kyle put the attachment
> question on hold, and the pin wall was the whole reason attachments looked
> mandatory. **It was needed either way**: the "Same report in Excel" button
> survives attachment (Monica posts only the PDF, so that link is its only
> route) and was gated identically — so turning `TEAMS_FLOW_ATTACHMENTS=1` would
> NOT have removed the wall.
> - New **`/api/report-file?fmt=pdf|xlsx&t=<token>`**, excluded from the
>   middleware matcher and checking its own token inline — the same pattern
>   `/api/feedback` and `/api/crystal-note` already use. The cron mints a
>   **30-day** signed token per post; the card's two file buttons route through
>   it. **"Open the dashboard" is deliberately NOT tokenised** — a file token is
>   not a pin, and the dashboard stays gated.
> - Scope is "the report files, for a while", not per-user identity. The report
>   is aggregate-only with no guest PII (CLAUDE.md §5 rule 2), so the risk being
>   managed is business confidentiality. The alternative — handing the MAIN pin
>   to the Revenue chat — would have given the whole gated dashboard away to
>   deliver one file.
> - **Verified end to end** against the built app: valid token → **200**, real
>   593 KB PDF (`%PDF-1.3`) and 33 KB `.xlsx` (`PK\x03\x04`), both named
>   `Occupancy Report as of August 3, 2026.*` exactly as Monica names hers.
>   Missing / forged / expired → **403**. `/report` and `/report/latest.pdf`
>   still **307** to `/login`, so nothing was opened up by accident.
> - **In production the rejection path is confirmed** (403 as JSON, i.e. our
>   handler ran — middleware would have sent a 307). The accept path could not
>   be exercised from here: prod's signing secret differs from local, so a
>   locally-minted token is correctly refused. The cron mints its own
>   server-side, so this is expected — but it means **the first real proof is
>   the first posted card. Click the PDF button on it.**
> - **[!] FRAGILITY WORTH KNOWING:** `secret()` in `lib/auth.ts` falls back to
>   `DATABASE_URL` when `AUTH_SECRET` is unset. Rotating the Neon connection
>   string would therefore invalidate every outstanding 30-day report link (and
>   every login cookie — that part is pre-existing). Setting an explicit
>   `AUTH_SECRET` in Vercel would decouple them. Not done; flagged.
>
> **[!] 12. `TEAMS_FLOW_URL` IS NOT SET IN VERCEL PRODUCTION — THE DAILY POST HAS
> NEVER WORKED FROM THE CRON.** Found by firing the production cron as a
> rehearsal (Kyle asked for a test post before going live — this is exactly what
> that caught).
> - Response: `{ok:false, status:0, attached:0}`. That is not a Teams failure,
>   it is the **unset-URL branch**: `postAdaptiveCard` returns literally that
>   tuple on `if (!url)` (`lib/teams.ts`). A real HTTP failure carries a non-zero
>   status.
> - **This corrects a belief recorded in session 6.** "Posted to the TEST channel
>   and confirmed rendering (Kyle, 07/29)" was a **local** run reading
>   `.env.local` — never the production cron. So the card leg was verified, and
>   the *delivery* leg never was.
> - **It has been failing silently every day.** `postAdaptiveCard` never throws
>   by design (a Teams outage must not fail the snapshot banking), and the cron
>   returns `ok:false` in a JSON body nobody reads. Everything else in the same
>   run is healthy: `snapshotsWritten: 8`, `gapsLast14d: 0`.
> - **[ ] Kyle: add `TEAMS_FLOW_URL` to Vercel Production and redeploy.** Set it
>   to the **test** flow first (workflow `80063dcc…`, the value already in
>   `.env.local`), so the rehearsal is real. Then swap to the **Revenue** flow
>   (`2dfcbfca…`) for go-live. Env changes need a redeploy to take effect.
> - **[x] Then make this failure loud — DONE** in `d9a5fead`, same day.
>   `postAdaptiveCard` now returns `reason` (`unconfigured | network | http`) and
>   the cron responds 500 when the post fails, so Vercel marks the invocation
>   failed. (Left marked open here until 08/04/26 — see session 9d item 8.)
>
> **[x] 13. Date check while doing the above:** the machine's clock is Philippine
> time (UTC+8), so it reads Aug 4 while **Eastern is still Mon Aug 3**. The cron
> resolved `asOf = 2026-08-02`, file label "Occupancy Report as of August 3,
> 2026" — correct, and it matches one of the three PDFs already in `outputs/`.
>
> **[ ] 14. Availability guard fired on DP** — 34.2% average available across
> 2026-07-20→08-02 (14 days). Almost certainly a **false positive**: Davenport
> genuinely runs ~66% occupancy (101/153), and the guard's threshold is a flat
> ≥25% for 7+ days. Worth re-basing the threshold per property before it trains
> everyone to ignore the alert.
>
> **Mechanical, whenever:**
> 7. Today's PDFs are still to be dropped; `diff-reports.py` is ready.
> 8. Re-check end-of-day capture coverage over the next few nights now the retry
>    has shipped (it was 5/8 and 4/8 on two of five nights).

---

## 08/03/26 (session 9) — 3-DAY CATCH-UP RENDERED · OOO GAP IS NOW **KE ONLY**

> **Pickup — 08/03/26. Three PDFs generated for today's comparison with Monica.**
> Kyle's plan: check our 3 files against the 3 she posts today, compare notes,
> improve, launch tomorrow.
>
> **The files, in `outputs/` (her naming — label date = stay date + 1):**
> | our file | stay date | weekday |
> |---|---|---|
> | `Occupancy Report as of August 1, 2026.pdf` | 2026-07-31 | Friday |
> | `Occupancy Report as of August 2, 2026.pdf` | 2026-08-01 | Saturday |
> | `Occupancy Report as of August 3, 2026.pdf` | 2026-08-02 | Sunday |
>
> `Occupancy Report as of July 31, 2026.pdf` (stay date 07-30) was also rendered
> because **hers for that day was already in the repo root**, so it could be
> diffed immediately rather than waiting.
>
> **[x] TWO NEW TOOLS, both reusable and committed:**
> - `npx tsx scripts/render-report.mts <asOf> [asOf...]` — renders the real PDF
>   for any past stay date through the same builder the cron uses.
> - `python scripts/diff-reports.py "<hers.pdf>" "<ours.pdf>"` — metric-by-metric
>   delta per property × period, plus a portfolio roll-up, with per-metric
>   tolerances. `parse-monica-pdf.py` was refactored to expose `parse_report()`
>   so **one parser reads both sides**. Validated by reproducing the session-6
>   head-to-head exactly (YTD +0.08% / +0.02% / +0.01%).
>
> **▶ THE HEADLINE FINDING — the OOO gap is not erosion, and it is KE alone.**
> Day-level OOO, hers vs ours, on the Yesterday column of two independent days:
>
> | | LL | JN | JW | **KE** | KW | OR | SA | DP |
> |---|---|---|---|---|---|---|---|---|
> | stay 07-28 | 0 | 0 | 0 | **−8** | 0 | 0 | 0 | 0 |
> | stay 07-30 | 0 | 0 | 0 | **−7** | 0 | 0 | 0 | −1 |
>
> **Seven of eight match exactly.** KE is short by a near-constant ~7 rooms every
> single day, which is what produces its MTD −95: 7 × ~13 days. That is
> structural, not a capture-timing artifact.
> - **This contradicts the erosion hypothesis for KE** (session 6). The 03:00 UTC
>   end-of-day capture has now run five consecutive nights and **`gain` is 0 on
>   every property-day** — the earlier read never once beat the flash. KE's
>   banked 07-30 figure is 24 from BOTH the eod capture and the flash, while she
>   reports 31. Capturing earlier cannot close a gap that is the same at 23:00 ET
>   as it is at 06:00 ET the next morning.
> - **The remaining explanation is definitional, and it is the same class of
>   thing as JN's 107 override:** rooms Monica counts as unsellable that are not
>   blocked in Cloudbeds. Memory `monica-occupancy-workbook` already records that
>   her OOO is an *operational* count. **Ask her directly today: which 7 KE rooms,
>   and are they blocked in Cloudbeds?** This is the highest-value question on
>   the list and it is answerable in one message.
> - **The LL −10 / JW −10 / SA −11 MTD gaps are pre-fix residue** on days banked
>   before 07/30, not a live defect. They are exactly what the backfill decision
>   (below) is about, and nothing else now feeds them.
> - Also: JN "Other blocks" is −2 on both days (hers 2, ours 0), and DP was −1 on
>   07-30. Small, but consistent enough to name.
>
> **[x] 429 HARDENING SHIPPED — the old open item, and it was blocking today.**
> The first render produced 33 of 56 on-the-books OOO cells as ZERO at LL/KW/OR
> because `getRoomBlocks` was 429ing and the caller treats a failure as 0. Added
> a bounded retry to `cbGet` itself (`retryDelayMs`, 3 attempts, honours
> `Retry-After` capped at 10s, exponential 0.5/1/2s otherwise, jittered so eight
> concurrent property fetches don't retry in lockstep) — one central fix rather
> than per-caller. Re-rendered: **zero 429s**, and the only remaining zero cells
> are LL and DP tapering to 0 at the far end of the forward window, which is real
> (no blocks scheduled that far out) and identical across all three files.
> 5 new tests in `lib/cloudbeds-retry.test.ts`. **This also closes the production
> hazard**: a 429 during the flash cron could previously bank OOO = 0 permanently.
>
> **[x] The end-of-day cron IS firing — but it is skipping properties.**
> Verified by observed-at timestamps, five nights running:
> | stay date | properties with an eod capture | skipped |
> |---|---|---|
> | 07-29 | 8/8 | — |
> | 07-30 | 8/8 | — |
> | 07-31 | 5/8 | KE, LL, SA |
> | 08-01 | 4/8 | JW, KW, LL, SA |
> | 08-02 | 8/8 | — |
> The skip path is working as designed (a failed fetch is skipped, never written
> as 0), but **12 property-days in five have no end-of-day reading at all** —
> almost certainly the same 429. The retry above should fix this too; **check the
> next few nights before calling it closed.**
>
> **[!] Observation, not yet a decision: the report's Yesterday column is always
> a LIVE fetch**, even when `asOf` is a past date (`getRevenueReportInputs`,
> `lib/cloudbeds.ts:1596`). So it never reads the banked max-observed `ooo` that
> the 07/30 fix exists to maintain — the fix protects the MTD/YTD roll-ups only.
> On the production path (asOf = actual yesterday) the live read is the intended
> earliest source, so this is not currently costing anything, and the 7-of-8
> match above shows the live read is accurate. But it is why re-rendering a past
> date drifts a room or two from `show-snapshot.mjs` (OR −1, SA −1, KW +1 on
> 08-01). Worth deciding, not worth rushing.
>
> **Portfolio parity is stable across both compared days:**
> | | stay 07-28 | stay 07-30 |
> |---|---|---|
> | YTD room revenue | +0.08% | +0.08% |
> | YTD occupied room-nights | +0.02% | +0.03% |
> | YTD inventory room-days | +0.01% | +0.01% |
>
> **▶ FOR TODAY'S COMPARISON WITH MONICA — in priority order:**
> 1. **[ ] Ask about the 7 KE rooms.** The one question that closes the last
>    live per-day gap. See above.
> 2. **[ ] Show her the transient/lease split table** (carried over, still the
>    most efficient thing to resolve — one classification rule, not eight
>    problems).
> 3. **[ ] Agree the block-type → "Other blocks" mapping** (JN 2 vs 0 is the
>    live instance; KE 14 vs 27 and OR 3 vs 12 are the historical ones).
> 4. **[?] DP inventory YTD +14 room-days** — unchanged and still unexplained.
> 5. **[?] The historical-OOO backfill decision** is now better framed: it is
>    LL/JW/SA pre-07/30 days only, plus whatever KE turns out to be.
> 6. **[ ] Kyle: the Power Automate flow edit** + `TEAMS_FLOW_ATTACHMENTS=1`.
>    Still the only unproven leg of delivery, and launch is tomorrow.
> 7. **[ ] Regenerate the Revenue-chat trigger URL** — five days old in plaintext
>    now.
>
> Verified this session: `tsc --noEmit` exit 0 · `next build` green ·
> **242/242 tests**.

---

## 08/02/26 (session 8) — ROB HEADER LINKS SHIPPED · HANDOFF DEADLINE IS TOMORROW

> **Pickup — 08/02/26. SHIPPED AND LIVE.** Branch level with `origin` at
> **`97515f0`**; production deploy **`dpl_HEh5Gb2Yjxjqa9hdAXpsxZ8mF7C1` READY**,
> aliased to `dashboard.rentstayable.com`. Rollback target is
> **`dpl_AWt9zKVFGF1QY1QAKmxNGtgrvWB4`** (`3d29785`). Working tree clean apart from
> the two intentionally-untracked items (`Property management dashboard system/`,
> `outputs/Occupancy Report as of July 29, 2026.pdf`).
>
> **▶ THE HANDOFF IS DUE MONDAY 08/03 — TOMORROW. Nothing on that list moved this
> session.** All three blockers below are exactly where session 6 left them. The
> compare-notes-with-Monica window (through Fri 07/31) has now passed unused.
>
> **What this session did** (one small feature, start to finish):
> - **[x] Four external system links in the `/rob` header.** Rendered as
>   `chromeButton` pills in the navy `PageHead`, top-right of "Rob's View":
>   **Checklist** → `ops.rentstayable.com` · **Rewards** → `rewards.rentstayable.com`
>   · **Invest** → `invest.rise8companies.com` · **Lock** → `lock.rentstayable.com`.
>   New tab + `rel="noopener noreferrer"` so Rob never loses dashboard state.
>   `EXTERNAL_LINKS` at `app/rob/page.tsx:32`.
> - **[x] Label is "Checklist", not "Ops" (Kyle, 08/02).** The href is unchanged —
>   `ops.rentstayable.com` is the checklist app. Renamed before the commit.
> - **Scoped to `/rob` only.** The shared nav (`components/NavLinks.tsx`) is
>   untouched, so no other surface changed. Deliberate: "header of Rob's Dashboard"
>   means his page, and the chrome is shared by all eight gated surfaces.
> - Verified: `tsc --noEmit` exit 0 · `next build` green · **237/237 tests**.
>
> **[x] The four link targets are real projects in the same Vercel team** —
> `checklist-app`, `rewards`, `investor-portal`, `lock-app` (plus `lock-middleware`).
> That is what corroborated the Checklist rename.
> **[ ] NOT verified: that the custom domains are aliased to those projects.** Only
> `dashboard.rentstayable.com` was confirmed as a live alias (it is on our own
> deployment). If a pill 404s, the subdomain is unassigned — a Vercel Domains fix,
> not a code fix.
>
> **▶ START HERE NEXT SESSION — unchanged from session 6, and now overdue:**
> 1. **[ ] Confirm the 03:00 UTC `capture-blocks` cron fired.** Three nights have
>    now passed since it deployed and **nobody has looked**. Run
>    `node scripts/show-snapshot.mjs 2026-07-30` (also 07-31, 08-01) and check
>    `ooo_eod` is populated for 8 properties, with `gain` where the flash read
>    lower. This is the evidence that the OOO fix works in production.
> 2. **[ ] Kyle: edit the Power Automate flow** for real PDF attachments, then set
>    `TEAMS_FLOW_ATTACHMENTS=1`. `docs/TEAMS-ATTACHMENTS.md`. Until then the card's
>    PDF button is gated behind the MAIN pin.
> 3. **[?] Decide on the historical-OOO backfill from Monica's workbook.** The
>    07/30 fix is forward-only; without this, history never reconciles.
> 4. **[ ] Regenerate the Revenue-chat trigger URL** (plaintext in a 07/29
>    transcript). Cheap, and it should not keep ageing.
> 5. Then the session-6 list: DP inventory +14 room-days, the transient/lease split
>    table for Monica, the block-type mapping, the 429 hardening, the DI-occupancy
>    decision.

---

## 07/30/26 (session 7) — PROCESS DECISION: no more Smartsheet auto-push

> No code changed this session. One standing decision, recorded so it is not
> re-litigated:
>
> **[x] Stop writing action items to the Smartsheet Action Items Staging Sheet
> (1981210199805828).** Kyle found rows created unprompted by prior Claude Code
> sessions on this repo and said do not do it again. Effective now: **no Smartsheet
> writes and no reads** from this project unless Kyle asks in the moment. Surfaced
> action items go in this file or in chat instead. Saved to project memory as
> `no-smartsheet-autopush.md`.
>
> **The five rows already created are left in place, untouched** — 288, 292, 296,
> 297, 298 (07/28–07/29/26). References to them elsewhere in this file (e.g.
> "Smartsheet 296") are still valid pointers; they were not deleted.
>
> **[?] OPEN — Kyle only: the org-level instruction still says to auto-push.**
> The RISE8 organization instructions state the staging sheet "receives any task
> surfaced in any session, without being asked," and org instructions override
> individual preferences. So every new session is told to do the thing we just
> stopped doing. Project memory holds the line, but the conflict is structural.
> - Editing org settings affects **all RISE8 users**, not just Kyle. Personal
>   `~/.claude/CLAUDE.md` does *not* win against org text, so it is not a fix.
> - Recommendation: **narrow, don't delete** — the auto-push is plausibly useful
>   for ops/legal/finance sessions; it is engineering sessions that generate the
>   noise. Reword to fire *when asked* or *when the task has a named human owner
>   outside the session*, rather than "without being asked."
> - Claude cannot see or edit org settings. Kyle does this in the admin console.
>   Offer to draft replacement wording was left on the table, not yet drafted.
>
> Also noted while reviewing the existing rows (not acted on):
> - Row **292**'s source tag reads 07/29/26 but it was created 07/28 3:20 PM.
> - Row **297** is a live security item — a SAS-signed Power Automate trigger URL
>   was pasted in plaintext into a transcript on 07/29. Still Not Started. That one
>   should not age; rotating it is cheap.

---

## 07/30/26 (session 6 close) — CHECKPOINT · HANDOFF DUE MONDAY 08/03

> **Pickup — 07/30/26. PUSHED AND DEPLOYING.** Branch level with `origin` at
> **`bffde91`**; production deploy `dpl_4nBVVmMSDWYLvQMxN1wuGwT5NbhS` triggered
> for it (previous READY release was `dpl_C7VaenTK5C5ijoaz3AobtrnxEz5U` /
> `6ea740e` — that is the rollback target). Working tree clean apart from two
> intentionally-untracked items: `Property management dashboard system/` (the
> design source of record) and `outputs/Occupancy Report as of July 29, 2026.pdf`.
>
> **▶ DEADLINE: compare notes with Monica through Friday 07/31, complete the
> handoff by Monday 08/03 — earlier if possible (Kyle, 07/30).**
>
> **▶ START HERE — the three things that block handoff:**
> 1. **[ ] Confirm the 03:00 UTC `capture-blocks` cron fired.** It only exists in
>    production as of this deploy. Tomorrow morning run
>    `node scripts/show-snapshot.mjs 2026-07-30` and check `ooo_eod` is populated
>    for 8 properties and `gain` where the flash read lower. **This is the whole
>    point of Friday's comparison being better than today's.**
> 2. **[ ] Kyle: edit the Power Automate flow** so the PDF lands as a real channel
>    attachment — SharePoint **Create file** on `triggerBody()?['files'][0]`, then
>    post step reads `triggerBody()?['card']`, then set
>    `TEAMS_FLOW_ATTACHMENTS=1`. Runbook: `docs/TEAMS-ATTACHMENTS.md`. Until then
>    the card's PDF button stands in, and **it is gated behind the MAIN pin** — so
>    either do this or distribute the pin before handoff. Smartsheet **296**.
> 3. **[?] Decide whether historical OOO gets backfilled from Monica's workbook.**
>    The 07/30 fix is forward-only; banked days are frozen and the true past
>    figures are gone from Cloudbeds. Without a backfill, history keeps showing our
>    lower OOO (LL −11, JW −10, SA −11, KE −81 MTD) and will never reconcile.
>    Same mechanism as the 2025/2026 count backfill, so it is a known quantity.
>
> **▶ Then, in rough priority:**
> 4. **[?] DP inventory YTD +14 room-days** — the only property where inventory
>    does not match hers, and it carries the largest MTD revenue gap (−2.3%).
>    A capacity-change boundary is probably a day off (DP moved 151→150→152→153).
> 5. **[ ] Show Monica the transient/lease split table.** Ours puts less in
>    transient and more in lease at every property and the two nearly cancel
>    (KE: −$27,425 / +$30,160 / net +$2,735). One classification rule, not eight
>    problems — the most efficient thing to resolve with her.
> 6. **[ ] Agree the block-type → "Other blocks" mapping** (KE 14 vs 27, OR 3 vs
>    12). `blocks_by_type` is stored per Cloudbeds type, so it is answerable now.
> 7. **[ ] Regenerate the Revenue-chat trigger URL** — pasted in plaintext into a
>    transcript 07/29. Smartsheet **297**.
> 8. **[ ] Harden the block fetch against 429** (Smartsheet **298**). Partly
>    mitigated already: `ooo` is raise-only, so a rate-limited zero can no longer
>    overwrite a real figure.
> 9. **[?] Item 6 of session 3b is still undecided** — should home/`/exec`
>    occupancy stop using Data Insights and compute nights ÷ inventory the way
>    `/report` does? DI is the only place Cloudbeds' inflated denominator still
>    reaches us. Also **send** `outputs/CloudbedsCapacityDefect_2295-6802_072826.md`,
>    and get the room-type-change date from Monica.
>
> **What this session delivered** (9 commits, `6ea740e..bffde91`):
> - Monica's daily report **reproduced page-for-page** — her 10-page layout, her
>   property order, her header wording, her negative-currency format, her
>   Sources/Notes/Legend, her file name, her greeting.
> - **Teams message body** matched to hers (5 real posts reviewed), with our
>   portfolio figures + last-year variance added on top. Posted to the TEST channel
>   three times and confirmed rendering.
> - **Attachment path built, env-gated** (`TEAMS_FLOW_ATTACHMENTS`), so the code
>   deploy and the flow edit are independent and rollback is one variable.
> - **Head-to-head vs her real 07/29 report: YTD revenue +0.08%, room-nights
>   +0.02%.** Every remaining difference traced to a named open item.
> - **The OOO gap root-caused and fixed forward** — Cloudbeds blocks erode for past
>   dates, so `ooo` is now the max observed on or after the stay date, fed by a new
>   end-of-day capture cron.
> - **Confirmed the crons fire unattended** (session-4 open item, now closed).
> - Two real defects found and fixed that nobody had reported: nondeterministic
>   property order in the report, and the `.xlsx` branding itself "SAMPLE".
>
> **Corrections I made to my own earlier claims this session** — worth knowing so
> they are not re-derived: the Yesterday column moving is NOT ledger settlement
> (the banked row shows drift $0.00; it was rate-limit-induced data loss); the
> property order was NOT LL/JN/JW/KE/**OR/KW**/SA/DP (reading pypdf text order is
> unreliable — use label y-coordinates); the payload is NOT ~72 KB (580 KB); and
> the OOO fix is capture EARLIER, not later.

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

### Later the same session — keys rotated, two more defects found and fixed

Kyle rotated **all 8** Cloudbeds keys (DP included), added them to Vercel and to
`.env.local`, and redeployed. Having all 8 locally for the first time closed the
KE question and exposed a second, related defect.

- **[x] All 8 keys verified.** `node scripts/audit-keys.mjs` → 8 OK / 0 error,
  each resolving the right `apiPropertyId`. Scopes confirmed working by a full
  restatement run (0 failures), not just by auth.
- **[x] KE 167 vs 168 RESOLVED — Monica was right, `getDashboard` is wrong.**
  `/getRooms` agrees with her on all 8 properties; `getDashboard.capacity`
  over-reports by exactly 1 at **KE (168 vs 167)** and at **JW (134 vs 133)**,
  with Lakeland as a clean control (157/157). Per-room-type counts sum to the
  `/getRooms` figure at both, so the extra room exists only in the aggregate.
  Inventory now comes from the room list (`getPhysicalRoomCount`, falls back to
  capacity and logs if the Room scope is missing). **This also found the JW
  defect, which nobody had spotted** because JW's banked history came from her
  workbook and was already right.
- **[x] Restated all 8 properties** (trailing 8 days, 64 rows, 0 failures).
  Portfolio YTD occupancy **79.74% vs her 79.75%**; MTD −0.03pp; **inventory now
  exact on every property, every period**; transient nights match on 7 of 8,
  lease nights on 7 of 8.
- **[x] Room blocks are no longer restated** (new finding, `restateSnapshot`).
  Re-querying them DEGRADED the figures: LL's 7/26 out-of-order fell 6→4 and JW's
  6→5, both away from her published numbers that our own 06:00 flash had matched
  exactly. `/getRoomBlocks` has no as-of view, so a tidied-up expired block just
  disappears. Blocks now freeze at first capture while revenue and nights keep
  restating; `other_blocks` is split so its comp half still settles. Verified by
  a second restatement leaving block figures untouched.
- **[x] Deployed.** `c5237b6` READY on `dashboard.rentstayable.com`. Rollback
  runbook + deployment IDs in `docs/ROLLBACK.md`; known-good tag
  `pre-redesign-072826`.
- **[!] COST OF THAT ORDER OF OPERATIONS:** the block-freeze landed AFTER the
  first restatement pass, so 7/20–7/27 out-of-order at LL and JW now carries the
  re-queried value rather than the original capture. Not back-filled from her PDF
  — that would be adopting her figure where it can't be independently verified.

**▶ Open items:**
1. **[~] Raise the capacity bug with Cloudbeds — WRITE-UP READY, NOT YET SENT:**
   `outputs/CloudbedsCapacityDefect_2295-6802_072826.md`. Kyle to send.
   **MONICA CONFIRMED THE CAUSE 07/28/26** (via Kyle) and it closes the one loose
   end in the analysis:
   - **Trigger = a room-type adjustment** (here, a room-type change on transient
     rooms). "pag nag adjust ng room type, naggaganyan si CB."
   - **It normally self-heals overnight** — "by tomorrow naayos yung number."
   - **KE is the stuck exception:** corrected at her request and it reverts —
     "kahit ipina pa adjust ko, bumabalik… tumatambay sa 168."
   - **This explains the LL anomaly I could not account for.** LL showed a ÷158
     DI denominator on 5 of 10 days while `capacity` read 157 correctly. Not a
     separate defect — LL had simply healed before I read `capacity`. So **every
     property is exposed for some window after a room-type edit**, and KE/JW are
     not special; KE is just the one that never clears.
   - Real counts are therefore **167 (KE)** and **133 (JW)** — which is what the
     code already uses, so no code change follows from her answer.
   - **The sharper worry now:** if DI stores a per-day inventory snapshot, stale
     inflated denominators persist in HISTORY even after the live figure heals.
     That is Question 3 in the write-up.

   The three findings behind it, all re-verified live 07/28/26:
   - `getDashboard.capacity` is +1 at KE (168 vs 167) and JW (134 vs 133); the
     other six match exactly.
   - **The phantom room exists ONLY in the aggregate.** `getRoomTypes` Σ
     `roomTypeUnits` = 167/133 and `/getRooms` grouped by type = 167/133 — two
     independent room-level counts, both disagreeing with `capacity`. So it is
     not "a real room the property doesn't sell"; that reading is now ruled out.
   - **NEW, and the reason this is bigger than KE+JW:** Data Insights occupancy
     (dataset 7) carries the same inflation. Testing which denominator makes
     `occupancy% × d` a whole number over 07-18→07-27: KE is `÷168` on **10 of
     10** days; JW mixes `÷134` (7d) and `÷133` (3d); and **LL — our control,
     whose `capacity` is correctly 157 — comes out `÷158` on 5 of 10 days**
     (e.g. 79.74683544303798% = 126/158 exactly). So the DI denominator is
     per-day, and it exceeds the room list at a property whose capacity field is
     fine. Question 3 in the write-up is the one that matters to us.
2. **[?] JN renovation rooms are STILL not blocked in Cloudbeds.** The audit found
   **zero** `out_of_service` blocks at JN, so the 107 is entirely our config
   override. Get them blocked, confirm the sellable count of **20** (inferred
   from her OOO, unconfirmed), then delete `sellableOverrides`.
3. **[?] $125,911.92 of JN room revenue** on May–Nov 2025 days with zero occupancy
   (tapering lease run-off, $22k → $3.5k). Her report excludes it entirely; we
   kept it with zero inventory so the difference stays visible. Business ruling.
4. **[ ] Agree the block-type → "Other blocks" mapping with Monica** so both sides
   define the line identically (OR read 11 MTD vs her 0). Composition is now
   stored per `roomBlockType`, so it is answerable.
5. **[ ] Residual ±1s:** JW transient nights 30 vs 29 and SA lease nights 104 vs
   103 on 7/26; 7/25 DP gives 13 transient where she reports 12. Sub-1% and may
   be on her side. Re-check after a few nights of restatement.
6. **[x] Room COUNTS across the app now come from the room list.** `getPortfolio`
   pairs each dashboard with `physicalRooms` (`getPhysicalRoomCount`, now
   exported), and every consumer that a person reads as a room count was switched
   over: `lib/occupancy.ts` (home + `/exec` occupancy explorer, incl. the
   portfolio weighting and KE's effective-capacity re-basing), `app/page.tsx`
   TOTAL INVENTORY + in-house %, `lib/revenue.ts` ADR/RevPAR weights,
   `lib/ops-pdf-ooo.ts`. Falls back to `capacity` and keeps a non-zero dashboard
   figure if the room list is unreachable. 3 new tests in `lib/occupancy.test.ts`.
   - **[!] This does NOT make home occupancy match `/report`, and it was wrong to
     imply it would.** Those views' occupancy *percentages* come from Data
     Insights pre-computed (`rawOcc`), not from our denominator — so they inherit
     DI's per-day denominator (item 1, finding 3). What the fix corrects is every
     displayed room count, the portfolio weighting, and KE's adjusted line.
   - **[?] OPEN DECISION:** to make those views agree with `/report`, we would
     have to stop using DI occupancy on them and compute nights ÷ inventory the
     way `/report` does. That is a real change (DI also feeds ADR/RevPAR there),
     so it is Kyle's call, not a silent refactor.
7. **[ ] On-the-books 7-day grid never validated** against her figures — future
   days post no transactions, so it still uses the dataset-3 path.
8. **[x] `npx tsc --noEmit` is CLEAN** (exit 0) for the first time in several
   sessions. The long-standing `lib/ops-pdf-ooo.test.ts` fixture error is fixed
   (the 4 missing `DashboardData` fields added) — it had to be, because the
   `physicalRooms` field surfaced three more errors in the same file. 208/208
   tests pass; `next build` green.

---

## 07/29/26 (session 6) — MONICA'S REPORT REPRODUCED + ATTACHMENT PATH BUILT

> **Pickup — 07/29/26 (session 6). BUILT, TESTED, COMMITTED LOCALLY. NOT PUSHED,
> NOTHING POSTED TO TEAMS.** 225/225 tests, `tsc --noEmit` clean, `next build`
> green. Attachments are OFF by default, so a deploy changes no Teams behaviour.
>
> **Her layout is now fully specified and matched.** Read off
> `Occupancy Report as of July 27, 2026.pdf` (repo root, hers): 10 pages —
> 4× ACTUAL two properties per page, a Sources/Notes/Legend page, 4× ON-THE-BOOKS
> two per page, in the order **LL, JN, JW, KE, OR, KW, SA, DP**. Our PDF now
> renders the same 9 pages + a methodology page, verified by extracting text from
> a real 8-property render.
>
> - **[x] Property order was NONDETERMINISTIC and is now hers.**
>   `getRevenueReportInputs` builds properties concurrently and `push`ed as each
>   resolved, so page order changed run to run. `sortByReportOrder` +
>   `REPORT_PROPERTY_ORDER` fix it. This is the one real defect found this session.
> - **[x] Headers match hers:** period name over value/`Last Year`/`Variance`, then
>   a `History` row of concrete ranges (`26-Jul-26`, `Jul 1 - 26, 2026`,
>   `Jan 1 - Jul 26, 2026`). On-the-books gains her weekday row
>   (`Monday`…`Sunday`) over the dates. Both in the .pdf and the .xlsx.
> - **[x] The .xlsx no longer says "SAMPLE".** Its banner read
>   `SAMPLE / Cloudbeds-sourced - differs from Monica's Yardi-blended lease…` —
>   unshippable on a file that replaces hers, and the Yardi half is stale anyway
>   (2026 is 100% Cloudbeds). Now a plain title row; the caveat stays on the Notes
>   sheet via `report.sourceNote`.
> - **[x] Sources/Notes/Legend page** in her wording where it still holds. Her
>   Yardi line is deliberately NOT reproduced — we don't use that source for 2026,
>   and copying it would state a lineage we can't stand behind. Our
>   freshness / final-through / OOO-override lines fold in.
> - **[x] Attachment delivery, env-gated.** `postAdaptiveCard(card, files)` posts
>   `{card, files:[{name, contentBase64}]}` **only** when
>   `TEAMS_FLOW_ATTACHMENTS=1`; otherwise byte-identical to today's body. This
>   deliberately replaces the old "the code change and the flow edit MUST land
>   together" plan — the gate makes them independent and the rollback instant.
> - **[x] Files named exactly as she names hers** —
>   `Occupancy Report as of July 29, 2026.pdf`, title date = run date = `asOf + 1`
>   (verified against her file, whose Yesterday column is 26-Jul-26).
> - **[x] PDF ONLY (Kyle, 07/29/26).** The `.xlsx` is NOT attached — that is her
>   working model, not her post. It stays on `/report/latest.xlsx` and keeps its
>   card button; only the now-redundant "Download PDF" button is dropped.
> - **[x] TWO fidelity defects found by checking her file properly, not by eye:**
>   1. **Property order was wrong in my first pass.** Reading pypdf's extracted
>      text order gave `… OR, KW …`; her real order is **KW before OR**. pypdf
>      emits the two labels on a page in arbitrary order (page 1 lists JN before
>      Lakeland). Correct method: the **y-coordinate** of each `Stayable <name>`
>      label. Her Jul 24 and Jul 27 files agree, ACTUAL and ON-THE-BOOKS both.
>      Confirmed independently by inventory — her page-3 first table is 160 rooms
>      (= KW live) and the second is 135 with a 133→135 move (= OR live).
>      **Final order: LL, JN, JW, KE, KW, OR, SA, DP.**
>   2. **Block headings read `Lakeland`, hers read `Stayable Lakeland`** — and
>      Orlando is `Orlando OBT` in our config but `Stayable Orlando` in hers.
>      `reportDisplayName(code, name)` fixes both, keyed by code so a config
>      rename can't silently change the heading.
> - **[x] Verified by position, not by eye:** our render's label y-coordinates now
>   match hers page-for-page and block-for-block, including page 1's shift for the
>   `ACTUAL` header. 10 pages either side.
> - **[x] Real PDF from LIVE data:** `outputs/Occupancy Report as of July 29,
>   2026.pdf` (asOf 2026-07-28, 8/8 properties). **Review this against hers.**
> - **[!] Size estimate in the first pass was wrong.** ~72 KB came from a
>   single-property export; the real 8-property PDF is **580 KB → 773 KB base64**.
>   Still fine (hers are 150–620 KB), but corrected in the docs.
> - **[x] Gated-download side finding FIXED.** With files in the channel the card
>   drops its Download Excel/PDF buttons — they pointed at `/report/latest.*`,
>   which `middleware.ts` gates behind the MAIN pin, i.e. a login wall for anyone
>   in the Revenue chat without it.
> - **[x] Runbook: `docs/TEAMS-ATTACHMENTS.md`** — the SharePoint Create-file step,
>   the `triggerBody()?['card']` change, the ordered go-live sequence, rollback.
> - Sizes are a non-issue: ~72 KB pdf + ~24 KB xlsx ≈ 130 KB of base64.
>
> **[x] THE OOO GAP IS EXPLAINED — Kyle 07/29/26. Cloudbeds room blocks ERODE.**
> When a user changes a block, the OOO block **disappears from the days already
> passed**, because Cloudbeds won't let anyone set a block for a past time. So a
> past day's OOO **can only ever decrease**, and there is no as-of view.
>
> This explains the whole systematic gap — every OOO delta vs her report is
> negative and ours is always lower (**LL −11, JW −10, SA −11, KE −81** MTD). It
> also inverts the fix I proposed an hour earlier: **capture EARLIER, not later.**
> - It **confirms the session-4 freeze is right** — re-querying can only lose
>   blocks (LL 7/26 fell 6→4, JW 6→5 on re-query). Keep `restateSnapshot` skipping
>   blocks.
> - But **our capture is still too late.** The flash banks stay date D at 06:00 ET
>   on **D+1**, so anything tidied during D or overnight is already gone. Proven on
>   2026-07-28: banked LL `ooo` = **3** while both her report and a live re-query
>   read **6** — and the freeze makes that 3 permanent.
> - She captures earlier in effect (her workbook carries the figure forward from
>   when the day was current), which is why she is consistently higher.
>
> **[x] BUILT AND RUNNING 07/30/26 — Kyle approved all three.**
> 1. **`/api/cron/capture-blocks` at 03:00 UTC** (`vercel.json`) →
>    `captureEndOfDayBlocks(easternToday())`. 03:00 UTC is 23:00 EDT / 22:00 EST on
>    the day being captured, so `easternToday()` returns the day just ending in
>    both halves of the year. **Blocks only** — nights/revenue still belong to the
>    06:00 flash. A property whose block fetch fails is **skipped, never written as
>    0** (that is the 429 hazard, Item 298 — a zero would freeze permanently).
>    `?date=` allows a manual catch-up and **refuses a future date**.
> 2. **`ooo` is now the MAXIMUM observed on or after the stay date.** New
>    `observeBlocks` in `lib/db.ts` upserts with `greatest()`;
>    `blocks_by_type`/`ooo_source` move only when `ooo` actually rises, so the
>    composition always describes the figure shown. `bankDailySnapshot` and
>    `restateSnapshot` were both changed to raise-only as well.
> 3. Forward/on-the-books readings are excluded **by construction** —
>    `upsertRevenueSnapshot` (the only path that writes future days) touches
>    revenue and inventory only, never `ooo`. Verified by reading the code.
>
> **[!] ONE NON-OBVIOUS KNOCK-ON, fixed:** `bankDailySnapshot`'s "still empty"
> guard required `ooo = 0 and other_blocks = 0` as well as zero nights. The
> end-of-day pass runs BEFORE the flash and legitimately pre-populates `ooo`, which
> would have made that guard reject every day and leave it with no nights or
> revenue forever. The guard is now **nights-only**, which also matches its own
> documented intent ("stays open for re-capture until it lands real counts").
>
> **New columns** (additive, `scripts/db-init.mjs`): `ooo_eod`, `ooo_flash`,
> `ooo_observed_at` — the same pattern as `flash_room_rev`, so the gain the
> end-of-day pass recovers is measurable rather than asserted. Migration applied.
>
> **Verified, not just built:**
> - Monotonic invariant proven against the real Neon schema on a throwaway
>   `ZZTEST` row (since deleted): 6 then 3 stays **6** with `ooo_eod=6`,
>   `ooo_flash=3` and composition still pointing at the 6; a later 9 does move it.
> - First real capture ran for **2026-07-29**, 8/8 properties, 0 skipped:
>   `DP=3 JN=107[override] JW=7 KE=24 KW=5 LL=6 OR=9 SA=13`. **LL banked 6** — the
>   same property that banked 3 for 07-28 under the old flow, which is the fix
>   working on its first run.
> - `scripts/show-snapshot.mjs` prints `ooo_eod` / `ooo_flash` / gain.
>   `scripts/capture-blocks.mjs` hits the route the way the cron does.
>
> **[!] THIS CANNOT REPAIR HISTORY.** Already-banked days are frozen at whatever
> was caught and the true figures are gone from Cloudbeds. The only source for past
> OOO is Monica's workbook — a backfill from it is a separate decision, the way the
> 2025/2026 counts were done.
>
> See memory `ooo-erodes-in-cloudbeds`.
>
> **[x] HEAD-TO-HEAD vs HER REAL 07/29 REPORT — CLOSE. Both files in the repo:**
> hers at the repo root, ours at `outputs/`, same name, same as-of date, same data
> day (through 07-28). Diff script pattern: parse both PDFs' ACTUAL pages, split
> each page's text on the `Occupied` lines, read metrics positionally.
>
> | measure (YTD) | Monica | ours | delta |
> |---|---|---|---|
> | Room revenue | $6,605,704.58 | $6,610,695.78 | **+0.08%** |
> | Occupied room-nights | 185,789 | 185,827 | **+0.02%** |
> | Inventory room-days | 233,113 | 233,127 | +0.01% (all DP) |
>
> MTD room revenue: $863,253.08 vs $860,272.82 = **-0.35%**. Every property inside
> ±0.8% YTD; the MTD outliers are JW -1.5% and DP -2.3%.
>
> **The four real disagreements, all already-open items — nothing new:**
> 1. **JN out-of-order YTD 7,937 vs 12,733 (+60%).** Entirely the renovation
>    override (open item 2). It is the whole of the portfolio's +16% OOO gap;
>    every other property is within ±1.5%.
> 2. **Transient/lease revenue SPLIT, not the total.** Ours puts less in transient
>    and more in lease at every property, and the two nearly cancel: KE is
>    transient -$27,425 / lease +$30,160 / net +$2,735. A classification
>    difference on history, not a data difference (open item: her Yardi-blended
>    lease on 2025). Worth showing Monica this table specifically.
> 3. **Other blocks YTD +46 (+2.4%)**, concentrated at KE (14 vs 27) and OR (3 vs
>    12) — exactly open item 4, the block-type -> "Other blocks" mapping.
> 4. **[?] NEW, small, unexplained: DP inventory YTD 31,632 vs 31,646 = +14
>    room-days.** The only property where inventory does not match exactly, and
>    inventory was supposedly exact on every property as of session 4. 14 days x
>    1 room, or a couple of days at the wrong capacity — DP moved 151->150->152->153
>    during 2026, so a boundary is probably a day off. Worth chasing: it also
>    carries the largest MTD revenue gap (-2.3%).
>
> **[x] Formatting fidelity fix found by the diff: negative currency.** She writes
> `-$30,663.31`, we wrote `$-31,949.68`. `fmtCurrency` now puts the sign outside
> the symbol; verified 22 occurrences of `-$` and zero of `$-` in the re-render.
>
> **[!] The "Yesterday" column moves between runs.** Two renders ~10 minutes apart
> gave LL 127 then 126 occupied; the first matched her exactly. 07-28 is
> preliminary (`finalThrough` = 2026-06-30) and nights are derived from revenue
> rows that are still posting, so a same-day re-render is not reproducible. Do not
> treat a single yesterday-column mismatch as a defect.
>
> **[x] POSTED TO THE TEST CHANNEL AND CONFIRMED RENDERING (Kyle, 07/29/26).**
> Kyle supplied the test flow URL (stored `TEAMS_FLOW_URL` in `.env.local`;
> checked against `TEAMS_FLOW_URL_REVENUE` first — **different workflow GUID**, so
> not the Revenue chat). `202`, card rendered, Kyle pasted it back. Note the
> Graph `chat_message_search` could NOT verify delivery (429 after 5 of 47 chats,
> and flowbot cards aren't reliably indexed) — Kyle's eyes were the verification.
>
> **[x] HER ACTUAL POST FORMAT — five samples reviewed, and it changed the build.**
> Screenshots of her posts as of Jul 22, 23, 24, 25-27 and 28. Her post is a
> **plain text message**, not a card:
> - Fixed template, byte-identical every day except the date: *"Good day Team.
>   Please refer to the attached file for the Occupancy Report generated as of
>   `<date>`. Kindly see below additional notes. Thank you."* then **Sources /
>   Notes / Legend inline in the message body** — the same block as PDF page 5.
> - **One attached PDF.** Three on catch-up days: her Tue 1:00 AM post reads
>   "as of July 25-27, 2026" and carries 3 files = Fri/Sat/Sun data batched.
>   **Our cron runs daily including weekends, so it emits one file per day and
>   never needs batching.** No code needed; it removes her manual catch-up.
> - She posts near midnight on day D labelled "as of D", data through D-1. Our
>   cron produces the same label and data at 06:00 ET — same convention, ~18h
>   earlier.
> - **[x] Card rebuilt to match:** her title + greeting, then our KPI/per-property
>   figures (a real addition — her message carries no numbers), then her Sources /
>   Notes / Legend. New `REPORT_NOTES` + `reportGreeting` in `lib/revenue-report.ts`
>   are the single source shared by the card AND the PDF notes page, so the message
>   and the file can't drift. ASCII-only, pinned by a test (the flow 400s otherwise).
> - **[!] ONE DELIBERATE WORDING DEPARTURE — Kyle should sanity-check with Monica.**
>   Her Sources says *"Lease Room Nights/ Revenue are combination of Cloudbeds and
>   Yardi from January - August and Cloudbeds solely for September onwards."* That
>   is her 2025 Yardi transition and is NOT how ours are produced (100% Cloudbeds,
>   classified by rate plan). Ours says so instead. A test asserts the Yardi line
>   never comes back. Everything else in the block is hers verbatim.
> - Her message Legend omits the purple/40% line that her PDF page 5 has; ours
>   keeps all three tiers, because our PDF actually applies purple.
> - **[x] Card also fixed to say "Orlando", not "Orlando OBT"** — caught by seeing
>   it live in the test channel. `reportShortName` now feeds the card, and
>   `reportDisplayName` (= "Stayable " + that) feeds the report blocks.
>
> **[!] NEW HAZARD FOUND — Cloudbeds 429 silently zeroes out-of-order.**
> Under repeated local runs, `getRoomBlocks` returned HTTP 429 and the code logs
> and **treats it as 0 OOO** (`[revenue-report] block fetch failed for <id> —
> treated as 0`). Seen on LL / KW / OR. Why it matters: **room blocks are frozen
> at first capture and deliberately never restated** (session-4 finding), so a 429
> during the 10:00 flash cron would bank OOO = 0 for that property-day
> **permanently**. `findAvailabilityAnomalies` would catch a sustained run of it,
> not a one-day blip.
> - **No evidence production has hit this** — 07-28 banked non-zero OOO for all 8,
>   and this was provoked by 4-5 full report builds inside 20 minutes. But the
>   production cron makes the same burst (8 properties x 7 forward days), so it is
>   not impossible. **Unfixed, flagged. Smartsheet Item 298.**
> - Practical note for future sessions: **do not build the report repeatedly in
>   quick succession** — check OOO is non-zero for all 8 before trusting a render.
> - The PDF in `outputs/` has correct OOO on all 8 ACTUAL blocks (verified
>   LL:6 JN:107 JW:7 KE:24 KW:5 OR:9 SA:15 DP:3), but some ON-THE-BOOKS forward
>   days for LL/KW/OR may read 0 OOO from this same 429 — a local artefact only.
>
> **[x] THE CRONS FIRE UNATTENDED — session-4 open item 4 is CLOSED.** Observed
> incidentally while rendering from live data: 2026-07-28 has real counts for
> **8 of 8** properties and `lastBankedAt` = **2026-07-29 11:30:40 UTC**, i.e.
> today's 11:30 restate cron, following the 10:00 flash. Nobody ran anything —
> session 5 changed no code and executed nothing, and this session only read.
> `finalThrough` = 2026-06-30, as expected five days after June closed.
>
> **▶ START HERE NEXT SESSION:**
> 1. **[ ] THE ATTACHMENT IS THE ONLY UNPROVEN LEG. It needs Kyle's flow edit.**
>    The card posts and renders in the test channel. The PDF cannot land until the
>    flow has the SharePoint Create-file step: `TEAMS_FLOW_ATTACHMENTS=1` sends
>    `{card, files}` into a post step that still feeds `triggerBody()` straight to
>    the card, which fails the run and posts nothing. **Flow edit first, always.**
>    Then re-post from here (the test URL is in `.env.local`) or via Vercel → Cron
>    Jobs → Run. `docs/TEAMS-ATTACHMENTS.md` has the steps.
> 2. **[ ] Push + deploy** (not done — pushing this branch deploys to production).
>    Safe: attachments off by default, so Teams behaviour is byte-identical. The
>    visible change is the `/report/latest.pdf|.xlsx` layout.
> 3. **[ ] Kyle: edit the Power Automate flow**, then run the cron against the
>    **test** channel and check `attached: 1` + the PDF in its Files tab.
>    Only after that swap `TEAMS_FLOW_URL` to the Revenue URL — that swap IS the
>    first live post. `docs/TEAMS-ATTACHMENTS.md` §Go-live.
> 4. **[!] Not verified and not verifiable without posting:** that the newer
>    `*.powerplatform.com` trigger accepts this body. Same POST contract as far as
>    our code is concerned, but untested against that endpoint.
> 5. **[ ] Regenerate the Revenue trigger URL** — pasted in plaintext into a
>    transcript 07/29.
> 6. **Still open from sessions 4/5** — the DI-occupancy decision (item 6),
>    sending the Cloudbeds capacity write-up, and the room-type-change date from
>    Monica. Cron confirmation is now DONE (above).

---

## 07/29/26 (session 5) — REAL REVENUE-CHANNEL FLOW RECEIVED; NOT YET LIVE

> **Pickup — 07/29/26 (session 5 close). NO CODE CHANGED, NOTHING POSTED TO TEAMS.**
> Short session. Kyle supplied the Power Automate HTTP-trigger URL for the **real
> Revenue chat** — the one Monica posts to by hand. Intent: this automation
> replaces her manual daily post. **Explicit instruction: do not send one to the
> channel yet.** No commit was made; the only tracked change is this TODO block.
>
> - **[x] URL stored as `TEAMS_FLOW_URL_REVENUE`** in `.env.local` (gitignored,
>   verified). Deliberately **NOT** `TEAMS_FLOW_URL`: `postAdaptiveCard()`
>   (`lib/teams.ts:2`) reads only that name and posts unconditionally, so the
>   distinct name makes an accidental live post impossible. Never commit either URL.
> - **Vercel Production still holds the TEST-channel flow under `TEAMS_FLOW_URL`.**
>   Changing that value IS the go-live switch — the next 10:00 UTC
>   `/api/cron/revenue-report` run then posts to the real chat.
>   `app/api/cron/revenue-report/route.ts:34` has **no dry-run flag**, so the swap
>   and the first live post are the same action.
> - **[!] The new URL is a SAS-signed secret pasted in plaintext into a Claude Code
>   transcript.** Anyone holding it can trigger the flow. Regenerating the trigger
>   URL in Power Automate is cheap insurance — flagged to Kyle, his call.
> - Newer host style (`*.environment.api.powerplatform.com/powerautomate/
>   automations/direct/…`, not `*.logic.azure.com`). Same POST contract as far as
>   our code is concerned (`ok` accepts 202 **or** any 2xx) — but **unverified
>   against this endpoint**, and it cannot be verified without posting.
> - **[x] Smartsheet Action Items Staging — Item 292** logged (owner Kyle, Not
>   Started): "Cut the daily revenue Teams card over to the live Revenue channel."
>   Task Sheet + Priority left blank rather than guessed (Priority is locked to Rob).
> - **[x] Memory `teams-report-delivery` updated** with the two-flow situation.
>
> **▶ START HERE NEXT SESSION:**
> 1. **[?] BLOCKING QUESTION TO KYLE, asked and unanswered:** does Monica **attach
>    a file** to her daily post, or **paste the numbers** into the message? If
>    numbers, the existing Adaptive Card already covers it and no build is needed.
>    If a file, which — `.xlsx`, `.pdf`, or both?
> 2. **[ ] Attachment support, IF the answer is "a file".** An Adaptive Card has no
>    attachment slot; a Teams file attachment is a pointer to a file already in the
>    channel's SharePoint library. Working design, costed this session:
>    - cron POSTs `{ card, fileName, fileBase64 }` instead of a bare card;
>    - flow step 1 = SharePoint **Create file** into the Revenue channel's Files
>      folder, `base64ToBinary(triggerBody()?['fileBase64'])`;
>    - flow step 2 = post the card (now `triggerBody()?['card']`) linking it.
>    - Size is a non-issue: report `.xlsx` ~24 KB, `.pdf` ~72 KB (~33/97 KB b64).
>    - **[!] The code change and the flow edit MUST land together** — changing the
>      body shape breaks the flow instantly, because it currently feeds the raw
>      request body straight into the card. The flow edit is Kyle's; Claude has no
>      Power Automate access.
>    - **Unverified:** whether the current Teams connector version exposes a file
>      attachment field on "Post message in a chat or channel". 30 seconds to check
>      in the flow designer; connectors change, so don't take it from memory.
> 3. **[!] SIDE FINDING, worth fixing whichever way item 1 goes:** the card's
>    "Download Excel" / "Download PDF" buttons point at `/report/latest.xlsx|.pdf`,
>    and `middleware.ts:27` gates BOTH. Anyone in the Revenue chat without the MAIN
>    pin hits a login wall today. Putting the file in the channel removes this;
>    otherwise the links need a token-authenticated download route.
> 4. **Everything from the session-4 pickup below is still open and untouched** —
>    the DI-occupancy decision (item 6), sending the Cloudbeds capacity write-up,
>    the room-type-change date from Monica, and confirming the crons fire unattended.

---

## 07/28/26 (session 4) — INVENTORY SOURCE FIXED APP-WIDE; CAPACITY BUG ROOT-CAUSED

> **Pickup — 07/28/26 (session 4 close). DEPLOYED AND VERIFIED.**
> Working tree clean except the intentionally-untracked `Property management
> dashboard system/`. Branch level with `origin`. Production = **`371af0b`**;
> the code release is **`7851786`** = `dpl_8yarC3AZCpKE94HSF3CFSQ1Bq2t1`, READY,
> aliased to `dashboard.rentstayable.com`. Live smoke: `/`, `/report`, `/ops`
> → 307→/login; `/login`, `/test` → 200.
>
> **▶ START HERE NEXT SESSION:**
> 1. **[?] DECIDE item 6** — should the home / occupancy views stop taking
>    occupancy from Data Insights and compute nights ÷ inventory the way
>    `/report` does? Monica's answer makes this more pressing: DI is now the only
>    place the inflated denominator can still reach us, and we cannot correct a
>    percentage whose denominator Cloudbeds owns. Note DI also feeds ADR/RevPAR
>    on those views, so it is a real change, not a cleanup.
> 2. **[ ] SEND the Cloudbeds write-up** —
>    `outputs/CloudbedsCapacityDefect_2295-6802_072826.md`. Ready; not sent.
> 3. **[ ] TESTABLE, needs one fact from Monica:** ask her for a **date + property
>    of a past room-type change**. Then re-query that stay date in DI now. If the
>    denominator is still inflated, DI's per-day snapshots do NOT heal
>    retroactively and our whole historical occupancy series carries stale
>    denominators on those days. If it healed, the exposure is live-only. This is
>    the highest-value unanswered question on the thread.
> 4. **[ ] Still never observed: the crons firing unattended.** Could not be
>    confirmed this session — the previous session's manual restatement runs
>    overwrote `updated_at` on the same rows a cron would have touched, so cron
>    writes are indistinguishable from manual ones. **The clean test:** 07-28
>    currently has revenue but NO counts; if counts appear for all 8 properties
>    with nobody running anything, the flash cron fired. Then check the restate
>    response for `daysMoved` / `netRoomRevDelta`, and `availabilityAlerts` empty
>    on the report cron now JN is corrected.
> 5. Carry-overs: verify `/ops` §6–8 on prod; **ask Elise about the 15 empty
>    views**; the two ops findings (952/3,299 calls unanswered; "unknown" =
>    424/472 cancellations).
>
> **What shipped (`7851786`):** every room count in the app now comes from the
> room list instead of `getDashboard.capacity` — see open item 6 above for the
> full consumer list and the important caveat that it does NOT align the
> occupancy percentages. `tsc --noEmit` is clean for the first time in several
> sessions (item 8). 208/208 tests, build green.
>
> **Data-layer state verified live this session (all healthy):**
> - Snapshot store: 8/8 properties, counts complete through **2026-07-27**, zero
>   gaps. 2026 = 212 days (01-01→07-31); 208 with counts, 212 with revenue — the
>   4-day spread is the forward revenue-only stubs (07-28→07-31), inert for
>   MTD/YTD.
> - In-service windows working exactly as configured: JN 2026 = 122 days
>   (Apr 1–Jul 31), JN 2025 = 120 (Jan–Apr), DP 2025 = 214 (Jun–Dec). No phantom
>   rows.
> - Month freeze correct: Apr/May/Jun 2026 fully `is_final` (728 rows); July open
>   (248).
> - **Restatement is working and immaterial:** exactly ONE day×property moved ≥$1
>   in the last 40 days — DP 07-27, flash $3,273.25 → settled $3,332.75,
>   **+$59.50**. The relaxed capture-once rule is earning its keep without
>   churning the ledger.
>
> **Unrelated item logged to Smartsheet** (Action Items Staging Sheet, **Item
> 288**): two Power Automate flows failed in the past week — "Send webhook alerts
> to Network Tickets (test)" and "Send webhook alerts to GBP - Test". **Verified
> NOT this project** (zero references to GBP or Network Tickets in the repo; our
> only Power Automate dependency is the flow behind `TEAMS_FLOW_URL`). Owner Kyle,
> Task Sheet + Priority deliberately left blank rather than guessed. Worth a look
> while in Power Automate: if those share a connection with the `TEAMS_FLOW_URL`
> flow, the daily revenue card would fail **silently** (`postAdaptiveCard` returns
> `{ok:false}` and never throws, by design).

> **Pickup — 07/28/26 (session 3b close). REDESIGN + ACCURACY REMEDIATION ARE
> BOTH DEPLOYED.** Working tree is clean; branch is level with `origin`.
> Production = `c5237b6` on `dashboard.rentstayable.com`.
>
> **▶ START HERE NEXT SESSION:**
> 1. **[x] Visual light/dark pass — DONE, PASSED (Kyle, 07/28/26).** Reviewed on
>    the deployed build; both themes read correctly. This was the last open gap on
>    the redesign, so `c5237b6` is now fully signed off.
> 2. **Watch the crons fire unattended** — 10:00 UTC flash, 11:30 UTC restate
>    (both in `vercel.json`). See the session-3b block below for what to check.
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
