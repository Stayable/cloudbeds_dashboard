# Design — Automated Daily Revenue/Occupancy Report → Teams

**Date:** 2026-07-21
**Branch:** `claude/nifty-thompson-ts8zny`
**Status:** Design approved (Kyle, 2026-07-21). Awaiting spec review before implementation.

---

## 1. Goal

Recreate **Monica's daily Occupancy/Revenue report** (the multi-property
"Occupancy Report as of <date>.pdf") from live Cloudbeds data, and **post it to a
Teams channel automatically every morning**. The report is currently built by
hand in Excel and blends Cloudbeds + Yardi; this automates a **Cloudbeds-sourced**
version and distributes it without manual work.

Non-goal (deferred): matching Monica's blended Yardi lease numbers exactly, and
SharePoint archival. Both are explicitly future work (see §9).

---

## 2. Source report anatomy (what we are reproducing)

Monica's report is per-property (all 8 Stayable properties), two stacked tables:

### 2.1 ACTUAL ("History")
Three period blocks side by side, each with **Actual · Last Year · Variance**:
- **Yesterday** — single day (e.g. 19-Jul-26 vs 19-Jul-25)
- **Month-to-date** — month start → yesterday (Jul 1–19, 2026 vs Jul 1–19, 2025)
- **Year-to-date** — Jan 1 → yesterday (Jan 1 – Jul 19, 2026 vs same LY)

Row set (each a room-night count unless noted):
| Row | Meaning |
|---|---|
| Occupied | occupied room-nights |
| Transient | transient room-nights (subset of Occupied) |
| Lease | lease room-nights (subset of Occupied) |
| Other blocks | blocked/occupied rooms that are NOT paid lease/transient (PM rooms, leasing-contract holds, etc.) |
| Out-of-Order | OOO room-nights |
| Available | Inventory − Occupied − OOO − Other blocks |
| Inventory | capacity × days in range |
| % Occupied | Occupied / Inventory |
| % Out-of-Order | OOO / Inventory |
| % Available | Available / Inventory |
| % Occupied Adjusted (less 20 rms) | **KE only** — occupancy re-based on (Inventory − 20/day) for the renovation |
| Room Revenue | Transient rev + Lease rev (excl. taxes & adjustments) |
| Transient (rev) | transient room revenue |
| Lease (rev) | lease room revenue |
| ADR Combined | Room Revenue / Occupied |
| ADR Transient | Transient rev / Transient nights |
| ADR Lease | Lease rev / Lease nights |
| RevPar | Room Revenue / Inventory |

Variance = Actual − Last Year (its own column per block).

### 2.2 ON-THE-BOOKS
Per property, a forward **7-day (Mon–Sun) forecast** starting the report day
(the day after "Yesterday"), one column per day, same row set as ACTUAL (no
LY/variance). Sourced from reservations currently on the books.

### 2.3 Conditional highlighting (legend on the source)
- **Orange** — dates at ≤20% availability left
- **Red** — dates at ≤15% availability left
- **Purple text** — dates with ≥40% of inventory available to sell

### 2.4 Source notes to carry onto our version
- Transient nights/revenue + OOO count = Cloudbeds.
- Lease nights/revenue = Cloudbeds+Yardi (Jan–Aug), Cloudbeds-only (Sept+).
- Room Revenue excludes taxes and adjustments.
- Past-date results still shift as blocks/OOO change (so a live recompute is
  acceptable and expected — see §5).

---

## 3. Classification: Lease vs Transient (PII-free)

Business rule (Kyle): a guest whose name carries the `*` suffix
(`Surname*ML` / `Surname*WL`) is a **lease**; everyone else is transient/booking.

Implementation (matches the existing dashboard, no guest names read): classify by
**rate plan** via `lib/lease.ts` `classifyRatePlan` — `Monthly Lease` / `Weekly
Lease` (and verified synonyms) ⇒ lease; else transient. Per memory
`lease-vs-transient`, the rate plan maps **1:1** to the `*ML`/`*WL` name
convention, so rate-plan classification is equivalent to Kyle's name rule while
staying inside the no-Guest-scope guardrail (CLAUDE.md §5.2, §6).

**Known gap to resolve at build start (probe):** the existing lease-mix uses
dataset-3 `room_count`, which is *reservation-rows, not physical rooms* (ratio
only). Monica's report needs true **room-night counts** and a **revenue split by
class**. Before wiring, a read-only `scripts/probe-revenue-split.mjs` confirms the
query shape that yields per-day room-nights AND revenue grouped by rate plan
(candidate: DI Financial dataset-1 and/or dataset-3 with the correct measures).
- If it splits cleanly → use it.
- If not → **fallback:** show combined Room Revenue + a nights-based
  transient/lease ratio, with a visible flag that the revenue split is
  unavailable. (Chosen posture: design for the split, fallback ready.)

---

## 4. Data-fidelity caveats (printed on the report)

1. **Cloudbeds-sourced.** Lease Jan–Aug will differ from Monica's Yardi-blended
   figures; Sept-onward should align (her note). Label clearly so no one
   mistakes it for her official blended report.
2. **Last-Year depth varies.** Reopened properties (Davenport, Jacksonville
   North) have partial/zero 2025 history → LY and variance columns legitimately
   sparse, same as Monica's (`#DIV/0!` in hers).
3. **"Other blocks"** derived from roomblock reasons/types (`getRoomBlocks`);
   mapping verified at build (PM rooms, leasing holds vs OOO).
4. **Live recompute.** Past-date numbers may shift as blocks/OOO update — matches
   the source note; the report is a point-in-time snapshot.

---

## 5. Architecture

```
Vercel Cron (daily ~10:00 UTC ≈ 6 AM ET)
   │
   ▼
POST /api/cron/revenue-report   (guarded by CRON_SECRET)
   │  builds RevenueReport for asOf = yesterday (ET), all 8 properties
   ├─► POST TEAMS_FLOW_URL  (Power Automate HTTP trigger → posts card to channel)
   │
   └─ (report data is recomputed on demand by the routes below; no snapshot store)

Browser (gated by PIN, base/exec):
   /report            → HTML render of the full report
   /report/latest.xlsx → exceljs workbook (Monica's layout + highlighting)
   /report/latest.pdf  → PDF rendered from the data model
```

### 5.1 Components

1. **`lib/revenue-report.ts`** — pure, unit-tested builder. Input: per-property
   Cloudbeds pulls. Output: typed `RevenueReport`:
   - `PropertyActual` = 3 blocks × `{ actual, lastYear, variance }` × row set
   - `PropertyOnTheBooks` = 7 days × row set
   - portfolio roll-ups
   All %/ADR/RevPAR/variance/KE-−20 math lives here (no I/O → fully testable).

2. **`lib/cloudbeds.ts`** — `getRevenueReportInputs(propertyKey, asOf)`. Reuses:
   - DI dataset-7 (occupancy / ADR / RevPAR by day) — this year + LY ranges
   - DI dataset-3 + `classifyRatePlan` (lease/transient **nights**)
   - DI dataset-1 (**revenue split** — the probe target from §3)
   - `getRoomBlocks` (OOO + "other blocks")
   - forward on-the-books reservations (next 7 days)
   Batches the 8 properties (per-property keys already in Vercel).

3. **Excel** — `exceljs` (new dep). One sheet per section or per property,
   matching Monica's grid; conditional formatting for orange/red/purple per §2.3.

4. **PDF** — rendered from the `RevenueReport` model via a serverless-friendly
   lib (`@react-pdf/renderer` or `pdfkit`) — **no headless Chromium** (avoids
   Vercel cold-start/size cost).

5. **`/report`** — gated HTML page (base/exec PIN via existing middleware);
   renders the same model; hosts the "View" target + download links.

6. **`app/api/cron/revenue-report`** — orchestrator: build → POST to
   `TEAMS_FLOW_URL`. `CRON_SECRET`-guarded (existing pattern, already in
   middleware matcher exclusions for `/api/cron`).

### 5.2 Teams delivery (Power Automate HTTP trigger)

- Endpoint = a **Power Automate "When an HTTP request is received" flow** URL
  (Kyle provided one on 2026-07-21). Modern replacement for the retired O365
  Teams connector webhook.
- Stored as secret env var **`TEAMS_FLOW_URL`** (contains a `sig=` token) — never
  committed; set in Vercel + `.env.local`.
- **Body schema CONFIRMED (2026-07-21/22):** the flow's step is **"Post card in
  a chat or channel"** (flowbot Adaptive Card). It feeds the raw HTTP body
  straight into the card, so the POST body **must be a full Adaptive Card JSON**
  — top-level `"type": "AdaptiveCard"`, `"$schema"`, `"version": "1.4"`, `"body"`.
  Simple `{"text": …}` / `{"title": …}` payloads fail the run with
  *AdaptiveSerializationException: Property 'type' must be 'AdaptiveCard'*
  (trigger still returns 202; the failure is downstream in the post step).
- **Encoding:** `Content-Type: application/json; charset=utf-8`, correctly UTF-8
  encoded. A mis-encoded body returns **400 InvalidRequestContent**; keep card
  text ASCII-safe or ensure proper UTF-8.
- **Verified end-to-end 2026-07-22:** a valid Adaptive Card POST → **202** →
  card **rendered in the "Test Channel"**. Delivery path proven.
- The channel is chosen inside the flow's post step (currently "Test Channel").
  Renaming the channel does not break it (ID-stable); deleting/recreating would.
- **Card content:** portfolio Occupied% / RevPAR / Room Revenue (Yesterday +
  MTD), per-property occ% + RevPAR mini-table, biggest LY movers, and buttons
  (`Action.OpenUrl`): **View report** (`/report`), **Download Excel**,
  **Download PDF**. Built as an Adaptive Card v1.4 object and POSTed as-is.

### 5.3 Cadence

- Daily, `vercel.json` cron at ~`0 10 * * *` UTC (≈ 6 AM EDT). Note: Vercel cron
  is fixed UTC, so the ET post time drifts ±1h across DST — acceptable; documented.
- asOf = "yesterday" in America/New_York (reuse existing Eastern date helpers in
  `lib/dates.ts`).

---

## 6. Config / env

| Var | Purpose | Notes |
|---|---|---|
| `TEAMS_FLOW_URL` | Power Automate HTTP-trigger endpoint | secret; Vercel + `.env.local` |
| `CRON_SECRET` | guards `/api/cron/*` | already exists |
| `CLOUDBEDS_API_KEY_<CODE>` | per-property keys | already exist |

`vercel.json` — add the `revenue-report` cron entry alongside the existing
`elise-sync` one.

---

## 7. Testing

- **Unit (vitest):** `lib/revenue-report.ts` against fixtures — variance signs,
  %/ADR/RevPAR, KE −20 re-basing, Available identity, empty-LY handling
  (`#DIV/0!`-equivalent → blank/`—`), highlighting thresholds.
- **Probe (read-only):** `scripts/probe-revenue-split.mjs` proves the revenue/
  nights split query shape before wiring (§3).
- **Excel snapshot:** assert sheet structure + a few known cells from a fixture.
- **Smoke:** authed `/report` renders; `/report/latest.xlsx` + `.pdf` download;
  cron route 401 without secret, 200 with; a real test card lands in Teams.

---

## 8. Prerequisites from Kyle

1. **`TEAMS_FLOW_URL`** — provided (test 202 OK). Confirm the Teams render +
   body schema.
2. Target channel confirmed (implicit in the flow).

Everything else is self-contained in this repo + existing Cloudbeds keys.

---

## 9. Deferred / future

- **SharePoint archival** of the Excel/PDF (Graph app-registration or a Power
  Automate step) — add later; the flow that already posts to Teams can be
  extended to save the file.
- **Yardi blend** for exact lease-history parity with Monica's official numbers.
- Optional frozen daily snapshots (Neon/Blob) if immutable historical links are
  ever wanted (current design recomputes live).

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| Revenue split not cleanly queryable from Cloudbeds DI | Probe first; documented fallback (combined rev + nights ratio, flagged) |
| PDF generation on serverless | Model-driven lib, no headless Chromium |
| Power Automate flow schema unknown | Confirm via test render before finalizing card |
| Cron DST drift | Documented; ±1h acceptable for a morning report |
| LY data sparse for reopened properties | Expected; render blanks like the source |
| "Other blocks" misclassification | Verify roomblock reason mapping at build |
