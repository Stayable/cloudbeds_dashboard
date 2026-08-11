import { describe, it, expect } from "vitest";
import { reportFilename } from "./tools-report";

describe("reportFilename", () => {
  // Monica's convention, already used by the report export: the filename
  // carries the day AFTER the stay date, because the report is published the
  // next morning. Matching it means a file pulled through MCP and a file pulled
  // from the dashboard have the same name. Verified against the real files in
  // outputs/ (e.g. "Occupancy Report as of August 1, 2026.pdf") — no leading
  // zero on the day, month spelled out, comma before the year.
  it("names the file for the day after the stay date", () => {
    expect(reportFilename("2026-08-10", "pdf")).toBe("Occupancy Report as of August 11, 2026.pdf");
  });

  it("rolls over a month boundary", () => {
    expect(reportFilename("2026-08-31", "pdf")).toBe("Occupancy Report as of September 1, 2026.pdf");
  });

  it("uses the xlsx extension for the workbook", () => {
    expect(reportFilename("2026-08-10", "xlsx")).toBe("Occupancy Report as of August 11, 2026.xlsx");
  });
});
