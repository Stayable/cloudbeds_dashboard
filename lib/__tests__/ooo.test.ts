import { describe, it, expect } from "vitest";
import { buildOooRooms, type OooRoomInfo } from "@/lib/cloudbeds";

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

const map = new Map<string, OooRoomInfo>([
  ["673007-30", { roomName: "133", roomTypeName: "Single Studio", roomTypeCode: "1DS" }],
]);

describe("buildOooRooms", () => {
  it("uses the room code + type when the name map resolves the roomID", () => {
    const out = buildOooRooms(map, blocks);
    expect(out).toHaveLength(1);
    expect(out[0].room).toBe("133");
    expect(out[0].roomType).toBe("Single Studio");
    expect(out[0].roomTypeCode).toBe("1DS");
  });

  it("never falls back to the raw internal roomID when the name map misses", () => {
    // Empty map = property key has Roomblock scope but not Room scope.
    const out = buildOooRooms(new Map(), blocks);
    expect(out).toHaveLength(1);
    expect(out[0].room).not.toBe("673007-30"); // the bug: raw id shown as "room number"
    expect(out[0].room).toBe(""); // unresolved → blank; UI renders a placeholder + notice
    expect(out[0].roomType).toBe("");
  });

  it("ignores blocks that are not out_of_service", () => {
    const other = [{ ...blocks[0], roomBlockType: "maintenance" }];
    expect(buildOooRooms(map, other)).toHaveLength(0);
  });
});
