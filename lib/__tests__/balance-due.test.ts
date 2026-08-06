import { describe, it, expect } from "vitest";
import { foldBalanceRows } from "@/lib/balance-due";

const BAL = "reservation_balance_due_amount";
const AS_OF = "2026-08-06";

// Shapes mirror the live dataset-3 `details:true` response: `dims` is one
// string[] per reservation in the order the group columns were requested, and
// `records[col]` is a parallel number[].
const identity = (rows: [string, string, string][], balances: number[]) => ({
  dims: rows.map((r) => [...r]),
  records: { [BAL]: balances },
});
const terms = (rows: [string, string, string][]) => ({
  dims: rows.map((r) => [...r]),
  records: { [BAL]: rows.map(() => 0) },
});
// The departures query groups on two columns only: reservation + checkout_date.
const departures = (rows: [string, string][]) => ({
  dims: rows.map((r) => [...r]),
  records: { [BAL]: rows.map(() => 0) },
});
const NO_DEPARTURES = departures([]);

describe("foldBalanceRows", () => {
  it("joins guest/room to check-in/rate-plan on reservation number", () => {
    const s = foldBalanceRows(
      identity([["R1", "Ana Reyes", "100"]], [975]),
      terms([["R1", "2026-06-05", "Monthly Lease"]]),
      departures([["R1", "2026-09-05"]]),
      AS_OF,
    );
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0]).toMatchObject({
      reservationNumber: "R1",
      guest: "Ana Reyes",
      rooms: "100",
      balanceDue: 975,
      checkin: "2026-06-05",
      checkout: "2026-09-05",
      departure: "future",
      ratePlan: "Monthly Lease",
      leaseClass: "lease-monthly",
    });
    expect(s.total).toBe(975);
    expect(s.leaseCount).toBe(1);
    expect(s.transientCount).toBe(0);
    expect(s.overdueCount).toBe(0);
  });

  it("keeps only positive balances and sorts by balance descending", () => {
    const s = foldBalanceRows(
      identity(
        [
          ["R1", "Small", "101"],
          ["R2", "Big", "102"],
          ["R3", "Zero", "103"],
          ["R4", "Mid", "104"],
        ],
        [25, 1150, 0, 500],
      ),
      terms([]),
      NO_DEPARTURES,
      AS_OF,
    );
    expect(s.rows.map((r) => r.guest)).toEqual(["Big", "Mid", "Small"]);
    expect(s.total).toBe(1675);
    expect(s.inHouseCount).toBe(4);
  });

  it("excludes credits from rows and totals but reports them", () => {
    const s = foldBalanceRows(
      identity(
        [
          ["R1", "Owes", "100"],
          ["R2", "In credit", "101"],
          ["R3", "Also credit", "102"],
        ],
        [400, -150, -50.5],
      ),
      terms([]),
      NO_DEPARTURES,
      AS_OF,
    );
    expect(s.rows).toHaveLength(1);
    expect(s.total).toBe(400);
    expect(s.creditCount).toBe(2);
    expect(s.creditTotal).toBeCloseTo(200.5, 2);
  });

  it("treats sub-cent noise as no balance", () => {
    const s = foldBalanceRows(identity([["R1", "Rounding", "100"]], [0.001]), terms([]), NO_DEPARTURES, AS_OF);
    expect(s.rows).toHaveLength(0);
    expect(s.creditCount).toBe(0);
    expect(s.inHouseCount).toBe(1);
  });

  it("classifies transient separately from lease", () => {
    const s = foldBalanceRows(
      identity(
        [
          ["R1", "Lease guest", "100"],
          ["R2", "Transient guest", "114"],
        ],
        [975, 10138.68],
      ),
      terms([
        ["R1", "2026-03-08", "Monthly Lease"],
        ["R2", "2026-06-19", "Standard Rate"],
      ]),
      NO_DEPARTURES,
      AS_OF,
    );
    expect(s.leaseCount).toBe(1);
    expect(s.transientCount).toBe(1);
    // Biggest balance first regardless of type — KE's real shape.
    expect(s.rows[0].guest).toBe("Transient guest");
    expect(s.rows[0].leaseClass).toBe("transient");
  });

  it("keeps a reservation whose terms row is missing rather than dropping it", () => {
    const s = foldBalanceRows(identity([["R1", "No terms", "100"]], [300]), terms([]), NO_DEPARTURES, AS_OF);
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0].checkin).toBe("");
    expect(s.rows[0].leaseClass).toBe("transient"); // unclassifiable plan -> transient
  });

  it("collapses duplicate reservation rows to one", () => {
    // Defensive: if the API ever splits a reservation across rows, the balance
    // must not be counted twice.
    const s = foldBalanceRows(
      identity(
        [
          ["R1", "Ana Reyes", "119, 213"],
          ["R1", "Ana Reyes", "119, 213"],
        ],
        [1129.03, 1129.03],
      ),
      terms([["R1", "2025-02-28", "Monthly Lease"]]),
      departures([
        ["R1", "2026-09-01"],
        ["R1", "2026-09-01"],
      ]),
      AS_OF,
    );
    expect(s.rows).toHaveLength(1);
    expect(s.total).toBeCloseTo(1129.03, 2);
    expect(s.inHouseCount).toBe(1);
  });

  it("renders an em dash when guest or room is blank", () => {
    const s = foldBalanceRows(identity([["R1", "", ""]], [100]), terms([]), NO_DEPARTURES, AS_OF);
    expect(s.rows[0].guest).toBe("—");
    expect(s.rows[0].rooms).toBe("—");
  });

  it("is deterministic when balances tie", () => {
    const a = foldBalanceRows(
      identity(
        [
          ["R2", "B", "202"],
          ["R1", "A", "101"],
        ],
        [975, 975],
      ),
      terms([]),
      NO_DEPARTURES,
      AS_OF,
    );
    const b = foldBalanceRows(
      identity(
        [
          ["R1", "A", "101"],
          ["R2", "B", "202"],
        ],
        [975, 975],
      ),
      terms([]),
      NO_DEPARTURES,
      AS_OF,
    );
    expect(a.rows.map((r) => r.reservationNumber)).toEqual(b.rows.map((r) => r.reservationNumber));
  });

  // --- departure flags: the 08/06/26 defect (see lib/balance-due.ts header) ---

  it("KEEPS a guest whose checkout is asOf and flags them leaving today", () => {
    // The real regression: Davenport res 6872348591162, $4,793.60, checkout ==
    // asOf, was dropped entirely by the old `checkout_date > asOf` filter on the
    // one day Bea most needed to see it.
    const s = foldBalanceRows(
      identity([["R1", "Departing today", "130"]], [4793.6]),
      terms([["R1", "2026-07-01", "Standard Rate"]]),
      departures([["R1", AS_OF]]),
      AS_OF,
    );
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0].departure).toBe("today");
    expect(s.total).toBeCloseTo(4793.6, 2);
    // "Leaving today" is not an overstay — it must not inflate the overdue count.
    expect(s.overdueCount).toBe(0);
  });

  it("flags a still-in-house guest whose checkout has passed as overdue", () => {
    const s = foldBalanceRows(
      identity(
        [
          ["R1", "Overstay", "130"],
          ["R2", "Current", "131"],
        ],
        [4793.6, 500],
      ),
      terms([]),
      departures([
        ["R1", "2026-07-31"],
        ["R2", "2026-12-01"],
      ]),
      AS_OF,
    );
    expect(s.rows.find((r) => r.guest === "Overstay")?.departure).toBe("overdue");
    expect(s.rows.find((r) => r.guest === "Current")?.departure).toBe("future");
    expect(s.overdueCount).toBe(1);
    expect(s.overdueTotal).toBeCloseTo(4793.6, 2);
    // Overdue rows are counted in, never out of, the headline total.
    expect(s.total).toBeCloseTo(5293.6, 2);
  });

  it("reports departure as unknown when the departures query did not resolve", () => {
    // A degraded third query must not let a row masquerade as a current stay.
    const s = foldBalanceRows(identity([["R1", "No checkout", "100"]], [300]), terms([]), NO_DEPARTURES, AS_OF);
    expect(s.rows[0].checkout).toBe("");
    expect(s.rows[0].departure).toBe("unknown");
    expect(s.overdueCount).toBe(0);
  });
});
