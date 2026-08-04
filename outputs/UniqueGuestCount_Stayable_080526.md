# Unique guest count — Stayable portfolio
**Prepared for:** insurance application
**As of:** 2026-08-05 (Eastern)
**Source:** Cloudbeds, all 8 properties, read-only
**Contains no personal data** — counts only.

---

## Headline figures

| Measure | Count | What it is |
|---|---:|---|
| Guest records with a name | **92,281** | One per guest, per booking. The count of named individuals on file. |
| Distinct name + email | **88,670** | Best estimate of **distinct people**, collapsing the same person across bookings and properties. |
| Distinct email addresses | 82,938 | Lower bound — collapses couples/families who book under one email. |
| Counted by Cloudbeds but not retrievable | 3,113 | See "Held-back records" below. |
| **Total Cloudbeds counts** | **95,394** | Retrievable + held-back. |

**Date range of guest records:** 2020-07-07 → 2026-08-04 (just over 6 years).

**Recommended figure depends on the question the form asks:**
- *"How many individuals' personal information do you hold?"* (typical cyber /
  data-breach wording) → **92,281** records on file, of which **~88,670** are
  distinct people. Quoting 92,281 is the conservative (higher) answer.
- *"How many guests have you served?"* → **92,281** guest-stays.
- *"How many distinct customers?"* → **88,670**.

Do **not** quote 95,394 as a count of people whose data we hold: 3,113 of those
are not retrievable and we cannot produce a name for them.

---

## By property

| Property | ID | Named guest records | Distinct (by ID) | Held back | Record range |
|---|---|---:|---:|---:|---|
| Jacksonville West | 6802 | 20,212 | 20,212 | 508 | 2021-12-01 → 2026-08-04 |
| Kissimmee East | 2295 | 14,806 | 14,804 | 374 | 2021-06-27 → 2026-08-04 |
| Kissimmee West | 5399 | 12,812 | 12,812 | 554 | 2022-01-19 → 2026-08-04 |
| Lakeland | 4645 | 12,685 | 12,685 | 548 | 2020-07-07 → 2026-08-04 |
| Orlando OBT | 8700 | 12,466 | 12,466 | 287 | 2020-08-25 → 2026-08-03 |
| Jacksonville North | 812 | 9,382 | 9,382 | 234 | 2020-07-07 → 2026-08-04 |
| St. Augustine | 2535 | 8,743 | 8,743 | 445 | 2022-03-08 → 2026-08-04 |
| Davenport | 44199 | 1,175 | 1,175 | 163 | 2025-05-30 → 2026-08-04 |
| **Portfolio** | | **92,281** | **92,279** | **3,113** | **2020-07-07 → 2026-08-04** |

Davenport is small because it came online 2025-05-30. Jacksonville North's range
spans its out-of-service period.

---

## Method

Source is the Cloudbeds v1.3 `/getGuestList` endpoint, walked page by page for
each of the 8 properties using that property's own scoped API key.

**Included:** every reservation status — checked in, checked out, pending,
cancelled, no-show. This endpoint is the guest master and is not filtered by
status, which matches the brief ("everything, as long as we have a name").

**Excluded:**
- records with no name (0 encountered in retrievable data)
- GDPR-anonymized records (0 encountered in retrievable data)
- merged duplicate profiles — collapsed onto their surviving ID (2 at Kissimmee
  East, the only ones portfolio-wide)

---

## Two things that materially affect the number

**1. A Cloudbeds guest ID is not a person.** Guest IDs never repeated across
92,281 records at any property — statistically impossible for a stable person
identifier, so Cloudbeds issues a **new guest profile per booking**. Counting
distinct guest IDs therefore counts bookings, not people. That is why the
distinct-person figure is derived from name + email instead, and why the two
numbers are close but not equal (92,279 vs 88,670 — about 3,600 people booked
more than once or stayed at more than one property).

Guest IDs are also issued **per property**, so the same person staying at two
properties holds two IDs. The name+email figure is what collapses them.

**2. Held-back records (3,113).** Cloudbeds' own `total` field reports 95,394
records, but the endpoint only ever serves 92,281 of them. Verified at Davenport:
the endpoint serves 1,175 rows and then returns empty pages indefinitely while
`total` continues to report 1,338. These are almost certainly anonymized, merged
or deleted profiles filtered out server-side. They cannot be retrieved, so no
name exists for them and they are correctly outside a "guests we have a name for"
count. **This inference about *why* they are withheld is not confirmed by
Cloudbeds** — if the insurer needs the 95,394 figure explained, that is a
question for Cloudbeds support.

---

## Reproduce

```
node scripts/count-unique-guests.mjs --json out.json
```

Read-only. Names and emails are held in memory solely to deduplicate and are
never printed or written; output is counts only.

**Known pitfall, fixed:** the walk must not stop on a page shorter than the page
size. Cloudbeds returns short pages mid-run, and stopping on the first one
undercounted the portfolio by 8,263 records — concentrated at Jacksonville North
(−2,983) and Orlando OBT (−2,167), whose most recent guest then appeared to be
from 2023 and 2024 respectively. Only an empty page ends the walk. If a future
run shows a property whose newest guest record is not near today's date, suspect
this first.
