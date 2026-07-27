# Stayable — Daily Occupancy & Revenue Report
## Methodology for Review

**Prepared:** 2026-07-24 · **For:** Monica Oco (Revenue Management) · **Re:** Automated
recreation of the daily report in the Cloudbeds Dashboard (dashboard.rentstayable.com/report)

This documents how the **automated** report is built, so it can be confirmed line-by-line
against your manual process. Every rule below was cross-checked against your
"Occ% Report as of July 21" workbook and reconciled to **within ~0.1%** on year-to-date
room revenue (portfolio +0.2%). Please confirm each item or flag any correction.

---

### 1. Source & scope
- **Source:** Cloudbeds, read-only, aggregate metrics only (no guest data).
- **Grain:** per property, per day. Historical data available from Jan 2024.
- **"Business date":** figures key off the Cloudbeds **service date**.

### 2. Room Revenue
- Built from Cloudbeds **transaction type = "Room Rate"** only.
- **Excludes:** the separate "Room Revenue" transaction type, Items & Services, Tax,
  Cancellation, Fee, Adjustment, Payment. *(Your report column is titled "Room Revenue"
  but is fed by room-**rate** transactions — confirmed the automated figure matches yours
  to ~0.1%.)*
- **Cancelled reservations are excluded automatically** — a cancelled booking carries $0
  room-rate charge in Cloudbeds, so there is nothing to filter out.
- Revenue is **exact** for all past days (backfilled Jan–Jul 2026).

### 3. Lease vs. Transient
- **Lease = "Monthly Lease" + "Weekly Lease" rate plans.** Everything else = **Transient**.
- **2026 forward = 100% Cloudbeds** (no Yardi blend). The Yardi-blended lease only applied
  to the 2024–2025 transition period.

### 4. ADR & RevPAR
- **ADR = room rate only** — excludes extra-person fee, early check-in, late check-out,
  and cancellation/no-show fees (add-ons don't affect the room rate).
- **RevPAR** = room revenue ÷ available room inventory.

### 5. Out-of-Order vs. Other Blocks
- **Out-of-Order** (e.g. floor repair — not sellable) is reported **separately** from
- **Other / grey blocks** (contractor, complimentary/employee, room transfers —
  occupied-but-not-paid), counted from yesterday onward.

### 6. Periods shown
- **Actual:** Yesterday · Month-to-date · Year-to-date, each with a Last-Year column and
  variance.
- **On-the-Books:** next **7 days** from today (the daily pickup view).
- *(Your separate "3 months out" pivot is a booking-pace tool for your own use — not part
  of the daily report.)*

---

### Open items for Monica to confirm
1. Room Revenue = "Room Rate" transactions only (per §2) — **correct?**
2. Lease = Monthly + Weekly lease rate plans; 2026 forward is CB-only (per §3) — **correct?**
3. ADR = room rate only (per §4) — **correct?**
4. OOO vs. Other blocks split (per §5) — **correct?**
5. On-the-books = 7 days out (per §6) — **correct?**
6. Any metric or edge case in your manual report **not** captured above?

*Once confirmed, the automated report is treated as the system of record for the daily
occupancy & revenue report.*
