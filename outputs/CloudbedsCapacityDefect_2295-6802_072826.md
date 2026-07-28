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
percentages** — including at a property whose `capacity` field is correct — which
suggests the inflated figure is not confined to the `getDashboard` aggregate.

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

Two observations we would like explained:

1. **The DI denominator varies day to day** at the same property (JW alternates
   between 133 and 134; LL between 157 and 158 inside a ten-day window). If this
   is by design — e.g. a per-day inventory snapshot, or capacity net of blocks —
   please confirm, and confirm which definition, so we can reconcile against it.
2. **LL shows a 158 denominator even though its `capacity` correctly reads 157.**
   Lakeland was our control property for Findings 1 and 2. That an inflated
   denominator appears there too suggests the +1 is not solely a `getDashboard`
   defect, and that Kissimmee East and Jacksonville West may be the two
   properties where it is *persistent* rather than the only two affected.

We cannot rule out an alternative reading of Finding 3 — that DI is denominating
on something legitimate that happens to differ from the room count. We are
reporting the arithmetic, not asserting the cause.

---

## 5. Reproduction

Read-only, per-property scoped key, no guest scopes required:

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

---

## 6. Questions

1. What is the source of `getDashboard.capacity`, and why does it exceed both the
   room list and the room-type totals at 2295 and 6802?
2. Is there a room record at those properties in a state that excludes it from
   `/getRooms` and `/getRoomTypes` but includes it in `capacity` (e.g. soft-deleted,
   archived, or pending)? If so, can it be cleared at the property level?
3. What exactly is the denominator behind the Data Insights `occupancy` column,
   and is it expected to vary by stay date within a single property?
4. Is `capacity` used as the occupancy denominator anywhere else in the platform —
   in particular in the Cloudbeds-native dashboards and reports our property
   managers read? If so, those figures carry the same one-room error.

## 7. Our current position

We have moved our own reporting off `capacity` and onto the room list, so our
occupancy and inventory figures now reconcile with the properties' own records
to within 0.01pp portfolio-wide. **We have not adopted a hardcoded room count** —
we read the room list at query time, so a genuine inventory change flows through.

The remaining exposure on our side is any figure we take from Data Insights
occupancy, since we cannot correct a percentage whose denominator we do not
control. Question 3 above is therefore the one that matters most to us.

---

*Contact: bke@rise8companies.com*
