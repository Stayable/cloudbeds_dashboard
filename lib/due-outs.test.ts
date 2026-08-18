import { describe, it, expect } from "vitest";
import { foldDueOutRooms, buildDueOutCard, type DueOutProperty } from "@/lib/due-outs";
import { PROPERTIES } from "@/config/properties";

const prop = (code: string) => PROPERTIES.find((p) => p.code === code)!;

describe("foldDueOutRooms", () => {
  it("splits a multi-room reservation into one entry per room", () => {
    // Jacksonville West, 08/15/26: 12 reservations across 15 rooms. Counting
    // reservations would have sent PMs to walk three fewer doors than exist.
    const { rooms, reservations } = foldDueOutRooms({
      dims: [
        ["R1", "412, 208"],
        ["R2", "404"],
      ],
    });
    expect(rooms).toEqual(["208", "404", "412"]);
    expect(reservations).toBe(2);
  });

  it("names a room once when two reservations both list it", () => {
    // Observed at Jacksonville West on 08/15/26 (room 324) — a same-day turn.
    const { rooms, reservations } = foldDueOutRooms({
      dims: [
        ["R1", "324"],
        ["R2", "324, 109"],
      ],
    });
    expect(rooms).toEqual(["109", "324"]);
    expect(reservations).toBe(2);
  });

  it("de-duplicates repeated reservation rows", () => {
    const { reservations } = foldDueOutRooms({ dims: [["R1", "101"], ["R1", "101"]] });
    expect(reservations).toBe(1);
  });

  it("sorts numerically, not lexically", () => {
    // Orlando OBT has 4-digit rooms; a string sort puts 1102 before 106.
    const { rooms } = foldDueOutRooms({ dims: [["R1", "1102, 106, 2202"]] });
    expect(rooms).toEqual(["106", "1102", "2202"]);
  });

  it("keeps non-numeric room names rather than sorting them as NaN", () => {
    // Lakeland has an "APT1" in its live inventory.
    const { rooms } = foldDueOutRooms({ dims: [["R1", "APT1, 213"]] });
    expect(rooms).toEqual(["213", "APT1"]);
  });

  it("ignores blank room fields and blank reservation numbers", () => {
    const { rooms, reservations } = foldDueOutRooms({ dims: [["", "999"], ["R1", ""], ["R2", " 101 , "]] });
    expect(rooms).toEqual(["101"]);
    expect(reservations).toBe(2);
  });

  it("returns empty for no rows", () => {
    expect(foldDueOutRooms({ dims: [] })).toEqual({ rooms: [], reservations: 0 });
  });
});

describe("buildDueOutCard", () => {
  const rows: DueOutProperty[] = [
    { property: prop("DP"), rooms: ["219", "245"], reservations: 2 },
    { property: prop("LL"), rooms: [], reservations: 0 },
  ];

  it("stamps the property ID on every row (CLAUDE.md §3/§7)", () => {
    const card = JSON.stringify(buildDueOutCard("2026-08-15", rows));
    expect(card).toContain("Davenport (44199)");
    expect(card).toContain("Lakeland (4645)");
  });

  it("distinguishes a real zero from an unread property", () => {
    const withFailure: DueOutProperty[] = [...rows, { property: prop("KE"), rooms: null, reservations: null }];
    const card = JSON.stringify(buildDueOutCard("2026-08-15", withFailure));
    expect(card).toContain("no rooms due out"); // Lakeland, genuinely zero
    expect(card).toContain("unavailable"); // Kissimmee East, not read
    // The distinction must survive into the footer too, or a short list reads
    // as a complete one.
    expect(card).toContain("shown as unavailable, not as zero");
  });

  it("omits the failure warning when every property was read", () => {
    expect(JSON.stringify(buildDueOutCard("2026-08-15", rows))).not.toContain("unavailable");
  });

  it("counts rooms, and counts only properties that were actually read", () => {
    const withFailure: DueOutProperty[] = [...rows, { property: prop("KE"), rooms: null, reservations: null }];
    const card = JSON.stringify(buildDueOutCard("2026-08-15", withFailure));
    expect(card).toContain("2 rooms scheduled to check out across 2 properties");
  });

  it("renders the stay date in Eastern-safe terms, not shifted by a day", () => {
    // Built at UTC noon on purpose: a naive `new Date("2026-08-15")` renders as
    // Aug 14 for any reader west of Greenwich.
    expect(JSON.stringify(buildDueOutCard("2026-08-15", rows))).toContain("Saturday, August 15, 2026");
  });

  it("adds the workbook button only when a URL is supplied", () => {
    const without = buildDueOutCard("2026-08-15", rows) as { actions?: unknown[] };
    expect(without.actions).toBeUndefined();

    const withUrl = buildDueOutCard("2026-08-15", rows, {
      workbookUrl: "https://example.sharepoint.com/x.xlsx",
    }) as { actions: { type: string; url: string }[] };
    expect(withUrl.actions).toHaveLength(1);
    expect(withUrl.actions[0].type).toBe("Action.OpenUrl");
    expect(withUrl.actions[0].url).toBe("https://example.sharepoint.com/x.xlsx");
  });

  it("marks a test send and says no action is required", () => {
    const card = JSON.stringify(buildDueOutCard("2026-08-15", rows, { test: true }));
    expect(card).toContain("TEST");
    expect(card).toContain("No action is required");
  });

  it("puts nothing but rooms in the data cells", () => {
    // The /bea §3 exception does not reach a Teams channel (CLAUDE.md §5 r2).
    //
    // Asserted against the FACT VALUES rather than the whole card, because the
    // card's prose legitimately contains the word "guest" ("no guest details")
    // and its schema URL contains "$". A whole-card regex flagged both — the
    // same false positive as the PII regex that once flagged "portfolio".
    // The data cells are where a guest name could actually leak.
    const card = buildDueOutCard("2026-08-15", [
      ...rows,
      { property: prop("KE"), rooms: null, reservations: null },
    ]) as { body: { type: string; facts?: { value: string }[] }[] };
    const values = card.body.find((b) => b.type === "FactSet")!.facts!.map((f) => f.value);

    for (const v of values) {
      // Every cell is one of exactly three shapes: a room list, a real zero, or
      // an unread property. Anything else is a new field nobody reviewed.
      expect(v).toMatch(/^(\d+ rooms? — [\w, ]+|no rooms due out|unavailable — Cloudbeds did not respond)$/);
    }
    // And no currency anywhere in the cells — balances stay on /bea.
    expect(values.join(" ")).not.toMatch(/\$|\d+\.\d{2}/);
  });

  it("singularises one room and one property", () => {
    const one: DueOutProperty[] = [{ property: prop("JN"), rooms: ["320"], reservations: 1 }];
    const card = JSON.stringify(buildDueOutCard("2026-08-15", one));
    expect(card).toContain("1 room scheduled to check out across 1 property");
    expect(card).toContain("1 room — 320");
  });
});
