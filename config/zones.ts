// Room → building/zone map for every property, keyed by short property CODE.
// Transcribed from ROOM-ZONING.md (repo root); keep the two in sync. Ranges are
// INCLUSIVE [lo, hi]. Some Kissimmee West ranges are parity-qualified because two
// facing corridors share a number band (odd on one side, even on the other).
// A room whose number matches no range renders in an "Other" bucket.
//
// These are room-NUMBER ranges (inventory identifiers), not guest PII.

import type { Zone } from "@/lib/zones";

/** Zones per property short code (DP, LL, …). See config/properties.ts. */
export const ZONE_CONFIG: Record<string, Zone[]> = {
  // Lakeland — 210972 (4645). Map-labelled Buildings A–D.
  LL: [
    { name: "Building A", ranges: [{ lo: 100, hi: 123 }, { lo: 200, hi: 223 }] },
    { name: "Building B", ranges: [{ lo: 130, hi: 157 }, { lo: 230, hi: 257 }] },
    { name: "Building C", ranges: [{ lo: 160, hi: 171 }, { lo: 260, hi: 271 }] },
    { name: "Building D", ranges: [{ lo: 180, hi: 195 }, { lo: 280, hi: 295 }] },
  ],
  // Jacksonville North — 206628 (812). Map-labelled Buildings A–D.
  JN: [
    { name: "Building A", ranges: [{ lo: 103, hi: 115 }, { lo: 200, hi: 215 }, { lo: 301, hi: 315 }] },
    { name: "Building B", ranges: [{ lo: 116, hi: 122 }, { lo: 216, hi: 223 }, { lo: 316, hi: 323 }] },
    { name: "Building C", ranges: [{ lo: 125, hi: 135 }, { lo: 224, hi: 235 }, { lo: 324, hi: 335 }] },
    { name: "Building D", ranges: [{ lo: 136, hi: 147 }, { lo: 236, hi: 247 }, { lo: 336, hi: 347 }] },
  ],
  // Orlando OBT — 210971 (8700). Map-labelled Buildings A–D (4-digit rooms).
  OR: [
    { name: "Building A", ranges: [{ lo: 1103, hi: 1123 }, { lo: 1202, hi: 1223 }] },
    { name: "Building B", ranges: [{ lo: 1124, hi: 1143 }, { lo: 1224, hi: 1243 }] },
    { name: "Building C", ranges: [{ lo: 2101, hi: 2234 }] },
    { name: "Building D", ranges: [{ lo: 3102, hi: 3225 }] },
  ],
  // Kissimmee East — 210986 (2295). Map-labelled Buildings A–E.
  KE: [
    { name: "Building A", ranges: [{ lo: 100, hi: 119 }, { lo: 200, hi: 219 }] },
    { name: "Building B", ranges: [{ lo: 120, hi: 139 }, { lo: 220, hi: 239 }] },
    { name: "Building C", ranges: [{ lo: 140, hi: 159 }, { lo: 240, hi: 259 }] },
    { name: "Building D", ranges: [{ lo: 160, hi: 179 }, { lo: 260, hi: 279 }] },
    { name: "Building E", ranges: [{ lo: 180, hi: 199 }, { lo: 280, hi: 299 }] },
  ],
  // St. Augustine — 208155 (2535). Map-labelled Buildings A–D.
  SA: [
    { name: "Building A", ranges: [{ lo: 138, hi: 155 }, { lo: 238, hi: 255 }] },
    { name: "Building B", ranges: [{ lo: 101, hi: 119 }, { lo: 201, hi: 219 }] },
    { name: "Building C", ranges: [{ lo: 156, hi: 173 }, { lo: 256, hi: 273 }] },
    { name: "Building D", ranges: [{ lo: 120, hi: 137 }, { lo: 220, hi: 237 }] },
  ],
  // Jacksonville West — 210987 (6802). Unlabelled map; assumed A–E by wing.
  JW: [
    { name: "Building A", ranges: [{ lo: 100, hi: 115 }, { lo: 200, hi: 215 }] },
    { name: "Building B", ranges: [{ lo: 116, hi: 133 }, { lo: 216, hi: 233 }] },
    { name: "Building C", ranges: [{ lo: 134, hi: 149 }, { lo: 234, hi: 249 }] },
    { name: "Building D", ranges: [{ lo: 150, hi: 167 }, { lo: 250, hi: 267 }] },
    { name: "Building E", ranges: [{ lo: 300, hi: 325 }, { lo: 400, hi: 425 }] },
  ],
  // Davenport — 318197 (44199). Unlabelled map; assumed A/B by wing.
  DP: [
    { name: "Building A", ranges: [{ lo: 103, hi: 140 }, { lo: 201, hi: 240 }] },
    { name: "Building B", ranges: [{ lo: 141, hi: 182 }, { lo: 241, hi: 282 }] },
  ],
  // Kissimmee West — 210969 (5399). Unlabelled map; wings split by parity.
  KW: [
    { name: "Building A", ranges: [{ lo: 101, hi: 122 }, { lo: 201, hi: 222 }] },
    { name: "Building B", ranges: [{ lo: 123, hi: 131, parity: "odd" }, { lo: 223, hi: 231, parity: "odd" }] },
    {
      name: "Building C",
      ranges: [
        { lo: 133, hi: 163, parity: "odd" },
        { lo: 124, hi: 146, parity: "even" },
        { lo: 233, hi: 263, parity: "odd" },
        { lo: 224, hi: 254, parity: "even" },
      ],
    },
    { name: "Building D", ranges: [{ lo: 165, hi: 173, parity: "odd" }, { lo: 265, hi: 273, parity: "odd" }] },
    {
      name: "Building E",
      ranges: [
        { lo: 175, hi: 189, parity: "odd" },
        { lo: 148, hi: 162, parity: "even" },
        { lo: 275, hi: 289, parity: "odd" },
        { lo: 256, hi: 270, parity: "even" },
      ],
    },
  ],
};
