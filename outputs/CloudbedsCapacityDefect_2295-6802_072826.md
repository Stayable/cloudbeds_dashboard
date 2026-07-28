# Defect report — `getDashboard.capacity` over-reports room inventory

**Reported by:** RISE8 Companies / Stayable (Stayable Fund I)
**Date:** 07/28/26
**Affected properties:** Kissimmee East (2295), Jacksonville West (6802)
**Control properties:** the other six in our portfolio, incl. Lakeland (4645)
**Auth:** per-property scoped API keys (read-only), API v1.3 + Data Insights v1.1
**Severity:** low per-record, material in aggregate — `capacity` is an occupancy
denominator, so a one-room error propagates into every occupancy, RevPAR and
revenue figure derived from it (365 phantom room-nights per property per year).

---

## 1. Summary

At two of our eight properties, `GET /getDashboard` returns a `capacity` value
**one higher than the property's actual room inventory**. Two independent
room-level endpoints agree with each other and disagree with `capacity`.

The same one-room inflation also appears in **Data Insights occupancy
percentages** — including at a property whose `capacity` field reads correctly —
so it is not confined to the `getDashboard` aggregate.

**The trigger is a room-type adjustment** (Finding 4). The inflation normally
clears by the next day on its own, which is why it has gone unnoticed. **At
Kissimmee East (2295) it does not clear** — it has been corrected at our revenue
manager's request and reverts to 168.

We have routed around this in our own reporting (we now take inventory from the
room list). We are reporting it because any other consumer of `capacity` would be
silently wrong by one room, with no signal that anything is off.

---

## 2. Finding 1 — `capacity` exceeds the room list

`GET /getDashboard` vs. a full paginated walk of `GET /getRooms`, all eight
properties, same session, 07/28/26:

| Property | ID | `getDashboard.capacity` | `/getRooms` rows | Δ |
|---|---|---|---|---|
| Kissimmee East | 2295 | **168** | 167 | **+1** |
| Jacksonville West | 6802 | **134** | 133 | **+1** |
| Davenport | 44199 | 153 | 153 | 0 |
| Lakeland | 4645 | 157 | 157 | 0 |
| Kissimmee West | 5399 | 160 | 160 | 0 |
| Jacksonville North | 812 | 127 | 127 | 0 |
| St. Augustine | 2535 | 140 | 140 | 0 |
| Orlando OBT | 8700 | 135 | 135 | 0 |

Six properties agree exactly, so this is not a systematic off-by-one in how we
count — it is specific to two properties.

## 3. Finding 2 — the extra unit exists ONLY in the aggregate

At both affected properties, **two independent room-level counts return the lower
figure**:

| Property | `getRoomTypes` Σ `roomTypeUnits` | `/getRooms` grouped by room type | `getDashboard.capacity` |
|---|---|---|---|
| Kissimmee East (2295) | **167** | **167** (12 types) | 168 |
| Jacksonville West (6802) | **133** | **133** (14 types) | 134 |

There is no room type at either property that accounts for the extra unit, and no
extra row in the room list. The phantom room is not attributable to any room type
or any room record — it appears only in the `capacity` scalar.

This also rules out the benign explanation we tested first: that a real room
exists in Cloudbeds which the property does not sell. If that were so, it would
appear in the room list and in its room type. It does not.

## 4. Finding 3 — the same inflation appears in Data Insights occupancy

Data Insights (`POST /reports/query/data`, `dataset_id: 7`, column `occupancy`,
grouped by `stay_date`) returns occupancy as a percentage. Since the numerator is
a whole number of rooms sold, `occupancy% × denominator` must be an integer — so
the returned percentages reveal which denominator Cloudbeds used.

Stay dates 2026-07-18 → 2026-07-27:

| Property | Days matching ÷ room list | Days matching ÷ (room list + 1) |
|---|---|---|
| Kissimmee East (2295) | 0 of 10 (÷167) | **10 of 10 (÷168)** |
| Jacksonville West (6802) | 3 of 10 (÷133) | 7 of 10 (÷134) |
| Lakeland (4645) — *control* | 5 of 10 (÷157) | **5 of 10 (÷158)** |

Worked examples (exact to the precision returned):

- KE 2026-07-23: `79.16666666666667%` → × 168 = **133.0000**; × 167 = 132.2083
- JW 2026-07-24: `87.21804511278195%` → × 133 = **116.0000**; × 134 = 116.8722
- LL 2026-07-20: `79.74683544303798%` → × 158 = **126.0000**; × 157 = 125.2025

Two observations, both of which Finding 4 below now accounts for:

1. **The DI denominator varies day to day** at the same property (JW alternates
   between 133 and 134; LL between 157 and 158 inside a ten-day window).
2. **LL shows a 158 denominator even though its `capacity` correctly reads 157.**
   Lakeland was our control property for Findings 1 and 2, so the inflation is
   not confined to the two properties where `capacity` is currently wrong.

## 5. Finding 4 — the trigger is a room-type adjustment, and it usually self-heals

Our revenue manager, who maintains room types and rate plans in Cloudbeds
directly, identifies the cause from the property side:

- **The inflation appears after a room type is adjusted.** In this instance the
  change was to the room type used for transient rooms.
- **It normally corrects itself by the following day** without intervention.
- **Kissimmee East is the exception.** It has been adjusted at her request and
  **reverts to 168**, where it has remained.

This explains the pattern in Finding 3 exactly, and we consider it the most
useful part of this report:

| Observation | Explanation |
|---|---|
| KE reads ÷168 on 10 of 10 days | the stuck case — never healed |
| JW alternates ÷134 / ÷133 | inflation appearing after edits and clearing overnight |
| LL reads ÷158 on 5 of 10 days despite `capacity` = 157 today | same transient inflation; already healed by the time `capacity` was read |

Two consequences worth drawing out:

1. **Every property is exposed, not just the two where `capacity` is wrong
   today.** Lakeland was our control and it shows the same inflated DI
   denominator on half the days sampled. Any property is affected for some
   window after a room-type edit.
2. **Because it self-heals, it is largely invisible.** A report pulled the day
   after an edit looks correct, so the error surfaces only in historical
   day-level data — which is exactly where it does the most damage, since those
   figures are what get compared period over period.

---

## 6. Reproduction

Read-only, per-property scoped key, no guest scopes required. **Kissimmee East
(2295) is the reliable case** — it is currently stuck, so it reproduces on
demand rather than only in the window after a room-type edit.

1. `GET /getDashboard` → note `capacity`.
2. `GET /getRooms?pageNumber=N&pageSize=100`, paging until a short page — count
   rows. (A single unpaged call returns ~20 rooms and will not reproduce this.)
3. `GET /getRoomTypes?pageSize=100` → sum `roomTypeUnits`.
4. `POST https://api.cloudbeds.com/datainsights/v1.1/reports/query/data?mode=Run`
   with `dataset_id: 7`, `columns: [{cdf:{column:"occupancy"}}]`,
   `group_rows: [{cdf:{column:"stay_date"}, modifier:"day"}]` and a stay_date
   range filter → test the returned percentages against both denominators.

Steps 2 and 3 agree with each other at every property. Step 1 disagrees with both
at 2295 and 6802.

To reproduce the transient form at a healthy property: adjust a room type, then
run steps 1 and 4 the same day and again the following day.

---

## 7. Questions

1. **Why does adjusting a room type inflate `capacity` at all?** The room list
   and the per-room-type totals stay correct throughout, so the aggregate appears
   to be recomputed from something that double-counts a unit mid-edit.
2. **Why does Kissimmee East (2295) not self-heal?** It has been corrected at our
   revenue manager's request and reverts to 168. What state is it stuck in, and
   can it be cleared server-side? This is our most pressing item.
3. **What exactly is the denominator behind the Data Insights `occupancy`
   column?** It varies by stay date within a single property, and it carried the
   inflated value at Lakeland (4645) on days when `capacity` itself read
   correctly. If DI stores a per-day inventory snapshot, then **stale inflated
   denominators persist in historical data even after the live figure heals** —
   please confirm whether those snapshots are recomputed.
4. Is `capacity` used as the occupancy denominator anywhere else in the platform —
   in particular the Cloudbeds-native dashboards and reports our property managers
   read? If so those figures carry the same error, silently, for some window after
   every room-type edit.

## 8. Our current position

We have moved our own reporting off `capacity` and onto the room list, so our
occupancy and inventory figures now reconcile with the properties' own records
to within 0.01pp portfolio-wide. **We have not adopted a hardcoded room count** —
we read the room list at query time, so a genuine inventory change flows through.

The remaining exposure on our side is any figure we take from Data Insights
occupancy, since we cannot correct a percentage whose denominator we do not
control — and per Finding 4 that exposure is not limited to the two properties in
this report's title. Question 3 is therefore the one that matters most to us.

We are not asking for a workaround. We have one. We are asking why the aggregate
diverges from the room data it is supposedly derived from, and why 2295 will not
clear.

---

*Contact: bke@rise8companies.com*
