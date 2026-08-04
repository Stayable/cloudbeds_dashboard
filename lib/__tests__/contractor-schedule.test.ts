import { describe, it, expect } from "vitest";
import { foldSchedule, weekdayOf, WEEKDAYS } from "@/lib/contractor-schedule";

// Column ids mirror the live sheet's shape (cells carry columnId, not index).
const C = {
  contractor: 1,
  date: 2,
  property: 3,
  task: 4,
  status: 5,
  update: 6,
  day: 7,
} as const;

const columns = [
  { id: C.contractor, index: 0, title: "Contractor" },
  { id: C.date, index: 1, title: "Date" },
  { id: C.day, index: 2, title: "Day" },
  { id: C.property, index: 3, title: "Property" },
  { id: C.task, index: 4, title: "Task" },
  { id: C.status, index: 5, title: "Status" },
  { id: C.update, index: 6, title: "Latest WhatsApp Update" },
];

type RowSpec = {
  contractor?: string;
  date?: string;
  property?: string;
  task?: string;
  status?: string;
  update?: string;
  day?: string;
};

// Mirrors RawCell / RawRow so hand-built fixtures (which set displayValue
// without value, and vice versa) type-check alongside the row() helper.
type Cell = { columnId: number; value?: unknown; displayValue?: string };
type Row = { id: number; cells: Cell[] };

let nextId = 1;
function row(s: RowSpec): Row {
  const cells: Cell[] = [];
  if (s.contractor !== undefined) cells.push({ columnId: C.contractor, value: s.contractor });
  if (s.date !== undefined) cells.push({ columnId: C.date, value: s.date });
  if (s.day !== undefined) cells.push({ columnId: C.day, value: s.day });
  if (s.property !== undefined) cells.push({ columnId: C.property, value: s.property });
  if (s.task !== undefined) cells.push({ columnId: C.task, value: s.task });
  if (s.status !== undefined) cells.push({ columnId: C.status, value: s.status });
  if (s.update !== undefined) cells.push({ columnId: C.update, value: s.update });
  return { id: nextId++, cells };
}

const sheet = (rows: Row[], extra: Record<string, unknown> = {}) => ({
  id: 1391340150542212,
  name: "Contractor Schedule 08-03 to 08-07-26",
  permalink: "https://app.smartsheet.com/sheets/abc",
  columns,
  rows,
  ...extra,
});

describe("weekdayOf", () => {
  it("names the weekday for a ymd", () => {
    expect(weekdayOf("2026-08-03")).toBe("Monday");
    expect(weekdayOf("2026-08-07")).toBe("Friday");
    expect(weekdayOf("2026-08-08")).toBe("Saturday");
  });

  it("rejects anything that is not YYYY-MM-DD", () => {
    expect(weekdayOf("")).toBeNull();
    expect(weekdayOf("08/03/2026")).toBeNull();
    expect(weekdayOf("2026-8-3")).toBeNull();
  });

  it("does not depend on the host timezone", () => {
    // The dev machine runs UTC+8; a local-midnight parse would slide this to
    // Sunday. Parsed as UTC it must stay Monday.
    expect(weekdayOf("2026-08-03")).toBe("Monday");
  });
});

describe("foldSchedule", () => {
  it("buckets rows into weekday tabs using the Date column", () => {
    const s = foldSchedule(
      sheet([
        row({ contractor: "A", date: "2026-08-03", property: "Davenport (44199)", task: "Prep", status: "Pending" }),
        row({ contractor: "B", date: "2026-08-05", property: "Boca Condo", task: "Demo", status: "In Progress" }),
      ]),
      "2026-08-05",
    );
    expect(s.days.map((d) => d.key)).toEqual([...WEEKDAYS]);
    expect(s.days.find((d) => d.key === "Monday")!.rows).toHaveLength(1);
    expect(s.days.find((d) => d.key === "Wednesday")!.rows).toHaveLength(1);
    expect(s.days.find((d) => d.key === "Tuesday")!.rows).toHaveLength(0);
    expect(s.totalRows).toBe(2);
  });

  it("ignores the Day text column and trusts Date when they disagree", () => {
    // Date says Wednesday, the stale Day column says Monday. Date must win.
    const s = foldSchedule(
      sheet([row({ contractor: "A", date: "2026-08-05", day: "Monday", task: "T", status: "Pending" })]),
      "2026-08-05",
    );
    expect(s.days.find((d) => d.key === "Wednesday")!.rows).toHaveLength(1);
    expect(s.days.find((d) => d.key === "Monday")!.rows).toHaveLength(0);
  });

  it("opens on today (Eastern) when that day has rows", () => {
    const rows = WEEKDAYS.map((_, i) =>
      row({ contractor: `C${i}`, date: `2026-08-0${3 + i}`, task: "T", status: "Pending" }),
    );
    expect(foldSchedule(sheet(rows), "2026-08-05").defaultKey).toBe("Wednesday");
    expect(foldSchedule(sheet(rows), "2026-08-07").defaultKey).toBe("Friday");
    expect(foldSchedule(sheet(rows), "2026-08-03").defaultKey).toBe("Monday");
  });

  it("falls back to the first populated day on a weekend", () => {
    const rows = [
      row({ contractor: "A", date: "2026-08-04", task: "T", status: "Pending" }), // Tuesday
      row({ contractor: "B", date: "2026-08-06", task: "T", status: "Pending" }), // Thursday
    ];
    // Saturday 08-08 and Sunday 08-09 have no tab of their own.
    expect(foldSchedule(sheet(rows), "2026-08-08").defaultKey).toBe("Tuesday");
    expect(foldSchedule(sheet(rows), "2026-08-09").defaultKey).toBe("Tuesday");
    expect(foldSchedule(sheet(rows), "2026-08-08").todayWeekday).toBe("Saturday");
  });

  it("falls back when today's weekday exists but is empty", () => {
    const s = foldSchedule(
      sheet([row({ contractor: "A", date: "2026-08-07", task: "T", status: "Pending" })]),
      "2026-08-05", // Wednesday, which has no rows
    );
    expect(s.defaultKey).toBe("Friday");
  });

  it("defaults to Monday for an empty sheet without throwing", () => {
    const s = foldSchedule(sheet([]), "2026-08-05");
    expect(s.defaultKey).toBe("Monday");
    expect(s.totalRows).toBe(0);
    expect(s.days).toHaveLength(5);
  });

  it("counts weekend and undated rows instead of dropping them silently", () => {
    const s = foldSchedule(
      sheet([
        row({ contractor: "Sat", date: "2026-08-08", task: "T", status: "Pending" }),
        row({ contractor: "Sun", date: "2026-08-09", task: "T", status: "Pending" }),
        row({ contractor: "NoDate", task: "T", status: "Pending" }),
        row({ contractor: "Good", date: "2026-08-03", task: "T", status: "Pending" }),
      ]),
      "2026-08-03",
    );
    expect(s.weekendRows).toBe(2);
    expect(s.undatedRows).toBe(1);
    expect(s.totalRows).toBe(1);
  });

  it("skips blank padding rows", () => {
    const s = foldSchedule(
      sheet([row({ date: "2026-08-03" }), row({ contractor: "", property: "", task: "", status: "" })]),
      "2026-08-03",
    );
    expect(s.totalRows).toBe(0);
    expect(s.undatedRows).toBe(0); // the padding row is skipped before date handling
  });

  it("reads the ISO value for Date, not the locale-formatted displayValue", () => {
    // Smartsheet sends DATE cells as value:"2026-08-03" with a display string
    // like "08/03/26". Reading displayValue would empty every tab.
    const r = {
      id: 1000,
      cells: [
        { columnId: C.contractor, value: "A" },
        { columnId: C.date, value: "2026-08-03", displayValue: "08/03/26" },
        { columnId: C.task, value: "T" },
        { columnId: C.status, value: "Pending" },
      ],
    };
    const s = foldSchedule(sheet([r]), "2026-08-03");
    expect(s.undatedRows).toBe(0);
    expect(s.days.find((d) => d.key === "Monday")!.rows).toHaveLength(1);
    expect(s.days.find((d) => d.key === "Monday")!.date).toBe("2026-08-03");
  });

  it("still reads a Date cell that only has displayValue", () => {
    const r = {
      id: 1001,
      cells: [
        { columnId: C.contractor, value: "A" },
        { columnId: C.date, displayValue: "2026-08-04" },
        { columnId: C.status, value: "Pending" },
      ],
    };
    expect(foldSchedule(sheet([r]), "2026-08-04").days.find((d) => d.key === "Tuesday")!.rows).toHaveLength(1);
  });

  it("carries the five requested fields, preferring displayValue for text", () => {
    const r = {
      id: 99,
      cells: [
        { columnId: C.contractor, value: "Gary Floyd Jr." },
        { columnId: C.date, value: "2026-08-03" },
        { columnId: C.property, value: "Jacksonville North (812)" },
        { columnId: C.task, value: "Begin renovation" },
        { columnId: C.status, value: "In Progress" },
        { columnId: C.update, value: "raw", displayValue: "Pressure washing done" },
      ],
    };
    const got = foldSchedule(sheet([r]), "2026-08-03").days.find((d) => d.key === "Monday")!.rows[0];
    expect(got).toMatchObject({
      contractor: "Gary Floyd Jr.",
      property: "Jacksonville North (812)",
      task: "Begin renovation",
      status: "In Progress",
      update: "Pressure washing done",
    });
  });

  it("sorts a day by contractor so rows hold position across tabs", () => {
    const s = foldSchedule(
      sheet([
        row({ contractor: "Zacharie Edmond", date: "2026-08-03", task: "T", status: "Pending" }),
        row({ contractor: "Arlis Velazquez", date: "2026-08-03", task: "T", status: "Pending" }),
        row({ contractor: "Gary Floyd Jr.", date: "2026-08-03", task: "T", status: "Pending" }),
      ]),
      "2026-08-03",
    );
    expect(s.days.find((d) => d.key === "Monday")!.rows.map((r) => r.contractor)).toEqual([
      "Arlis Velazquez",
      "Gary Floyd Jr.",
      "Zacharie Edmond",
    ]);
  });

  it("exposes the sheet name and permalink for the source link", () => {
    const s = foldSchedule(sheet([]), "2026-08-05");
    expect(s.sheetName).toBe("Contractor Schedule 08-03 to 08-07-26");
    expect(s.permalink).toBe("https://app.smartsheet.com/sheets/abc");
  });

  it("survives a sheet with no permalink", () => {
    const s = foldSchedule(sheet([], { permalink: undefined }), "2026-08-05");
    expect(s.permalink).toBe("");
  });

  it("tags each day with its real date", () => {
    const s = foldSchedule(
      sheet([row({ contractor: "A", date: "2026-08-06", task: "T", status: "Pending" })]),
      "2026-08-06",
    );
    expect(s.days.find((d) => d.key === "Thursday")!.date).toBe("2026-08-06");
    expect(s.days.find((d) => d.key === "Monday")!.date).toBe("");
  });
});
