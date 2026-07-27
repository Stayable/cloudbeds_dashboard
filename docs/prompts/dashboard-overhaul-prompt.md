# Claude-design prompt — Stayable Operating Dashboard (full overhaul)

Design a cohesive, premium, **executive-grade design system and high-fidelity
mockups** for an internal hotel-operations dashboard. This is a full visual
overhaul of an existing, working Next.js + Tailwind app (deployed on Vercel) for
**RISE8 Companies / Stayable** — a Florida extended-stay hotel brand (8
properties). Audience: the CEO (Rob), VP Ops, revenue manager, and property
teams. It is internal, view-only, PIN-gated, and shows **aggregate metrics only
(no guest PII)**.

Keep the information architecture and data — **redesign the look, feel, and
component system**: typography, spacing, grid, color usage, cards, tables,
charts, states, and a unified navigation shell. Aim for calm, dense-but-readable,
"investment-banking clean" (Goldman/Bloomberg-terminal restraint) elevated with
polish — not flashy, not templated.

## Brand palette (Stayable — use these, from rentstayable.com)
- **Deep navy `#041E42`** — primary / headers / dark chrome
- **Bright blue `#0091F5`** — accent / primary actions / active state / "this year"
- **Light sky `#91D1FA`** — secondary accent / "last year" / soft fills
- **Gold `#FDDA24`** — sparing highlight / callouts
- Neutrals: a clean gray scale for surfaces, borders, secondary text.
- Status (keep semantic): green = healthy, amber = watch, red = low/critical.
- Design **light and dark themes**.

## Surfaces to design (one cohesive system across all)
1. **Login** — minimal PIN entry, branded, single input, clean.
2. **Global shell** — persistent top nav (Stayable wordmark + role-aware page
   links + Log Out), an optional left section-nav sidebar, a **per-property / All
   toggle**, and **period controls** (Yesterday / Last 7 / Last 30 / This month /
   custom range). These repeat across pages — design them once, beautifully.
3. **Home** — portfolio occupancy overview: a hero "arrivals today" + portfolio
   occupancy %, a per-property occupancy strip/leaderboard, a detail view, and a
   "Zones" view (rooms grouped by building, colored by live status:
   occupied / vacant / out-of-order).
4. **Occupancy & Revenue Report** — portfolio KPI tiles (Occ %, Room Rev, ADR,
   RevPAR, Rooms OOO), a **Revenue vs. Last-Year** block (MTD/YTD This-Year /
   Last-Year / Δ% cards + a this-year-vs-last-year **grouped bar chart**, dark
   blue vs light blue), a clickable per-property leaderboard, and a per-property
   detail with an Actual (Yesterday / MTD / YTD, each with Last-Year + Variance)
   vs. On-the-Books (next 7 days) toggle — a dense financial grid done elegantly.
5. **Operations** — five sections: Out-of-Order rooms, Leasing funnel
   (Leads→Tours→Apps→Leased with conversion tiles), Occupancy, Evictions, and
   1-Star Reviews (count + trend). Sectioned, scannable, per-property toggle.
6. **Per-role dashboards** (VP Ops, Revenue, Ops Support, CEO) — sectioned metric
   dashboards tailored per person; same components, different metric sets.
7. **Leasing (vendor-isolated)** — a standalone leasing funnel page.

## Component library to define
KPI/stat tile · trend sparkline · big-number card with Δ badge (▲▼) · data table
(dense, sticky header, right-aligned tabular figures, zebra optional) · grouped
bar chart · line/area trend · funnel · status pill/dot · segmented toggle & tabs
· nav bar + sidebar · date/period control · property switcher · export buttons ·
empty / loading (skeleton) / error states · section header pattern.

## Data available (all PII-free, aggregate)
Occupancy % (daily/weekly/monthly), rooms occupied / available / out-of-order /
inventory, ADR, RevPAR, room revenue (split transient vs lease), arrivals /
departures / in-house counts, leasing funnel + conversions, 1-star review counts
+ trend, eviction counts, and this-year-vs-last-year for revenue & occupancy.

## Constraints
- Aggregate metrics only — no guest names/PII anywhere.
- Fully **responsive** (desktop-dense → clean mobile stacks).
- Numbers use tabular-lining figures; currency `$#,##0`; percentages `0.0%`.
- Keep the data model and page structure; this is a **visual/UX** overhaul.
- Output: a cohesive design system (color, type scale, spacing, components) +
  high-fidelity, responsive **React + Tailwind** mockups of the key screens
  (Home, Report, Operations) with realistic placeholder numbers, that can be
  adapted back into the app.

Deliver one polished, opinionated design direction (not several rough options).
Prioritize a calm, premium, exec-ready feel with excellent information density.
