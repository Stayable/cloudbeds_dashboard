# Knowledgebase (`/kb`) — design

**Date:** 2026-08-07 (ET) · **Status:** **REVIEWED AND APPROVED by Kyle 08/10/26** ·
**Scope:** v1, search only

**Review outcome — the three open questions, answered:**

1. **Query logging (§8) — KEPT in v1.** Not vetoed.
2. **Markdown rendering (§7) — `marked`, not the hand-rolled renderer.** The
   counter-argument recorded in §7 won: hand-rolled markdown parsers are a known
   source of small bugs and Excel-derived tables are non-negotiable. §7 below is
   updated; the module boundary that made the swap contained is what let this be a
   one-line decision.
3. **Per-document permissions (§9) — confirmed not needed.** One visibility level:
   every MAIN-pin holder sees the whole corpus. The constraint that follows is
   binding — **nothing enters `content/kb/**` that needs narrower distribution.**

**Corpus:** Kyle is supplying the real source documents (see §2). Launch still
gates on real content.

---

## 1. What this is, and what it is not

A PIN-gated page where the Stayable team looks up **company documents and SOPs** —
the eviction process, maintenance standards, lease procedure — and gets back the
specific *section* that answers them, with a citation and a link to the original.

**v1 is search only. There is no LLM.** Kyle's call, 08/07/26, driven by "fastest
to deploy now": search needs no credential, no new dependency, and no prompt
iteration, and the repo has zero AI dependencies today. An answer layer is
designed for later (§9) but nothing in v1 depends on it arriving.

One thing in v1 goes beyond strict search: **query logging** (§8), because that
signal is unrecoverable if not captured from day one. It is flagged there for veto.

**Not a chatbot.** Rejected deliberately:

- A chatbot invites questions the corpus cannot answer, then guesses or
  disappoints. A search box sets the expectation correctly: this is lookup.
- Multi-turn costs conversation state, streaming, and history — none of which
  helps someone asking "what's the eviction process in Osceola".
- **A search box still works when the LLM doesn't.** No key, rate limit, or
  provider outage can make the page useless. That property survives into v1.1.

---

## 2. Sources

Three, per Kyle 08/07/26: a website, a **live** SharePoint Excel file, and
possibly one more. Kyle consolidates; the content is authored into the repo as
markdown.

**The real corpus is not yet in hand, and implementation does not wait for it.**
Build against 2–3 committed fixture documents that exercise the hard cases
(a table-heavy Excel-derived doc, a heading-less doc, duplicate headings), then
replace them with the real content when it arrives. The fixtures stay in the repo
as test data under `content/kb/__fixtures__/`, excluded from the live index, so
the corpus validator and ranking tests do not depend on business content that may
later be edited or removed. **Ship criterion 2 (real content) still gates the
release** — only the coding is unblocked, not the launch.

The Excel being *live* is the central wrinkle: any copy is stale the moment
someone edits the original. The design answers that with visible snapshot dates
(§6) rather than pretending to be current.

---

## 3. Storage: markdown in the repo, no database

`content/kb/<slug>.md`, one file per source document, with frontmatter:

```yaml
---
title: Eviction filing process
source: SharePoint — Operations/SOPs/Evictions.xlsx
sourceUrl: https://…            # optional; opens the original
snapshotDate: 2026-08-07        # when this copy was taken
counties: [Osceola, Duval]      # optional
---
```

The index is built **in-process at module load**: parse frontmatter, split each
document on markdown headings into sections, build a small inverted index in
memory.

**Why not Postgres full-text.** It would give real stemming and ranking, at the
cost of a migration, a seed step, and a second place the truth lives. For a
corpus of roughly a dozen documents that trade is not worth it. Search sits
behind one interface — `searchKb(query): SearchResult[]` — so moving to Postgres
FTS later changes one module and no callers.

**Chunk = markdown section.** A result cites *document + heading* and links to
`/kb/<slug>#<anchor>`, landing the reader on the right paragraph. Whole-file
citations are decorative; section citations are usable.

**No vector embeddings.** At this corpus size they buy nothing that full-text
matching does not already do, and they add a model dependency, an embedding
store, and a re-embed step on every edit. This is most of why v1 ships fast.

**No upload UI.** Kyle consolidates, I author, git reviews. That also keeps
file-parsing off a gated page — no attack surface, no runtime xlsx/PDF
dependency.

---

## 4. Routing and access

- `/kb` — search page
- `/kb/<slug>` — document view

**No changes to `lib/auth.ts` access logic are needed.** `canAccess` falls
through to "any authenticated, non-restricted level" for unrecognised routes
(`lib/auth.ts:60`), so `/kb` is gated at the **MAIN pin** automatically, `exec`
sees it, and the fully-isolated `elise` pin cannot reach it. The only auth-file
change is adding `/kb` to `SHARED_PAGES` so it appears in the nav for every
level.

Verified expectation on production: **`/kb` returns 307 to `/login` when
unauthenticated.** That is the ship-blocking check.

---

## 5. Search behaviour

**One input, no client JavaScript.** A plain `GET` form to `/kb?q=…`, server
rendered. Shareable and bookmarkable result URLs, a working back button, and fast
on a phone in a hallway — which is where an SOP actually gets read.

**Ranking, in descending weight.** Stated explicitly so "why did this rank
first" is always answerable:

1. exact phrase match in a heading
2. exact phrase match in body text
3. **query-term coverage** — 4-of-4 terms beats 2-of-4 before frequency counts
4. term frequency, lightly normalised by section length so a long section cannot
   win on volume alone

Tokenising is lowercase, punctuation-stripped, with naive plural folding
(`evictions` → `eviction`). Deliberately **not** a real stemmer: that is a
dependency, and at this corpus size the miss rate does not justify it.

**Results** show `document title → heading`, the snapshot date, and a snippet
windowed on the best match with query terms highlighted. Escape first, then wrap
matches — highlighting is the classic injection hole.

**Empty and no-result states are features, not afterthoughts:**

- **Empty query** lists the entire corpus, document by document with section
  headings. Someone who does not know the right word can browse, and everyone
  learns what the KB contains.
- **No results** says so plainly, repeats what was searched, and shows that same
  corpus list. It **never pads with weak fuzzy matches.** A confident bad match
  is worse than an honest miss — the same rule `/ops` follows for empty funnel
  stages.

---

## 6. Staleness

Every result and document page shows `as of 08/07/26 (12 days ago)`, with visual
emphasis once a snapshot passes a threshold (default 90 days, one constant).
Nothing is hidden and nothing is implied to be live. Same posture as the revenue
report's `finalThrough` line.

**Refresh is a diff.** Kyle sends an updated file, the markdown is re-authored,
and the commit shows exactly which lines of the procedure changed. For SOPs that
history is worth more than a live sync, which would silently overwrite the
previous wording with no record.

---

## 7. Markdown rendering

Excel-derived content means **tables are non-negotiable**, along with headings,
paragraphs, lists, bold, code, and links.

**DECISION (Kyle, 08/10/26): use `marked`.** The spec originally proposed a
minimal purpose-built renderer (~100 lines) to honour CLAUDE.md's "keep
dependencies minimal", and recorded the counter-argument against it. At review
the counter-argument won: hand-rolled markdown parsers are a known source of
small bugs, and `marked` is one small, well-tested dependency. Excel-derived
content makes table correctness load-bearing, which is exactly where a
hand-rolled parser fails quietly.

Consequences for implementation:

- `lib/kb-markdown.ts` still exists and is still the only module that renders
  markdown — it now wraps `marked` rather than implementing a parser. The
  interface is unchanged, which is the whole reason this decision cost one line.
- **`marked` does not sanitise.** It dropped its own sanitiser years ago and
  says so. GitHub-flavoured markdown permits raw HTML, so `marked` will pass a
  `<script>` in a document straight through. The corpus is authored by us and
  git-reviewed, so this is not an untrusted-input path — but that is a *process*
  guarantee, not a technical one, and process guarantees fail. Configure `marked`
  with raw HTML disabled, and keep the §12 escaping test — it now tests our
  configuration of `marked` instead of our parser, which is still the thing that
  can regress.
- Search snippets do **not** go through `marked`. They are escaped-then-
  highlighted plain text (§5). That path is unchanged by this decision.
- Tables, nested lists, links, and escaping stay in the test suite (§12). We are
  testing that our configuration behaves, not re-testing `marked`.

---

## 8. Query logging (in v1)

Each query is logged with its **result count only** — no user identity, no PII,
no document contents — to a small Neon table (`kb_queries`: `query`,
`result_count`, `created_at`).

**Why this is in v1 rather than deferred**, despite v1 being deliberately
minimal: what people search for and **fail to find** is the single best signal
for which document to add next, and it **cannot be reconstructed later**. Deferring
it does not save the work, it destroys the data. It adds no dependency (Neon is
already wired for `/api/submit` and `/api/feedback`) and is roughly twenty lines.

It is isolated behind one function so it can be deleted without touching search.
**Kyle can veto this at spec review** — it is the one thing here that expands v1
beyond "search only", so it is called out rather than slipped in.

---

## 9. Deliberately out of scope for v1

Named as decisions, not omissions:

- **The LLM answer layer.** Design for v1.1: full-text retrieval selects the top
  sections, a model writes a short answer citing them, and the answer renders
  *above* unchanged search results. Requires the AI SDK plus an AI Gateway key in
  Vercel — which only Kyle can set, as there is no Vercel CLI in this
  environment. Search must keep working when it is absent.
- **Upload UI** — see §3.
- **Live SharePoint sync** — needs a headless Graph credential; the MCP
  connection here is interactive and unavailable to cron.
- **Per-document permissions.** Everything in `/kb` is visible to every
  MAIN-pin holder. **Confirmed acceptable by Kyle at review, 08/10/26** — so the
  constraint is now load-bearing rather than provisional: do not put anything in
  the corpus that needs narrower distribution. If that ever changes, it is a new
  decision and a schema change, not a tweak.

---

## 10. Guest PII

`content/kb/**` must contain **no guest PII**. CLAUDE.md §5 rule 2 stands, and
the `/bea` §3 exception is explicitly scoped to that one table and does not
generalise to a new surface.

`scripts/kb-check.mts` enforces it as a **test failure**, not a warning: email
addresses, phone-number patterns, and headers such as "Guest Name" fail the
build. This is a heuristic — it catches obvious cases, not a guest name buried in
prose — so the rule is enforced by code *and* by review at authoring time, and
the spec says so rather than implying the check is complete.

---

## 11. Modules

| File | Purpose | Depends on |
|---|---|---|
| `content/kb/*.md` | the corpus | — |
| `lib/kb-parse.ts` | frontmatter + heading chunking → `KbDocument[]` | fs (load once) |
| `lib/kb-search.ts` | tokenise, index, rank, snippet | `kb-parse` types only |
| `lib/kb-markdown.ts` | render markdown → HTML (wraps `marked`, raw HTML off) | `marked` |
| `lib/kb-log.ts` | query logging (§8) | `@neondatabase/serverless` |
| `app/kb/page.tsx` | search + empty/no-result states | `kb-search`, `kb-log` |
| `app/kb/[slug]/page.tsx` | document view | `kb-parse`, `kb-markdown` |
| `scripts/kb-check.mts` | corpus validator, run in tests | `kb-parse` |

Each is independently testable; `kb-search` and `kb-markdown` are pure and touch
no I/O.

---

## 12. Testing

Pure functions, no browser — matching the repo's existing 308-test shape.

- **Parsing:** missing/invalid frontmatter; heading-less documents; nested
  headings; **duplicate headings → unique anchors**
- **Tokenising:** case, punctuation, plural folding
- **Ranking:** fixtures proving phrase > coverage > frequency, and that section
  length normalisation does not let a long section win on volume
- **Snippets:** window selection, and **escaping with `<script>` in both the
  document body and the query**
- **Renderer:** tables, nested lists, links, escaping
- **Validator against the real corpus**, so bad content fails CI rather than only
  synthetic fixtures
- **Routes:** empty query lists the corpus; no-result state; unknown slug 404s

---

## 13. Ship criteria

1. `tsc --noEmit` clean; full suite green including the new tests
2. Real content in place — **an empty KB is worse than no KB**
3. On production: `/kb` 307s to `/login` unauthenticated, then loads with the
   MAIN pin; `/kb/<slug>` renders tables correctly; an unknown slug 404s
4. A search for a term you know is in the Excel returns the right section, and a
   nonsense search returns the honest no-result state
