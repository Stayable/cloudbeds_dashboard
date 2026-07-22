import { describe, it, expect } from "vitest";
import { buildOooRooms, summarizeOoo, type OooRoomInfo } from "@/lib/cloudbeds";

// One out-of-service block whose roomID is the Cloudbeds-internal
// `<roomTypeID>-<seq>` form (e.g. 673007-30). The UI must show the human room
// CODE (roomName, e.g. "133") + type — never this internal id.
const blocks = [
  {
    roomBlockType: "out_of_service",
    roomBlockReason: "Needs Reno",
    startDate: "2026-05-20",
    endDate: "2026-07-31",
    rooms: [{ roomID: "673007-30" }],
  },
];

// Mixed fixture: one out_of_service block + one blocked_dates block (the JN
// 20-vs-35 root cause — Cloudbeds returns both, buildOooRooms must include
// both, tagged by category).
const mixedBlocks = [
  ...blocks,
  {
    roomBlockType: "blocked_dates",
    roomBlockReason: "Owner hold",
    startDate: "2026-07-01",
    endDate: "2026-07-25",
    rooms: [{ roomID: "673007-31" }],
  },
];

const map = new Map<string, OooRoomInfo>([
  ["673007-30", { roomName: "133", roomTypeName: "Single Studio", roomTypeCode: "1DS" }],
  ["673007-31", { roomName: "134", roomTypeName: "Single Studio", roomTypeCode: "1DS" }],
]);

describe("buildOooRooms", () => {
  it("uses the room code + type when the name map resolves the roomID", () => {
    const out = buildOooRooms(map, blocks);
    expect(out).toHaveLength(1);
    expect(out[0].room).toBe("133");
    expect(out[0].roomType).toBe("Single Studio");
    expect(out[0].roomTypeCode).toBe("1DS");
    expect(out[0].category).toBe("ooo");
  });

  it("never falls back to the raw internal roomID when the name map misses", () => {
    // Empty map = property key has Roomblock scope but not Room scope.
    const out = buildOooRooms(new Map(), blocks);
    expect(out).toHaveLength(1);
    expect(out[0].room).not.toBe("673007-30"); // the bug: raw id shown as "room number"
    expect(out[0].room).toBe(""); // unresolved → blank; UI renders a placeholder + notice
    expect(out[0].roomType).toBe("");
  });

  it("includes ALL block types (not just out_of_service), tagging each with category", () => {
    const out = buildOooRooms(map, mixedBlocks);
    expect(out).toHaveLength(2);
    const byRoom = new Map(out.map((r) => [r.room, r]));
    expect(byRoom.get("133")?.category).toBe("ooo");
    expect(byRoom.get("134")?.category).toBe("other");
    expect(byRoom.get("134")?.reason).toBe("Owner hold");
  });
});

describe("summarizeOoo", () => {
  it("counts ooo/other/total from a mixed room list", () => {
    const out = buildOooRooms(map, mixedBlocks);
    expect(summarizeOoo(out)).toEqual({ ooo: 1, other: 1, total: 2 });
  });

  it("returns all-zero for an empty list", () => {
    expect(summarizeOoo([])).toEqual({ ooo: 0, other: 0, total: 0 });
  });
});
