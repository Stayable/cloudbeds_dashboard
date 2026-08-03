# Diff Monica's circulated Occupancy Report against ours, metric by metric.
#
# Both sides render the same 10-page layout, so one parser reads both
# (scripts/parse-monica-pdf.py :: parse_report). Everything is compared
# positionally off the ACTUAL pages — no figure is typed by hand.
#
# Usage:
#   python scripts/diff-reports.py "<theirs.pdf>" "<ours.pdf>" [--all]
#
# Prints, per property x period, only the metrics that differ by more than the
# tolerance (--all shows every metric). Then a portfolio roll-up of the three
# figures the handoff turns on: room revenue, occupied room-nights, inventory
# room-days.
#
# Exit code is 0 always — this is a reading aid, not a gate. A material gap is
# a conversation with Monica, not a build failure.
import sys, os
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from importlib import import_module

parse_report = import_module("parse-monica-pdf").parse_report

PERIODS = ["Yesterday", "MTD", "YTD"]
ORDER = ["LL", "JN", "JW", "KE", "KW", "OR", "SA", "DP"]  # Monica's page order

# metric -> (label, kind). kind drives the tolerance and the formatting:
#   count    - whole rooms/room-nights; any difference is shown
#   money    - dollars; shown when it moves the period by >0.1% or >$25
#   pct      - a ratio 0..1; shown at >0.1pp
#   rate     - ADR/RevPAR dollars-per-room; shown at >$0.05
METRICS = [
    ("occupied", "Occupied", "count"),
    ("transientNights", "  Transient nights", "count"),
    ("leaseNights", "  Lease nights", "count"),
    ("otherBlocks", "Other blocks", "count"),
    ("ooo", "Out-of-Order", "count"),
    ("available", "Available", "count"),
    ("inventory", "Inventory", "count"),
    ("pOcc", "% Occupied", "pct"),
    ("roomRev", "Room Revenue", "money"),
    ("transientRev", "  Transient rev", "money"),
    ("leaseRev", "  Lease rev", "money"),
    ("adrCombined", "ADR Combined", "rate"),
    ("revpar", "RevPar", "rate"),
]


def material(kind, theirs, ours):
    d = ours - theirs
    if kind == "count":
        return abs(d) >= 1
    if kind == "pct":
        return abs(d) > 0.001
    if kind == "rate":
        return abs(d) > 0.05
    base = max(abs(theirs), 1.0)
    return abs(d) > 25 and abs(d) / base > 0.001


def fmt(kind, v):
    if v is None:
        return "—"
    if kind == "pct":
        return f"{v*100:.1f}%"
    if kind in ("money", "rate"):
        return f"${v:,.2f}"
    return f"{v:,.0f}"


def fmt_delta(kind, theirs, ours):
    d = ours - theirs
    pct = f"  ({d/theirs*100:+.2f}%)" if kind in ("money", "rate") and theirs else ""
    if kind == "pct":
        return f"{d*100:+.1f}pp"
    if kind in ("money", "rate"):
        return f"{d:+,.2f}{pct}"
    return f"{d:+,.0f}"


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    show_all = "--all" in sys.argv
    if len(args) != 2:
        raise SystemExit(__doc__ or "usage: diff-reports.py <theirs.pdf> <ours.pdf> [--all]")

    theirs, ours = (parse_report(Path(a)) for a in args)
    print(f"THEIRS  {Path(theirs['source']).name}   as of {theirs['asOf']}")
    print(f"OURS    {Path(ours['source']).name}   as of {ours['asOf']}")
    if theirs["asOf"] != ours["asOf"]:
        print("  !! DIFFERENT AS-OF DATES — these two files do not describe the same day.")
    print()

    roll = {p: {"roomRev": [0.0, 0.0], "occupied": [0.0, 0.0], "inventory": [0.0, 0.0]} for p in PERIODS}
    codes = [c for c in ORDER if c in theirs["properties"] or c in ours["properties"]]
    findings = 0

    for code in codes:
        t_all, o_all = theirs["properties"].get(code, {}), ours["properties"].get(code, {})
        if not t_all or not o_all:
            print(f"{code}: present in only one file — theirs={bool(t_all)} ours={bool(o_all)}\n")
            continue
        rows = []
        for period in PERIODS:
            t, o = t_all.get(period, {}), o_all.get(period, {})
            for key, label, kind in METRICS:
                tv, ov = t.get(key), o.get(key)
                if tv is None or ov is None:
                    continue
                if key in roll[period]:
                    roll[period][key][0] += tv
                    roll[period][key][1] += ov
                if show_all or material(kind, tv, ov):
                    rows.append((period, label, kind, tv, ov))
        if rows:
            findings += len(rows)
            print(code)
            for period, label, kind, tv, ov in rows:
                print(
                    f"  {period:<10} {label:<18} theirs {fmt(kind, tv):>14}"
                    f"   ours {fmt(kind, ov):>14}   {fmt_delta(kind, tv, ov)}"
                )
            print()

    print("PORTFOLIO")
    for period in PERIODS:
        for key, label, kind in (
            ("roomRev", "Room Revenue", "money"),
            ("occupied", "Occupied room-nights", "count"),
            ("inventory", "Inventory room-days", "count"),
        ):
            tv, ov = roll[period][key]
            pct = f"{(ov-tv)/tv*100:+.2f}%" if tv else "n/a"
            print(f"  {period:<10} {label:<22} theirs {fmt(kind, tv):>16}   ours {fmt(kind, ov):>16}   {pct:>8}")
    print()
    print(f"{findings} property-level differences above tolerance." if not show_all else "")


if __name__ == "__main__":
    main()
