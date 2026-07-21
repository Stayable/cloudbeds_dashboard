# Revenue-report data-availability spike — findings (Task 1)

**Probe:** `scripts/probe-revenue-split.mjs` · **Target:** Davenport (apiPropertyId `318197`) ·
**asOf:** `2026-07-19` · **Comparison targets (Monica's Davenport "Yesterday"):**
Room Revenue $3,198.18 (Transient $492.05 + Lease $2,706.13); Transient nights 10, Lease
nights 84 (Occupied 95 incl. otherBlocks 1). All figures below are **live probe output**,
not fabricated.

---

## Q1 — Room Revenue total

**Query:** DI dataset 1 (Financial), grouped by `transaction_type`, measures `debit_amount` /
`credit_amount`, `details:true`.

**Blocker found and resolved:** dataset 1 has **no `transaction_date` column**
(`400 "Cdf: transaction_date not found for this dataset: Financial"`). Of the date-ish
columns it does expose (`booking_datetime`, `checkin_date`, `checkout_date`,
`invoice_created_datetime`, `last_modified_datetime`, `service_date`,
`transaction_datetime`), **`service_date`** is the one that (a) accepts
`operator:"equals"` with a plain `YYYY-MM-DD` value and (b) returns non-empty rows.
`transaction_datetime`/`booking_datetime` with the same equals+date filter returned an
**empty** result set (they need full-datetime granularity, not a bare date).

**Result (live, filtered on `service_date=2026-07-19`):**

| transaction_type | rows | debit_amount | credit_amount |
|---|---|---|---|
| Fee | 7 | $107.18 | $0 |
| Items & Services | 1 | $25.00 | $0 |
| Payment | 6 | $0 | $266.56 |
| **Room Rate** | **94** | **$3,198.18** | $0 |
| Tax | 19 | -$58.64 | $0 |

**DECISION:** sum `debit_amount` for `transaction_type = "Room Rate"`, filtered by
`service_date` equals the report date. **Exact match** to Monica's Room Revenue
($3,198.18 vs $3,198.18). No taxes/fees/payments included — this type cleanly excludes
taxes and adjustments as required.

---

## Q2 — Transient vs Lease REVENUE split

**Query:** dataset 1 grouped by `public_rate_plan`, measure `debit_amount`, `details:true`,
filters `service_date=asOf` **AND** `transaction_type="Room Rate"` (the Q1 answer — without
this second filter the group-by sum includes fees/tax/payments and does not reconcile,
see below).

**Result (live):**

| public_rate_plan | rows | debit_amount |
|---|---|---|
| Base Rate | 3 | $182.45 |
| Book Direct and Save | 2 | $113.05 |
| Discounted Weekly Rate | 2 | $98.00 |
| Employee Weekly Rate | 3 | $98.55 |
| Monthly Lease | 84 | $2,706.13 |
| **Total** | 94 | **$3,198.18** |

Two classification rules were tested against this same data:

1. **`lib/lease.ts` `classifyRatePlan`** (weekly keywords ⇒ lease): transient = $295.50,
   lease = $2,902.68 — **does not match** Monica ($492.05 / $2,706.13).
2. **Monica's apparent convention** — only the literal rate-plan name `"Monthly Lease"` is
   Lease; `Base Rate`, `Book Direct and Save`, `Discounted Weekly Rate`, and
   `Employee Weekly Rate` are all **Transient**: transient = $182.45 + $113.05 + $98.00 +
   $98.55 = **$492.05**, lease = **$2,706.13** — **exact match**.

**⚠ Real conflict, not a rounding issue:** Monica's daily-report Transient/Lease revenue
split treats **weekly-rate plans as Transient**, but the existing `classifyRatePlan` (used
elsewhere for the in-house lease-mix widget, per CLAUDE.md §6 / the `*ML`/`*WL` naming
convention) treats weekly plans as **Lease**. Both are "correct" for their own purpose —
`classifyRatePlan`'s monthly/weekly split matches Kyle's naming convention for guest
identification; Monica's revenue report apparently only distinguishes long-term
("Monthly Lease") tenants from everyone else. **Task 3 must not reuse `classifyRatePlan`
unmodified for this report** — it needs a report-specific classifier (or a documented,
deliberate deviation) that treats only `"Monthly Lease"` as Lease revenue. Flag this
explicitly to whoever owns the report spec before Task 3 encodes it silently.

**DECISION: SPLIT PATH works** — `debit_amount` grouped by `public_rate_plan`, filtered to
`transaction_type="Room Rate"` and the report date, reconciles exactly to Monica's revenue
split, provided the report-specific "only literal Monthly Lease = Lease" rule is used (not
`classifyRatePlan`). No fallback/estimation needed for revenue.

---

## Q3 — Range room-night counts

**Query tested:** dataset 3, `room_count` grouped by `public_rate_plan`, stay-overlap bounds
(`checkin_date <= asOf` AND `checkout_date > asOf`), both **with** and **without** an added
`reservation_status = "In-House"` filter, `details:true`.

**Result — summed `room_count` (WITH In-House filter):**

| public_rate_plan | rows | room_count |
|---|---|---|
| Base Rate | 2 | 2 |
| Book Direct and Save | 1 | 1 |
| Discounted Weekly Rate, Base Rate, Discounted Long Term Rate | 1 | **43** |
| Discounted Weekly Rate, Discounted Long Term Rate | 1 | **45** |
| Employee Weekly Rate | 3 | 9 |
| Monthly Lease | 84 | **574** |

**Finding: `room_count`, when SUMMED, is badly inflated and not usable as a physical
room-night count.** Monthly Lease alone sums to 574 at a 153-room property. Drilling into
the two anomalous "combo" rate-plan rows (`Discounted Weekly Rate, Base Rate, Discounted
Long Term Rate` / `Discounted Weekly Rate, Discounted Long Term Rate` — the comma-joined
label means the reservation changed rate plans over its history) confirmed each is a
**single physical room** (`room_numbers = "237"` and `"119"` respectively, `group_profile_type
= "-"`, `accommodation_kind = "-"` — i.e. not a group/block booking) yet reports
`room_count = 43` and `45`. So `room_count` is not "rooms in this reservation" here; it
behaves like a cumulative count tied to the reservation's rate-plan-change history, not a
per-day physical room figure. This matches the caveat already on record in
`lib/cloudbeds.ts` (`getLeaseMix`): `room_count` is a rooms-on-the-books weighting, not
necessarily physical rooms in-house.

**COUNTING ROWS instead (one row = one reservation = one physical room, using Monica's
"only literal Monthly Lease = lease" convention):**

| | WITHOUT status filter | WITH In-House filter | Monica |
|---|---|---|---|
| Lease rows | 84 | 84 | **84 — exact match, both ways** |
| Transient rows | 14 | 8 | 10 — gap of 2–4, unresolved |
| Total | 98 | 92 | 94 |

Row-count reproduces Monica's **Lease = 84 exactly** in both variants. Transient row-count
is close but not exact (8 with `In-House` only, 14 including `Confirmed`/`No Show`/
`Cancelled`/`Checked Out` — Monica's true figure of 10 sits between them). The residual
2-room gap is not resolved in this spike; plausible causes (same-day arrivals still
flagged `Confirmed` rather than `In-House` at report-run time, or the two anomalous
combo-plan rows needing separate handling) require a dedicated reconciliation pass — this
is exactly the kind of check flagged for "Task 13" in the existing `getLeaseMix` comments
in `lib/cloudbeds.ts`.

**DECISION:**
- **Nights source:** dataset 3, filters `checkin_date <= day`, `checkout_date > day`,
  `reservation_status = "In-House"`, `group_rows: public_rate_plan`, `details:true`. Use
  **`index.length` (row/reservation count) per classified bucket, NOT `sum(room_count)`.**
  Classify with the Monica-specific rule (Q2): only literal `"Monthly Lease"` ⇒ Lease.
  **Flag the residual ~2-room transient gap as an open reconciliation item** — do not
  present the on-the-books/actual transient nights figure as exact without a follow-up
  validation pass (candidate: cross-check total occupied rows against `getDashboard`'s
  `roomsOccupied` or dataset 7's `occupancy`-derived count for the same day).
- **OOO + other-blocks over a range:** `getRoomBlocks` (already implemented in
  `lib/cloudbeds.ts`, v1.3 `/getRoomBlocks`, range-capable via `startDate`/`endDate`) — not
  re-probed here since it's an existing, proven helper; no DI dependency.
- **Inventory over a range:** capacity (per-property room count, from the Hotel/Room
  metadata already used elsewhere in `lib/cloudbeds.ts`) × day-count of the range. Simple
  arithmetic, no new query needed.

---

## Summary for Task 3

| Question | Source | Status |
|---|---|---|
| Room Revenue total | dataset 1, `transaction_type="Room Rate"`, sum `debit_amount`, filter `service_date` | **Confirmed exact** |
| Transient/Lease revenue split | dataset 1, group by `public_rate_plan`, filter `transaction_type="Room Rate"` + `service_date`, classify by **Monica's rule** (literal `"Monthly Lease"` only) | **Confirmed exact — split path, NOT fallback** |
| Transient/Lease nights | dataset 3, group by `public_rate_plan`, overlap + `reservation_status=In-House`, **count rows, not `sum(room_count)`**, classify by Monica's rule | **Lease exact; Transient approximate (±2), flagged** |
| OOO / other-blocks | `getRoomBlocks` (existing v1.3 helper) | Not re-probed; already proven |
| Inventory over range | capacity × days | Arithmetic only |

**Overall revenue-split posture: SPLIT PATH** (per-rate-plan revenue reconciles exactly),
**not** the total-revenue + nights-ratio fallback — provided Task 3 uses the Monica-specific
classification rule documented above instead of reusing `classifyRatePlan` verbatim.
