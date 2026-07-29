import { describe, expect, it } from "vitest";
import {
  REPORT_PROPERTY_ORDER,
  sortByReportOrder,
  periodHeaderLabels,
  fmtDayHeader,
  weekdayName,
  reportFileBase,
} from "./revenue-report";
import { actualHead, onTheBooksHead } from "./report-pdf";

// Every expectation here is read off Monica Oco's published PDF
// "Occupancy Report as of July 27, 2026" (data through 2026-07-26), which this
// report replaces. If a value here changes, the two stop lining up.

describe("property order", () => {
  it("is Monica's published page order", () => {
    expect([...REPORT_PROPERTY_ORDER]).toEqual(["LL", "JN", "JW", "KE", "OR", "KW", "SA", "DP"]);
  });

  it("sorts an arbitrarily-ordered array into it", () => {
    // The order getRevenueReportInputs used to produce: whatever resolved first.
    const scrambled = [{ code: "DP" }, { code: "KE" }, { code: "LL" }, { code: "SA" }];
    expect(sortByReportOrder(scrambled).map((p) => p.code)).toEqual(["LL", "KE", "SA", "DP"]);
  });

  it("does not drop a property that is missing from the order list", () => {
    const withUnknown = [{ code: "ZZ" }, { code: "DP" }, { code: "LL" }];
    expect(sortByReportOrder(withUnknown).map((p) => p.code)).toEqual(["LL", "DP", "ZZ"]);
  });

  it("does not mutate its input", () => {
    const input = [{ code: "DP" }, { code: "LL" }];
    sortByReportOrder(input);
    expect(input.map((p) => p.code)).toEqual(["DP", "LL"]);
  });
});

describe("period header labels", () => {
  const labels = periodHeaderLabels("2026-07-26");

  it("matches her Yesterday / Last Year day columns", () => {
    expect(labels.yesterday.current).toBe("26-Jul-26");
    expect(labels.yesterday.lastYear).toBe("26-Jul-25");
  });

  it("matches her month-to-date range wording", () => {
    expect(labels.mtd.current).toBe("Jul 1 - 26, 2026");
    expect(labels.mtd.lastYear).toBe("Jul 1 - 26, 2025");
  });

  it("matches her year-to-date range wording", () => {
    expect(labels.ytd.current).toBe("Jan 1 - Jul 26, 2026");
    expect(labels.ytd.lastYear).toBe("Jan 1 - Jul 26, 2025");
  });

  it("drops the leading zero on single-digit days, as she does", () => {
    expect(fmtDayHeader("2026-01-05")).toBe("5-Jan-26");
    expect(periodHeaderLabels("2026-03-01").mtd.current).toBe("Mar 1 - 1, 2026");
  });
});

describe("weekdayName", () => {
  it("reads the calendar date as UTC, never the local zone", () => {
    // Her 07/27 on-the-books grid runs Monday 27-Jul-26 -> Sunday 2-Aug-26.
    expect(weekdayName("2026-07-27")).toBe("Monday");
    expect(weekdayName("2026-08-02")).toBe("Sunday");
  });
});

describe("reportFileBase", () => {
  it("names the file for the RUN date, one day after the data date", () => {
    // Her file "as of July 27, 2026" has 26-Jul-26 in the Yesterday column.
    expect(reportFileBase("2026-07-26")).toBe("Occupancy Report as of July 27, 2026");
  });

  it("rolls over month and year boundaries", () => {
    expect(reportFileBase("2026-07-31")).toBe("Occupancy Report as of August 1, 2026");
    expect(reportFileBase("2026-12-31")).toBe("Occupancy Report as of January 1, 2027");
  });
});

describe("PDF table headers", () => {
  it("puts the period name over value/Last Year/Variance and the dates beneath", () => {
    const [periods, dates] = actualHead("2026-07-26");
    expect(periods).toEqual([
      "",
      "Yesterday", "Last Year", "Variance",
      "Month-to-date", "Last Year", "Variance",
      "Year-to-date", "Last Year", "Variance",
    ]);
    expect(dates).toEqual([
      "History",
      "26-Jul-26", "26-Jul-25", "",
      "Jul 1 - 26, 2026", "Jul 1 - 26, 2025", "",
      "Jan 1 - Jul 26, 2026", "Jan 1 - Jul 26, 2025", "",
    ]);
  });

  it("heads the on-the-books grid with weekday names over the dates", () => {
    const property = {
      code: "LL",
      name: "Stayable Lakeland",
      days: ["2026-07-27", "2026-07-28", "2026-08-02"].map((date) => ({
        date,
        row: {} as never,
      })),
    };
    const [weekdays, dates] = onTheBooksHead(property);
    expect(weekdays).toEqual(["", "Monday", "Tuesday", "Sunday"]);
    expect(dates).toEqual(["On-the-books", "27-Jul-26", "28-Jul-26", "2-Aug-26"]);
  });
});
