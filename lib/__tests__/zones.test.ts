import { describe, it, expect } from "vitest";
import {
  parseRoomNumber,
  inRange,
  zoneForRoom,
  buildZoneGroups,
  type Zone,
  type ZonedRoom,
} from "@/lib/zones";
import { ZONE_CONFIG } from "@/config/zones";

const dp = ZONE_CONFIG.DP; // A: 103–140/201–240, B: 141–182/241–282
const kw = ZONE_CONFIG.KW; // parity-split wings

describe("parseRoomNumber", () => {
  it("reads the leading integer, incl. 4-digit codes", () => {
    expect(parseRoomNumber("133")).toBe(133);
    expect(parseRoomNumber("1103")).toBe(1103);
    expect(parseRoomNumber("Lobby")).toBe(null);
  });
});

describe("inRange", () => {
  it("is inclusive on both ends", () => {
    expect(inRange(100, { lo: 100, hi: 123 })).toBe(true);
    expect(inRange(123, { lo: 100, hi: 123 })).toBe(true);
    expect(inRange(124, { lo: 100, hi: 123 })).toBe(false);
  });
  it("honors parity", () => {
    expect(inRange(123, { lo: 123, hi: 131, parity: "odd" })).toBe(true);
    expect(inRange(124, { lo: 123, hi: 131, parity: "odd" })).toBe(false);
    expect(inRange(124, { lo: 124, hi: 146, parity: "even" })).toBe(true);
    expect(inRange(125, { lo: 124, hi: 146, parity: "even" })).toBe(false);
  });
});

describe("zoneForRoom", () => {
  it("maps Davenport rooms to A/B by wing", () => {
    expect(zoneForRoom("103", dp)).toBe("Building A");
    expect(zoneForRoom("240", dp)).toBe("Building A");
    expect(zoneForRoom("141", dp)).toBe("Building B");
    expect(zoneForRoom("282", dp)).toBe("Building B");
    expect(zoneForRoom("999", dp)).toBe(null); // Other
  });
  it("resolves Kissimmee West parity-split corridors", () => {
    // 133 odd → C; 124 even → C; 148 even → E; 165 odd → D; 175 odd → E
    expect(zoneForRoom("133", kw)).toBe("Building C");
    expect(zoneForRoom("124", kw)).toBe("Building C");
    expect(zoneForRoom("148", kw)).toBe("Building E");
    expect(zoneForRoom("165", kw)).toBe("Building D");
    expect(zoneForRoom("175", kw)).toBe("Building E");
    // 132 even → Building C (124–146 even band)
    expect(zoneForRoom("132", kw)).toBe("Building C");
    // a 3xx lobby room matches no KW range → Other
    expect(zoneForRoom("305", kw)).toBe(null);
  });
});

describe("buildZoneGroups", () => {
  const zones: Zone[] = [
    { name: "Building A", ranges: [{ lo: 100, hi: 110 }] },
    { name: "Building B", ranges: [{ lo: 120, hi: 130 }] },
  ];
  const rooms: ZonedRoom[] = [
    { name: "105", type: "Studio", ooo: false, occupied: true },
    { name: "101", type: "Studio", ooo: true, occupied: false, reason: "Reno" },
    { name: "125", type: "Studio", ooo: false, occupied: false },
    { name: "999", type: "Studio", ooo: false, occupied: true }, // Other
  ];

  it("groups rooms into zones in config order, sorted numerically", () => {
    const g = buildZoneGroups(rooms, zones);
    expect(g.map((z) => z.zone)).toEqual(["Building A", "Building B", "Other"]);
    expect(g[0].rooms.map((r) => r.name)).toEqual(["101", "105"]);
    expect(g[0].oooCount).toBe(1);
    expect(g[0].occupiedCount).toBe(1); // 105 occupied; 101 is OOO, not counted occupied
    expect(g[1].rooms.map((r) => r.name)).toEqual(["125"]);
    expect(g[2].rooms.map((r) => r.name)).toEqual(["999"]);
    expect(g[2].occupiedCount).toBe(1);
  });

  it("keeps empty zones but omits an empty Other bucket", () => {
    const g = buildZoneGroups([{ name: "105", type: "S", ooo: false, occupied: false }], zones);
    expect(g.map((z) => z.zone)).toEqual(["Building A", "Building B"]);
    expect(g[1].rooms).toHaveLength(0);
  });
});
