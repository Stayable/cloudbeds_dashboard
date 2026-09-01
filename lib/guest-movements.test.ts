import { describe, expect, it } from "vitest";
import {
  joinMovementRows,
  movementState,
  nightsBetween,
  parseGuestName,
  splitByDate,
  type Dataset3Rows,
} from "./guest-movements";

// --- parseGuestName ----------------------------------------------------------
//
// Measured against all 8 live properties on 2026-09-01: of 945 in-house/future
// names, 588 carried a trailing `*` marker. Distribution: ML 599, D 73, WL 8,
// bare `*` 3, ` ML` 2, `ML Active Eviction` 2, `WL Active Eviction` 1.

describe("parseGuestName", () => {
  it("splits the trailing rate marker off the name", () => {
    expect(parseGuestName("Fafa Prestil*ML")).toEqual({
      name: "Fafa Prestil",
      marker: "ML",
      note: "",
    });
  });

  it("PRESERVES trailing free text — 'Active Eviction' is real operational signal", () => {
    // 3 live reservations carried this on 2026-09-01. A blind strip of everything
    // after `*` would delete it silently. That is the bug this test exists for.
    expect(parseGuestName("Someone Real*ML Active Eviction")).toEqual({
      name: "Someone Real",
      marker: "ML",
      note: "Active Eviction",
    });
    expect(parseGuestName("Other Person*WL Active Eviction")).toEqual({
      name: "Other Person",
      marker: "WL",
      note: "Active Eviction",
    });
  });

  it("handles the D marker", () => {
    expect(parseGuestName("Walk In Guest*D")).toEqual({ name: "Walk In Guest", marker: "D", note: "" });
  });

  it("tolerates the space-before-marker variant seen twice live", () => {
    expect(parseGuestName("Spaced Name* ML")).toEqual({ name: "Spaced Name", marker: "ML", note: "" });
  });

  it("tolerates a bare trailing asterisk, seen 3 times live", () => {
    expect(parseGuestName("Bare Star*")).toEqual({ name: "Bare Star", marker: "", note: "" });
  });

  it("leaves a name with no marker completely alone", () => {
    expect(parseGuestName("Grace Hopper")).toEqual({ name: "Grace Hopper", marker: "", note: "" });
  });

  it("keeps an UNRECOGNISED marker as a note rather than discarding it", () => {
    // A marker we have never seen is information, not noise. Treating it as a
    // note means a new staff convention shows up on screen instead of vanishing.
    expect(parseGuestName("New Convention*XYZ")).toEqual({
      name: "New Convention",
      marker: "",
      note: "XYZ",
    });
  });

  it("trims surrounding whitespace on the name", () => {
    expect(parseGuestName("  Padded Name  *ML").name).toBe("Padded Name");
  });

  it("returns empty for an empty input rather than throwing", () => {
    expect(parseGuestName("")).toEqual({ name: "", marker: "", note: "" });
  });

  it("splits on the LAST asterisk, so a name containing one survives", () => {
    expect(parseGuestName("Odd*Name*ML")).toEqual({ name: "Odd*Name", marker: "ML", note: "" });
  });

  // The `*` form is not the only convention. Measured across 945 live names on
  // 2026-09-01: 9 reservations mention an eviction and only 3 use the `*` form —
  // the other 6 write it inline. 36 names carry a bracketed [LTG RATE] /
  // [EMPLOYEE] tag and 5 a parenthetical one. All of it is staff-entered
  // operational data sitting in the name field.

  it("extracts an INLINE eviction flag that has no asterisk — 6 of 9 live cases", () => {
    expect(parseGuestName("Evon Pulley Active Eviction")).toEqual({
      name: "Evon Pulley",
      marker: "",
      note: "Active Eviction",
    });
  });

  it("extracts the bare word Eviction too", () => {
    expect(parseGuestName("Bernard Shadrawy Eviction")).toEqual({
      name: "Bernard Shadrawy",
      marker: "",
      note: "Eviction",
    });
  });

  it("extracts a bracketed tag", () => {
    expect(parseGuestName("Jesse Lane [LTG RATE]")).toEqual({
      name: "Jesse Lane",
      marker: "",
      note: "LTG RATE",
    });
  });

  it("extracts a parenthetical tag", () => {
    expect(parseGuestName("Jose Paredes (Employee)")).toEqual({
      name: "Jose Paredes",
      marker: "",
      note: "Employee",
    });
  });

  it("handles the worst live case: inline eviction AND a bracketed tag", () => {
    // JN, seen 2026-09-01. Eviction leads the note because it is the urgent bit.
    expect(parseGuestName("Nichole Scott Active Eviction [LTG RATE]")).toEqual({
      name: "Nichole Scott",
      marker: "",
      note: "Active Eviction · LTG RATE",
    });
  });

  it("handles marker AND inline eviction together", () => {
    expect(parseGuestName("Rachael Porter*ML Active Eviction")).toEqual({
      name: "Rachael Porter",
      marker: "ML",
      note: "Active Eviction",
    });
  });

  it("is case-insensitive about the eviction phrase", () => {
    expect(parseGuestName("Someone ACTIVE EVICTION").note).toBe("Active Eviction");
    expect(parseGuestName("Someone active eviction").note).toBe("Active Eviction");
  });

  it("does not mangle a name that merely contains no flags", () => {
    expect(parseGuestName("Barton Lamarre")).toEqual({
      name: "Barton Lamarre",
      marker: "",
      note: "",
    });
  });

  it("collapses the whitespace a mid-name extraction leaves behind", () => {
    expect(parseGuestName("Kendala  Jennings (LTG - WEEKLY RATE)")).toEqual({
      name: "Kendala Jennings",
      marker: "",
      note: "LTG - WEEKLY RATE",
    });
  });

  it("never returns an empty name just because the whole field was a flag", () => {
    // Degenerate, but a blank name column is worse than showing the raw text.
    expect(parseGuestName("[LTG RATE]").name).toBe("[LTG RATE]");
  });
});

// --- nightsBetween -----------------------------------------------------------

describe("nightsBetween", () => {
  it("counts nights, not days — a Mon→Thu stay is 3", () => {
    expect(nightsBetween("2026-09-01", "2026-09-04")).toBe(3);
  });

  it("returns 0 for a same-day in-and-out rather than null", () => {
    // A real shape: day-use, or a guest who checked in and left the same day.
    // 0 is a fact; null would wrongly read as "unknown".
    expect(nightsBetween("2026-09-01", "2026-09-01")).toBe(0);
  });

  it("spans a month boundary correctly", () => {
    expect(nightsBetween("2026-08-30", "2026-09-02")).toBe(3);
  });

  it("returns null when either date is missing — unknown, not zero", () => {
    expect(nightsBetween("", "2026-09-04")).toBeNull();
    expect(nightsBetween("2026-09-01", "")).toBeNull();
  });

  it("returns null on an unparseable date rather than NaN", () => {
    expect(nightsBetween("not-a-date", "2026-09-04")).toBeNull();
  });

  it("returns null when checkout precedes checkin — that is bad data, not negative nights", () => {
    expect(nightsBetween("2026-09-04", "2026-09-01")).toBeNull();
  });

  it("is unaffected by the DST change — it counts calendar days, not hours", () => {
    // 2026-11-01 is the EDT→EST switch. An hours-based diff would yield 1.04
    // days here and floor/round could give 1 instead of 2 for some spans.
    expect(nightsBetween("2026-10-31", "2026-11-02")).toBe(2);
  });
});

// --- movementState -----------------------------------------------------------

describe("movementState", () => {
  it("maps arrivals: not yet here is `expected`", () => {
    expect(movementState("Confirmed", "arrivals")).toBe("expected");
    expect(movementState("Not Confirmed", "arrivals")).toBe("expected");
  });

  it("maps arrivals: In-House means they got here", () => {
    expect(movementState("In-House", "arrivals")).toBe("arrived");
  });

  it("maps arrivals: Checked Out still means they arrived — same-day in and out", () => {
    // Not `departed`. On an ARRIVALS list the question is whether they showed up.
    expect(movementState("Checked Out", "arrivals")).toBe("arrived");
  });

  it("maps departures: In-House means still here and due out", () => {
    expect(movementState("In-House", "departures")).toBe("due-out");
  });

  it("maps departures: Checked Out means gone", () => {
    expect(movementState("Checked Out", "departures")).toBe("departed");
  });

  it("maps departures: a Confirmed reservation due out has not arrived yet", () => {
    expect(movementState("Confirmed", "departures")).toBe("expected");
  });

  it("marks cancellations and no-shows in BOTH directions", () => {
    for (const dir of ["arrivals", "departures"] as const) {
      expect(movementState("Cancelled", dir), dir).toBe("cancelled");
      expect(movementState("No Show", dir), dir).toBe("cancelled");
    }
  });

  it("falls through to `other` for a status it has never seen", () => {
    // Cloudbeds adding a status must not silently become `arrived`.
    expect(movementState("Pending Payment", "arrivals")).toBe("other");
  });

  it("is case- and space-insensitive, because the API is not a contract", () => {
    expect(movementState("in-house", "arrivals")).toBe("arrived");
    expect(movementState("  Checked Out  ", "departures")).toBe("departed");
  });

  it("treats an empty status as `other`, never as a real state", () => {
    expect(movementState("", "arrivals")).toBe("other");
  });
});

// --- joinMovementRows --------------------------------------------------------

const names: Dataset3Rows = {
  dims: [
    ["R1", "Ada Lovelace", "2"],
    ["R2", "Grace Hopper", "1"],
  ],
};
const dates: Dataset3Rows = {
  dims: [
    ["R1", "2026-09-01", "2026-09-04"],
    ["R2", "2026-09-01", "2026-09-02"],
  ],
};
const rooms: Dataset3Rows = {
  dims: [
    ["R1", "204", "In-House"],
    ["R2", "110, 112", "Confirmed"],
  ],
};

describe("joinMovementRows", () => {
  it("joins the three queries on reservation_number", () => {
    const out = joinMovementRows({ names, dates, rooms, direction: "arrivals" });
    const r1 = out.find((r) => r.reservationNumber === "R1")!;
    expect(r1.guest).toBe("Ada Lovelace");
    expect(r1.guests).toBe(2);
    expect(r1.rooms).toBe("204");
    expect(r1.checkin).toBe("2026-09-01");
    expect(r1.checkout).toBe("2026-09-04");
    expect(r1.nights).toBe(3);
    expect(r1.status).toBe("In-House");
    expect(r1.state).toBe("arrived");
  });

  it("keeps rooms comma-joined when a reservation holds several", () => {
    // Same reason as foldDueOutRooms: a stay can span doors.
    const out = joinMovementRows({ names, dates, rooms, direction: "arrivals" });
    expect(out.find((r) => r.reservationNumber === "R2")!.rooms).toBe("110, 112");
  });

  it("STRIPS NAMES when `names` is null — the PII regression test", () => {
    // includeGuests:false must not merely hide the column. Props cross into the
    // RSC payload and are readable in the browser, so an unstripped name is a
    // leak even when nothing renders it. If this test fails, guest names are
    // reaching levels that may not see them.
    const out = joinMovementRows({ names: null, dates, rooms, direction: "arrivals" });
    expect(out).toHaveLength(2);
    for (const row of out) {
      expect(row.guest).toBe("");
      expect(row.guests).toBeNull();
    }
    // and the rest of the row still works — the fallback stays useful
    expect(out.find((r) => r.reservationNumber === "R1")!.rooms).toBe("204");
    expect(out.find((r) => r.reservationNumber === "R1")!.nights).toBe(3);
  });

  it("keeps a reservation missing from the dates query, with blanks not a drop", () => {
    const partial: Dataset3Rows = { dims: [["R1", "2026-09-01", "2026-09-04"]] };
    const out = joinMovementRows({ names, dates: partial, rooms, direction: "arrivals" });
    const r2 = out.find((r) => r.reservationNumber === "R2");
    expect(r2).toBeDefined();
    expect(r2!.checkin).toBe("");
    expect(r2!.nights).toBeNull();
    expect(r2!.rooms).toBe("110, 112"); // what we DO know is still shown
  });

  it("keeps a reservation missing from the rooms query too", () => {
    const partial: Dataset3Rows = { dims: [["R1", "204", "In-House"]] };
    const out = joinMovementRows({ names, dates, rooms: partial, direction: "arrivals" });
    const r2 = out.find((r) => r.reservationNumber === "R2")!;
    expect(r2.rooms).toBe("");
    expect(r2.status).toBe("");
    expect(r2.state).toBe("other"); // unknown status is never a real state
  });

  it("de-duplicates on reservation_number", () => {
    // Observed on dataset 3 at Jacksonville West (due-outs.ts): a reservation
    // can legitimately come back on more than one row.
    const dupes: Dataset3Rows = {
      dims: [
        ["R1", "Ada Lovelace", "2"],
        ["R1", "Ada Lovelace", "2"],
      ],
    };
    const out = joinMovementRows({ names: dupes, dates, rooms, direction: "arrivals" });
    expect(out.filter((r) => r.reservationNumber === "R1")).toHaveLength(1);
  });

  it("skips rows with a blank reservation number rather than making a phantom row", () => {
    const junk: Dataset3Rows = { dims: [["", "Nobody", "1"], ["R1", "Ada Lovelace", "2"]] };
    const out = joinMovementRows({ names: junk, dates, rooms, direction: "arrivals" });
    expect(out.every((r) => r.reservationNumber !== "")).toBe(true);
  });

  it("sorts in door order, numeric-aware, so 110 precedes 204 and 1102", () => {
    const many: Dataset3Rows = {
      dims: [
        ["R1", "1102", "In-House"],
        ["R2", "204", "In-House"],
        ["R3", "110", "In-House"],
      ],
    };
    const d: Dataset3Rows = {
      dims: [
        ["R1", "2026-09-01", "2026-09-02"],
        ["R2", "2026-09-01", "2026-09-02"],
        ["R3", "2026-09-01", "2026-09-02"],
      ],
    };
    const out = joinMovementRows({ names: null, dates: d, rooms: many, direction: "arrivals" });
    expect(out.map((r) => r.rooms)).toEqual(["110", "204", "1102"]);
  });

  it("does not choke on a non-numeric room name (Lakeland has an APT1)", () => {
    const mixed: Dataset3Rows = {
      dims: [
        ["R1", "APT1", "In-House"],
        ["R2", "204", "In-House"],
      ],
    };
    const d: Dataset3Rows = {
      dims: [
        ["R1", "2026-09-01", "2026-09-02"],
        ["R2", "2026-09-01", "2026-09-02"],
      ],
    };
    const out = joinMovementRows({ names: null, dates: d, rooms: mixed, direction: "arrivals" });
    expect(out).toHaveLength(2);
    expect(out.map((r) => r.rooms)).toContain("APT1");
  });

  it("cleans the rate marker off names during the join, and surfaces the note", () => {
    const marked: Dataset3Rows = {
      dims: [
        ["R1", "Ada Lovelace*ML", "2"],
        ["R2", "Grace Hopper*WL Active Eviction", "1"],
      ],
    };
    const out = joinMovementRows({ names: marked, dates, rooms, direction: "arrivals" });
    const r1 = out.find((r) => r.reservationNumber === "R1")!;
    const r2 = out.find((r) => r.reservationNumber === "R2")!;
    expect(r1.guest).toBe("Ada Lovelace");
    expect(r1.note).toBe("");
    expect(r2.guest).toBe("Grace Hopper");
    expect(r2.note).toBe("Active Eviction");
  });

  it("leaves `note` empty when names are stripped, so no PII-adjacent text leaks", () => {
    // The note comes out of the name field. If names are withheld, the note must
    // be withheld too — it is the same string.
    const marked: Dataset3Rows = { dims: [["R2", "Grace Hopper*WL Active Eviction", "1"]] };
    void marked;
    const out = joinMovementRows({ names: null, dates, rooms, direction: "arrivals" });
    for (const row of out) expect(row.note).toBe("");
  });

  it("reads guest_count as a number, and null when it is not one", () => {
    const odd: Dataset3Rows = { dims: [["R1", "Ada Lovelace", ""]] };
    const out = joinMovementRows({ names: odd, dates, rooms, direction: "arrivals" });
    expect(out.find((r) => r.reservationNumber === "R1")!.guests).toBeNull();
  });

  it("returns an empty list for empty input, not a crash", () => {
    const empty: Dataset3Rows = { dims: [] };
    expect(joinMovementRows({ names: empty, dates: empty, rooms: empty, direction: "arrivals" })).toEqual([]);
  });
});

// --- splitByDate -------------------------------------------------------------

describe("splitByDate", () => {
  const rows = joinMovementRows({ names, dates, rooms, direction: "arrivals" });

  it("buckets arrivals by CHECK-IN date", () => {
    const out = splitByDate(rows, ["2026-09-01", "2026-09-02"], "arrivals");
    expect(out["2026-09-01"].map((r) => r.reservationNumber).sort()).toEqual(["R1", "R2"]);
    expect(out["2026-09-02"]).toEqual([]);
  });

  it("buckets departures by CHECKOUT date — the other end of the stay", () => {
    const out = splitByDate(rows, ["2026-09-01", "2026-09-02"], "departures");
    // R2 checks out 09-02; R1 checks out 09-04, outside the range
    expect(out["2026-09-02"].map((r) => r.reservationNumber)).toEqual(["R2"]);
    expect(out["2026-09-01"]).toEqual([]);
  });

  it("gives every requested day a key, so a quiet day reads as empty not missing", () => {
    const out = splitByDate(rows, ["2026-09-01", "2026-09-02", "2026-09-03"], "arrivals");
    expect(Object.keys(out).sort()).toEqual(["2026-09-01", "2026-09-02", "2026-09-03"]);
  });

  it("drops a row whose date falls outside every requested day", () => {
    const out = splitByDate(rows, ["2026-09-05"], "arrivals");
    expect(out["2026-09-05"]).toEqual([]);
  });

  it("drops a row with no date at all rather than bucketing it arbitrarily", () => {
    const partial: Dataset3Rows = { dims: [["R1", "2026-09-01", "2026-09-04"]] };
    const withBlank = joinMovementRows({ names, dates: partial, rooms, direction: "arrivals" });
    const out = splitByDate(withBlank, ["2026-09-01"], "arrivals");
    expect(out["2026-09-01"].map((r) => r.reservationNumber)).toEqual(["R1"]);
  });

  it("preserves the door order established by the join", () => {
    const many: Dataset3Rows = {
      dims: [
        ["R1", "1102", "In-House"],
        ["R2", "110", "In-House"],
      ],
    };
    const d: Dataset3Rows = {
      dims: [
        ["R1", "2026-09-01", "2026-09-02"],
        ["R2", "2026-09-01", "2026-09-02"],
      ],
    };
    const sorted = joinMovementRows({ names: null, dates: d, rooms: many, direction: "arrivals" });
    const out = splitByDate(sorted, ["2026-09-01"], "arrivals");
    expect(out["2026-09-01"].map((r) => r.rooms)).toEqual(["110", "1102"]);
  });
});
