import { describe, it, expect } from "vitest";
import { buildMatrix, toCSV, ymdToMMDDYY, exportFilename, type ExportColumn } from "@/lib/export";

type Row = { room: string; reason: string };
const cols: ExportColumn<Row>[] = [
  { header: "Room", value: (r) => r.room },
  { header: "Reason", value: (r) => r.reason },
];

describe("buildMatrix", () => {
  it("prepends the header row, then one array per data row", () => {
    const m = buildMatrix(cols, [{ room: "133", reason: "Needs Reno" }]);
    expect(m).toEqual([
      ["Room", "Reason"],
      ["133", "Needs Reno"],
    ]);
  });
});

describe("toCSV", () => {
  it("quotes cells with commas, quotes, or newlines and doubles inner quotes", () => {
    const csv = toCSV([
      ["A", "B", "C"],
      ["plain", "has,comma", 'has"quote'],
      ["line\nbreak", 1, ""],
    ]);
    expect(csv).toBe(
      'A,B,C\r\n' + 'plain,"has,comma","has""quote"\r\n' + '"line\nbreak",1,',
    );
  });
});

describe("ymdToMMDDYY", () => {
  it("reformats YYYY-MM-DD to MMDDYY", () => {
    expect(ymdToMMDDYY("2026-06-27")).toBe("062726");
  });
  it("passes through non-dates", () => {
    expect(ymdToMMDDYY("n/a")).toBe("n/a");
  });
});

describe("exportFilename", () => {
  it("uses the property id when one property is in view", () => {
    expect(exportFilename("OutOfService", "44199", "2026-06-27")).toBe("OutOfService_44199_062726");
  });
  it("substitutes AllProperties when no property id", () => {
    expect(exportFilename("OutOfService", null, "2026-06-27")).toBe("OutOfService_AllProperties_062726");
  });
});
