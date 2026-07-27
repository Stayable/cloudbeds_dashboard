# Claude-design prompt — Stayable Revenue Report (/report) redesign

Redesign the **Occupancy & Revenue Report** page for the Stayable extended-stay
hotel dashboard. It is an internal, view-only web dashboard (Next.js + Tailwind,
deployed on Vercel) for RISE8 Companies / Stayable Fund I. Aesthetic target:
institutional / investment-banking clean (think Goldman Sachs BI) — dark headers,
generous whitespace, a restrained accent, no chartjunk — but **calm and easy on
the eyes**, NOT a wall of numbers.

## The problem to solve
The current page dumps, for all 8 properties at once, two dense tables each: an
"Actual" table of 18 metric rows × 9 columns (Yesterday / Month-to-date /
Year-to-date, each split Actual / Last-Year / Variance) plus an "On-the-Books"
table of 18 rows × 7 day-columns. That is ~16 large tables stacked vertically —
overwhelming and hard to scan. It mirrors an internal Excel report cell-for-cell.

## Redesign goals
1. **Portfolio-first, drill-down second.** Landing state = a scannable portfolio
   overview, not every property's full grid. Detail appears on demand.
2. **A left property navigation rail** — "All Properties" + the 8 properties;
   clicking one focuses the main pane on that property. Each rail item shows the
   property name and a small at-a-glance signal (e.g. occupancy % + a tiny bar or
   status dot). Sticky on desktop; collapses to a horizontal scroller / dropdown
   on mobile.
3. **Fewer numbers visible at once.** Lead with a small set of headline KPI tiles;
   push the full metric grid behind tabs / disclosure. Make secondary figures
   (Last-Year, Variance) quieter — muted color, or a single colored delta chip
   (▲ green / ▼ red) instead of a whole extra column.
4. Keep it **fast to read at a glance** for a CEO/exec, while still letting a
   revenue manager expand into the full detail.

## Recommended layout (design this)
- **Left rail (property nav):** vertical list, "All Properties" pinned on top,
  then the 8 properties. Active item highlighted. Each row: name + occupancy %
  and a thin occupancy bar (or a colored dot: green healthy / amber watch / red
  low availability).
- **Header band (dark):** "Occupancy & Revenue Report", "As of <date>", download
  buttons for Excel / PDF (keep these — the dense grid still ships in the file).
- **When "All Properties" is selected:** a **portfolio KPI row** (4–5 big tiles:
  Portfolio Occupancy %, Room Revenue YTD, ADR, RevPAR, Rooms OOO) followed by a
  **compact leaderboard** — one row per property with just the headline KPIs and
  an occupancy bar, each row clickable to focus that property. No 18-row tables
  here.
- **When one property is selected:** a **KPI tile row** for that property
  (Occupancy %, Room Revenue, ADR, RevPAR, with a small ▲/▼ delta vs last year),
  then a **period switcher (tabs: Yesterday · MTD · YTD · On-the-Books)** that
  reveals the detailed metric grid for just that period — so the user sees one
  focused table at a time instead of three side-by-side plus a 7-day table.
- Group the detailed metrics into visually separated blocks: **Occupancy &
  Rooms** (counts), **Revenue** (currency), **Rates** (ADR/RevPAR) — cards or
  ruled sections, not one 18-row run.

## Visual system
- Dark ink header (#1F2A44-ish navy) / white body / one restrained blue accent.
- Availability cues already in use, keep them subtle: low availability = warm
  (amber/red) emphasis, very high = a quiet highlight.
- Professional sans (system UI / Arial-class). Tabular-lining numerals for all
  figures. Right-align numbers. Comfortable row height and padding.
- Light + dark theme aware if easy.

## Data available (all PII-free, aggregate only)
Per property, per period (Yesterday / MTD / YTD) and per on-the-books day:
Occupied (split Transient / Lease), Other blocks, Out-of-Order, Available,
Inventory, % Occupied, % Out-of-Order, % Available, Room Revenue (split
Transient / Lease), ADR Combined / Transient / Lease, RevPAR. Each Actual period
may also carry Last-Year and Variance. One property (Kissimmee East) has an
extra "% Occupied Adjusted (less 20 rms)" row.

## Constraints
- No guest PII — aggregate metrics only. Read-only.
- Keep the existing Excel/PDF downloads (they retain the full dense grid for
  users who want every cell).
- Output: a responsive HTML/React + Tailwind mock of the redesigned page, with
  realistic placeholder numbers, that I can adapt into the Next.js app.

Produce 1 polished design. Prioritize calm, scannable, exec-friendly — the full
detail must be reachable but never all on screen at once.
