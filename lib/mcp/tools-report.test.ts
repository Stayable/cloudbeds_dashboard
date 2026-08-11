import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock every I/O boundary the handlers cross: the Cloudbeds-backed report
// builder, both file renderers, the DB-backed freshness lookup, and
// `easternToday` (pinned so "defaults to yesterday" is deterministic instead
// of depending on the day the suite happens to run). `shiftYmd` and everything
// else in lib/dates stays real.
const mocks = vi.hoisted(() => ({
  buildRevenueReport: vi.fn(),
  renderReportPdf: vi.fn(),
  renderReportXlsx: vi.fn(),
  snapshotFreshness: vi.fn(),
}));

vi.mock("@/lib/cloudbeds", () => ({ buildRevenueReport: mocks.buildRevenueReport }));
vi.mock("@/lib/report-pdf", () => ({ renderReportPdf: mocks.renderReportPdf }));
vi.mock("@/lib/report-xlsx", () => ({ renderReportXlsx: mocks.renderReportXlsx }));
vi.mock("./freshness", () => ({ snapshotFreshness: mocks.snapshotFreshness }));
vi.mock("@/lib/dates", async () => {
  const actual = await vi.importActual<typeof import("@/lib/dates")>("@/lib/dates");
  return { ...actual, easternToday: () => "2026-08-11" };
});

import { reportFilename, REPORT_TOOLS } from "./tools-report";
import { McpArgError } from "./types";
import type { PropertyActual, RevenueReport } from "@/lib/revenue-report";

// McpPayload.data is `unknown` by design (lib/mcp/types.ts) — callers outside
// this module have no business assuming its shape. Inside this test we know
// exactly what each handler puts there, so narrow it locally rather than
// sprinkling `as any` at each call site.
type DailyReportData = { asOf: string; report: RevenueReport; caveats: string[] };
type ReportFileData = { asOf: string; filename: string; mimeType: string; base64: string };
const asDaily = (data: unknown) => data as DailyReportData;
const asFile = (data: unknown) => data as ReportFileData;

// A minimal-but-real DerivedRow — every field isCountDependentRow can see, so
// a bad key in the blanking set would show up as a field that should have
// been nulled but wasn't (or vice versa).
function derivedRow(over: Partial<PropertyActual["yesterday"]["actual"]> = {}) {
  return {
    transientNights: 10, leaseNights: 5, otherBlocks: 1, ooo: 2, inventory: 100,
    transientRev: 900, leaseRev: 400, occupied: 16, available: 82, pOcc: 0.16,
    pOoo: 0.02, pAvail: 0.82, roomRev: 1300, adrCombined: 81.25, adrTransient: 90,
    adrLease: 80, revpar: 13, occAdjLess20: null,
    ...over,
  };
}

function propertyActual(over: Partial<PropertyActual> = {}): PropertyActual {
  return {
    code: "LL",
    name: "Lakeland",
    yesterday: { actual: derivedRow(), lastYear: null, countsPartial: false },
    mtd: { actual: derivedRow(), lastYear: null, countsPartial: false },
    ytd: { actual: derivedRow(), lastYear: null, countsPartial: false },
    ...over,
  };
}

describe("reportFilename", () => {
  // Delegates to the canonical lib/revenue-report.ts `reportFileBase`, which
  // already carries Monica's convention and its own unit tests
  // (lib/report-layout.test.ts). These three cases now serve as a parity
  // check — that the delegation produces the same strings as before, verified
  // against the real published files in outputs/ (e.g. "Occupancy Report as
  // of August 1, 2026.pdf": no leading zero on the day, month spelled out,
  // comma before the year).
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

const getDailyReport = REPORT_TOOLS.find((t) => t.name === "get_daily_report")!;
const getReportFile = REPORT_TOOLS.find((t) => t.name === "get_report_file")!;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.buildRevenueReport.mockResolvedValue({ actual: [], onTheBooks: [], sourceNote: "stub" });
  mocks.snapshotFreshness.mockResolvedValue({ source: "snapshot", asOf: "2026-08-10", note: "stub" });
  mocks.renderReportPdf.mockReturnValue(Buffer.from("pdf-bytes"));
  mocks.renderReportXlsx.mockResolvedValue(Buffer.from("xlsx-bytes"));
});

describe("get_daily_report", () => {
  it("defaults asOf to yesterday (Eastern) when omitted", async () => {
    const result = asDaily((await getDailyReport.handler({})).data);
    expect(result.asOf).toBe("2026-08-10");
    expect(mocks.buildRevenueReport).toHaveBeenCalledWith("2026-08-10");
  });

  it("passes through an explicit asOf untouched", async () => {
    const result = asDaily((await getDailyReport.handler({ asOf: "2026-07-01" })).data);
    expect(result.asOf).toBe("2026-07-01");
    expect(mocks.buildRevenueReport).toHaveBeenCalledWith("2026-07-01");
  });

  it("attaches freshness from snapshotFreshness", async () => {
    const result = await getDailyReport.handler({ asOf: "2026-07-01" });
    expect(result.freshness).toEqual({ source: "snapshot", asOf: "2026-08-10", note: "stub" });
  });

  // Critical 1: report-pdf.ts, report-xlsx.ts and RevenueReportView.tsx all
  // blank a block's count-dependent cells when countsPartial is true — this
  // was the one surface still handing the model the raw, understated number.
  describe("blanking partial-count blocks (Critical 1)", () => {
    it("nulls the count-dependent ACTUAL fields of a partial YTD block, leaving MTD/Yesterday intact", async () => {
      mocks.buildRevenueReport.mockResolvedValue({
        actual: [propertyActual({ ytd: { actual: derivedRow(), lastYear: null, countsPartial: true } })],
        onTheBooks: [],
        sourceNote: "stub",
      });
      const result = asDaily((await getDailyReport.handler({})).data);
      const ytd = result.report.actual[0].ytd.actual as unknown as Record<string, unknown>;
      expect(ytd.occupied).toBeNull();
      expect(ytd.pOcc).toBeNull();
      expect(ytd.adrCombined).toBeNull();
      expect(ytd.ooo).toBeNull();
      expect(ytd.available).toBeNull();
      // Revenue/inventory/RevPAR are never blanked — PeriodBlock's own comment.
      expect(ytd.roomRev).toBe(1300);
      expect(ytd.inventory).toBe(100);
      expect(ytd.revpar).toBe(13);
      // Untouched blocks keep every field.
      expect((result.report.actual[0].mtd.actual as any).occupied).toBe(16);
      expect((result.report.actual[0].yesterday.actual as any).occupied).toBe(16);
    });

    it("never blanks lastYear — it is always a complete historical period", async () => {
      const ly = derivedRow({ occupied: 99 });
      mocks.buildRevenueReport.mockResolvedValue({
        actual: [propertyActual({ ytd: { actual: derivedRow(), lastYear: ly, countsPartial: true } })],
        onTheBooks: [],
        sourceNote: "stub",
      });
      const result = asDaily((await getDailyReport.handler({})).data);
      expect((result.report.actual[0].ytd.lastYear as any).occupied).toBe(99);
    });

    it("returns a caveat naming the property and period blanked, and none when nothing is partial", async () => {
      mocks.buildRevenueReport.mockResolvedValue({
        actual: [
          propertyActual({
            code: "KE",
            name: "Kissimmee East",
            ytd: { actual: derivedRow(), lastYear: null, countsPartial: true },
          }),
        ],
        onTheBooks: [],
        sourceNote: "stub",
      });
      const result = asDaily((await getDailyReport.handler({})).data);
      expect(result.caveats).toHaveLength(1);
      expect(result.caveats[0]).toMatch(/Kissimmee East \(KE\) YTD/);

      mocks.buildRevenueReport.mockResolvedValue({ actual: [propertyActual()], onTheBooks: [], sourceNote: "stub" });
      const clean = asDaily((await getDailyReport.handler({})).data);
      expect(clean.caveats).toEqual([]);
    });
  });

  // An unchecked asOf used to reach buildRevenueReport untouched. A malformed
  // date must be refused here, before it can crash the report builder or a
  // SQL query built from it.
  it("rejects a malformed asOf naming the argument, never reaching buildRevenueReport", async () => {
    await expect(getDailyReport.handler({ asOf: "not-a-date" })).rejects.toThrow(McpArgError);
    await expect(getDailyReport.handler({ asOf: "not-a-date" })).rejects.toThrow(/asOf/);
    expect(mocks.buildRevenueReport).not.toHaveBeenCalled();
  });

  // Date.parse rolls Feb 30 forward to March 2 instead of erroring — shape
  // alone would let this through.
  it("rejects a calendar-impossible asOf (Feb 30)", async () => {
    await expect(getDailyReport.handler({ asOf: "2026-02-30" })).rejects.toThrow(McpArgError);
    expect(mocks.buildRevenueReport).not.toHaveBeenCalled();
  });
});

describe("get_report_file", () => {
  // The same default logic is written out twice (once per tool). If the two
  // ever drift, Rob gets data for one day and a file for a different day in
  // the same conversation — this pins both to the identical mocked "today".
  it("defaults asOf to yesterday (Eastern) — matching get_daily_report", async () => {
    const dataResult = asDaily((await getDailyReport.handler({})).data);
    const fileResult = asFile((await getReportFile.handler({})).data);
    expect(fileResult.asOf).toBe(dataResult.asOf);
    expect(fileResult.asOf).toBe("2026-08-10");
  });

  it("defaults format to pdf: calls the sync PDF renderer, not the xlsx one", async () => {
    const result = asFile((await getReportFile.handler({ asOf: "2026-08-10" })).data);
    expect(mocks.renderReportPdf).toHaveBeenCalledTimes(1);
    expect(mocks.renderReportXlsx).not.toHaveBeenCalled();
    expect(result.mimeType).toBe("application/pdf");
    expect(result.filename).toBe("Occupancy Report as of August 11, 2026.pdf");
  });

  it("format: xlsx awaits the async xlsx renderer, not the pdf one", async () => {
    const result = asFile((await getReportFile.handler({ asOf: "2026-08-10", format: "xlsx" })).data);
    expect(mocks.renderReportXlsx).toHaveBeenCalledTimes(1);
    expect(mocks.renderReportPdf).not.toHaveBeenCalled();
    expect(result.mimeType).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(result.filename).toBe("Occupancy Report as of August 11, 2026.xlsx");
  });

  it("base64-encodes exactly the bytes the renderer returned", async () => {
    const result = asFile((await getReportFile.handler({ asOf: "2026-08-10", format: "pdf" })).data);
    expect(Buffer.from(result.base64, "base64").toString()).toBe("pdf-bytes");
  });

  it("base64-encodes the xlsx renderer's bytes when format is xlsx", async () => {
    const result = asFile((await getReportFile.handler({ asOf: "2026-08-10", format: "xlsx" })).data);
    expect(Buffer.from(result.base64, "base64").toString()).toBe("xlsx-bytes");
  });

  it("rejects a malformed asOf naming the argument, never reaching buildRevenueReport", async () => {
    await expect(getReportFile.handler({ asOf: "not-a-date" })).rejects.toThrow(McpArgError);
    await expect(getReportFile.handler({ asOf: "not-a-date" })).rejects.toThrow(/asOf/);
    expect(mocks.buildRevenueReport).not.toHaveBeenCalled();
  });
});
