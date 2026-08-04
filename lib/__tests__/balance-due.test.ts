import { describe, it, expect } from "vitest";
import { foldBalanceRows } from "@/lib/balance-due";

const BAL = "reservation_balance_due_amount";

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

describe("foldBalanceRows", () => {
  it("joins guest/room to check-in/rate-plan on reservation number", () => {
    const s = foldBalanceRows(
      identity([["R1", "Ana Reyes", "100"]], [975]),
      terms([["R1", "2026-06-05", "Monthly Lease"]]),
    );
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0]).toMatchObject({
      reservationNumber: "R1",
      guest: "Ana Reyes",
      rooms: "100",
      balanceDue: 975,
      checkin: "2026-06-05",
      ratePlan: "Monthly Lease",
      leaseClass: "lease-monthly",
    });
    expect(s.total).toBe(975);
    expect(s.leaseCount).toBe(1);
    expect(s.transientCount).toBe(0);
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
    );
    expect(s.rows).toHaveLength(1);
    expect(s.total).toBe(400);
    expect(s.creditCount).toBe(2);
    expect(s.creditTotal).toBeCloseTo(200.5, 2);
  });

  it("treats sub-cent noise as no balance", () => {
    const s = foldBalanceRows(identity([["R1", "Rounding", "100"]], [0.001]), terms([]));
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
    );
    expect(s.leaseCount).toBe(1);
    expect(s.transientCount).toBe(1);
    // Biggest balance first regardless of type — KE's real shape.
    expect(s.rows[0].guest).toBe("Transient guest");
    expect(s.rows[0].leaseClass).toBe("transient");
  });

  it("keeps a reservation whose terms row is missing rather than dropping it", () => {
    const s = foldBalanceRows(identity([["R1", "No terms", "100"]], [300]), terms([]));
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
    );
    expect(s.rows).toHaveLength(1);
    expect(s.total).toBeCloseTo(1129.03, 2);
    expect(s.inHouseCount).toBe(1);
  });

  it("renders an em dash when guest or room is blank", () => {
    const s = foldBalanceRows(identity([["R1", "", ""]], [100]), terms([]));
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
    );
    expect(a.rows.map((r) => r.reservationNumber)).toEqual(b.rows.map((r) => r.reservationNumber));
  });
});
