// Unit tests for `foldRoomNights` — the pure half of getPaidNightsByPlanDay,
// which replaced the dataset-3 In-House night count on 07/28/26. Numbers below
// are live probe output for Davenport (scripts/probe-nights-from-revenue.mjs),
// cross-checked against Monica's published report; nothing here is invented.
import { describe, it, expect } from "vitest";
import { foldRoomNights } from "./cloudbeds";

const row = (plan: string, roomIdentifier: string, amount: number) => ({ plan, roomIdentifier, amount });

describe("foldRoomNights", () => {
  it("reproduces Monica's Davenport 2026-07-26 split (18 transient / 82 lease)", () => {
    // 7/26 live: Base Rate 10, Book Direct and Save 2, Discounted Weekly Rate 3,
    // Employee Weekly Rate 3 (= 18 transient), Monthly Lease 82. Every row a
    // distinct res_room_identifier.
    const rows = [
      ...Array.from({ length: 10 }, (_, i) => row("Base Rate", `br-${i}`, 55.56)),
      ...Array.from({ length: 2 }, (_, i) => row("Book Direct and Save", `bd-${i}`, 56.53)),
      ...Array.from({ length: 3 }, (_, i) => row("Discounted Weekly Rate", `dw-${i}`, 49.0)),
      ...Array.from({ length: 3 }, (_, i) => row("Employee Weekly Rate", `ew-${i}`, 32.85)),
      ...Array.from({ length: 82 }, (_, i) => row("Monthly Lease", `ml-${i}`, 32.04)),
    ];
    expect(foldRoomNights(rows)).toEqual({ transient: 18, lease: 82, comp: 0 });
  });

  it("treats weekly-RATE plans as transient and only true lease plans as lease", () => {
    const rows = [
      row("Discounted Weekly Rate", "a", 49),
      row("Employee Weekly Rate", "b", 32.85),
      row("Base Rate", "c", 55),
      row("Book Direct and Save", "d", 56),
      row("Monthly Lease", "e", 32),
      row("Weekly Lease", "f", 44.29),
      row("Discounted Long Term Rate", "g", 59.34),
    ];
    // Monica 07/27: Discounted Monthly/Weekly and Employee Weekly are TRANSIENT.
    expect(foldRoomNights(rows)).toEqual({ transient: 4, lease: 3, comp: 0 });
  });

  it("counts one room-night per res_room_identifier, not per transaction", () => {
    // A rate adjustment posts a second Room Rate line against the same
    // reservation-room. Raw row counting would double-count the night.
    const rows = [row("Base Rate", "room-237", 40), row("Base Rate", "room-237", 15.56)];
    expect(foldRoomNights(rows)).toEqual({ transient: 1, lease: 0, comp: 0 });
  });

  it("classifies a $0 net room-night as comp, not as a paid night", () => {
    // Live: 2026-02-15 had 2 such rows (Book Direct and Save at $0.00).
    const rows = [row("Book Direct and Save", "a", 0), row("Base Rate", "b", 55)];
    expect(foldRoomNights(rows)).toEqual({ transient: 1, lease: 0, comp: 1 });
  });

  it("nets a charge against its reversal before deciding comp", () => {
    const rows = [row("Base Rate", "a", 55), row("Base Rate", "a", -55)];
    expect(foldRoomNights(rows)).toEqual({ transient: 0, lease: 0, comp: 1 });
  });

  it("gives lease precedence on a room-night whose plan changed mid-stay", () => {
    const rows = [row("Discounted Weekly Rate", "a", 49), row("Monthly Lease", "a", 32)];
    expect(foldRoomNights(rows)).toEqual({ transient: 0, lease: 1, comp: 0 });
  });

  it("degrades to per-plan grouping when the room identifier is blank", () => {
    // Never collapse a whole day into one night just because the identifier
    // column came back empty.
    const rows = [row("Base Rate", "", 55), row("Monthly Lease", "", 32)];
    expect(foldRoomNights(rows)).toEqual({ transient: 1, lease: 1, comp: 0 });
  });

  it("returns zeros for a day with no room-rate transactions", () => {
    expect(foldRoomNights([])).toEqual({ transient: 0, lease: 0, comp: 0 });
  });
});
