# Stayable Room Zoning Reference

Maps each property's rooms to their physical **building/zone**, keyed by
room-number ranges. Read off each property's floor map (the `*.pdf` maps in the
repo root).

**Source of truth:** `lock-app/src/lib/zones.ts` (`ZONE_CONFIG`). Keep this doc
in sync when that file changes — the code is authoritative.

## How to read this

- Ranges are **inclusive** `[low–high]`. A room belongs to a zone if its number
  falls in any of that zone's ranges.
- Some ranges are **parity-qualified** (`odd` / `even`) — needed where a
  building's two facing corridors carry all-odd numbers on one side and all-even
  on the other within the same band (Kissimmee West).
- A room whose number matches no range falls into an **"Other"** bucket.
- Zones map to the real **Cloudbeds propertyID**, not the street-address code.

## Property ID reference

| Property | Street code | Cloudbeds propertyID | Zone source |
|----------|-------------|----------------------|-------------|
| Lakeland | 4645 | 210972 | Map-labelled Buildings A–D |
| Jacksonville North | 812 | 206628 | Map-labelled Buildings A–D |
| Orlando OBT | 8700 | 210971 | Map-labelled Buildings A–D |
| Kissimmee East | 2295 | 210986 | Map-labelled Buildings A–E |
| St. Augustine | 2535 | 208155 | Map-labelled Buildings A–D |
| Jacksonville West | 6802 | 210987 | Unlabelled — assumed A–E by wing |
| Davenport | 44199 | 318197 | Unlabelled — assumed A/B by wing |
| Kissimmee West | 5399 | 210969 | Unlabelled — assumed A–E by wing (parity-split) |

---

## Lakeland — 210972 (4645)

Map-labelled Buildings A–D.

| Zone | Room ranges |
|------|-------------|
| Building A | 100–123, 200–223 |
| Building B | 130–157, 230–257 |
| Building C | 160–171, 260–271 |
| Building D | 180–195, 280–295 |

## Jacksonville North — 206628 (812)

Map-labelled Buildings A–D (floors 1xx / 2xx / 3xx).

| Zone | Room ranges |
|------|-------------|
| Building A | 103–115, 200–215, 301–315 |
| Building B | 116–122, 216–223, 316–323 |
| Building C | 125–135, 224–235, 324–335 |
| Building D | 136–147, 236–247, 336–347 |

## Orlando OBT — 210971 (8700)

Map-labelled Buildings A–D (4-digit rooms: 1xxx / 2xxx / 3xxx).

| Zone | Room ranges |
|------|-------------|
| Building A | 1103–1123, 1202–1223 |
| Building B | 1124–1143, 1224–1243 |
| Building C | 2101–2234 |
| Building D | 3102–3225 |

## Kissimmee East — 210986 (2295)

Map-labelled Buildings A–E (clean 20-room blocks).

| Zone | Room ranges |
|------|-------------|
| Building A | 100–119, 200–219 |
| Building B | 120–139, 220–239 |
| Building C | 140–159, 240–259 |
| Building D | 160–179, 260–279 |
| Building E | 180–199, 280–299 |

## St. Augustine — 208155 (2535)

Map-labelled Buildings A–D.

| Zone | Room ranges |
|------|-------------|
| Building A | 138–155, 238–255 |
| Building B | 101–119, 201–219 |
| Building C | 156–173, 256–273 |
| Building D | 120–137, 220–237 |

## Jacksonville West — 210987 (6802)

Unlabelled map; assumed A–E by physical wing.
A: SW wing · B: NW wing · C: SE wing · D: NE wing · E: centre (3xx/4xx).

| Zone | Room ranges |
|------|-------------|
| Building A | 100–115, 200–215 |
| Building B | 116–133, 216–233 |
| Building C | 134–149, 234–249 |
| Building D | 150–167, 250–267 |
| Building E | 300–325, 400–425 |

## Davenport — 318197 (44199)

Unlabelled map; assumed A/B by physical wing.
A: long lower wing · B: tall right wing.

| Zone | Room ranges |
|------|-------------|
| Building A | 103–140, 201–240 |
| Building B | 141–182, 241–282 |

## Kissimmee West — 210969 (5399)

Unlabelled map; assumed A–E by wing. Wings share number bands but split by
**parity** (odd corridor vs even corridor), so ranges are parity-qualified.
A: front block (both parities) · B: bottom-left (odd) · C: left corridor (odd
outer + even inner) · D: top-left (odd) · E: top-right (odd outer + even inner).
A handful of 3xx lobby rooms fall into "Other".

| Zone | Room ranges |
|------|-------------|
| Building A | 101–122, 201–222 (all) |
| Building B | 123–131 (odd), 223–231 (odd) |
| Building C | 133–163 (odd), 124–146 (even), 233–263 (odd), 224–254 (even) |
| Building D | 165–173 (odd), 265–273 (odd) |
| Building E | 175–189 (odd), 148–162 (even), 275–289 (odd), 256–270 (even) |

---

## Caveats

- **Jacksonville West, Davenport, Kissimmee West** wing assignments are inferred
  from unlabelled floor maps, not on-site verification — treat as provisional.
- Rooms outside all ranges render in an **"Other"** bucket (visible, not hidden).
- Ranges cover the numbering *scheme*; only rooms that actually exist in Cloudbeds
  inventory render. Closed/reno rooms still appear with their normal status.
