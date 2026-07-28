# Parse the circulated "Occupancy Report as of <date>.pdf" into JSON, so a
# reconciliation can be run against it without hand-typing figures.
#
# WHY a parser rather than transcription: the report carries 8 properties x 3
# periods x ~17 metrics x (actual / last-year / variance) — roughly 1,200 numbers
# per PDF. Anything typed by hand becomes the least trustworthy input in the
# comparison.
#
# Two layout traps, both handled:
#   1. The trailing property-name labels are NOT in block order — page 1 lists
#      "Jacksonville North" then "Lakeland" while the blocks run Lakeland then JN.
#      Blocks are therefore identified by their Inventory value, which is unique
#      per property, not by label position.
#   2. Numbers run together when a label abuts its first value ("Transient12 47"),
#      and "% Occupied Adjusted (less 20 rms)" contains a literal 20 that must not
#      be read as data. Both are avoided by stripping the known label prefix
#      before tokenising.
#
# Usage: python scripts/parse-monica-pdf.py "<report.pdf>" [out.json]
import sys, re, json, datetime

import pypdf

PDF = sys.argv[1]
OUT = sys.argv[2] if len(sys.argv) > 2 else "monica-figures.json"

NAMES = {
    "Stayable Lakeland", "Stayable Jacksonville North", "Stayable Jacksonville West",
    "Stayable Kissimmee East", "Stayable Kissimmee West", "Stayable Orlando",
    "Stayable St. Augustine", "Stayable Davenport",
}

# Metric rows in the fixed order they appear inside a block. Two rows are labelled
# "Transient" and two "Lease" (nights, then revenue) — order disambiguates them,
# which is why this is a sequence and not a lookup.
ROWS = [
    ("occupied", "Occupied"), ("transientNights", "Transient"), ("leaseNights", "Lease"),
    ("otherBlocks", "Other blocks"), ("ooo", "Out-of-Order"), ("available", "Available"),
    ("inventory", "Inventory"), ("pOcc", "% Occupied"), ("pOoo", "% Out-of-Order"),
    ("pAvail", "% Available"), ("occAdj", "% Occupied Adjusted (less 20 rms)"),
    ("roomRev", "Room Revenue"), ("transientRev", "Transient"), ("leaseRev", "Lease"),
    ("adrCombined", "ADR Combined"), ("adrTransient", "ADR Transient"),
    ("adrLease", "ADR Lease"), ("revpar", "RevPar"),
]

# Inventory value -> property code. Unique per property; 167/168 both map to
# Kissimmee East because the two systems disagree by one room (open item).
INV2CODE = {157: "LL", 127: "JN", 133: "JW", 167: "KE", 168: "KE",
            160: "KW", 135: "OR", 140: "SA", 153: "DP", 151: "DP"}

PERIODS = ["Yesterday", "MTD", "YTD"]


def nums(s):
    """Tokenise a metric line's values. Handles $, thousands separators, percent,
    (1,234) negatives and #DIV/0! (-> None)."""
    out = []
    for t in re.findall(r"#DIV/0!|\(?-?\$?-?[\d,]+\.?\d*\)?%?", s):
        if t == "#DIV/0!":
            out.append(None)
            continue
        neg = t.startswith("(") and t.endswith(")")
        v = t.strip("()").replace("$", "").replace(",", "")
        pct = v.endswith("%")
        v = v.rstrip("%")
        if v in ("", "-", "."):
            continue
        try:
            n = float(v)
        except ValueError:
            continue
        if neg:
            n = -n
        if pct:
            n /= 100.0
        out.append(n)
    return out


reader = pypdf.PdfReader(PDF)
lines = []
for page in reader.pages:
    lines += [l.rstrip() for l in (page.extract_text() or "").split("\n")]

blocks = []
cur = None
for l in lines:
    if l.startswith("History "):
        if cur:
            blocks.append(cur)
        cur = {"kind": "actual", "header": l, "lines": []}
    elif l.startswith("On-the-books "):
        if cur:
            blocks.append(cur)
        cur = {"kind": "otb", "header": l, "lines": []}
    elif l.strip() in NAMES or cur is None:
        continue
    else:
        cur["lines"].append(l)
if cur:
    blocks.append(cur)

actual = [b for b in blocks if b["kind"] == "actual"]
if not actual:
    sys.exit("No ACTUAL blocks found — the PDF layout may have changed.")

m = re.search(r"History\s+(\d{1,2})-([A-Za-z]{3})-(\d{2})", actual[0]["header"])
as_of = datetime.datetime.strptime(f"{m.group(1)}-{m.group(2)}-20{m.group(3)}", "%d-%b-%Y").date().isoformat()

properties = {}
for b in actual:
    vals, i = {}, 0
    for key, label in ROWS:
        found = None
        for j in range(i, len(b["lines"])):
            if b["lines"][j].startswith(label):
                found = j
                break
        if found is None:
            continue
        vals[key] = nums(b["lines"][found][len(label):])
        i = found + 1

    inv = (vals.get("inventory") or [None])[0]
    code = INV2CODE.get(int(inv)) if inv else None
    if not code:
        print(f"  !! unmapped block, inventory={inv}", file=sys.stderr)
        continue

    entry = properties.setdefault(code, {})
    for pi, period in enumerate(PERIODS):
        # Each metric line holds 9 values: 3 periods x (actual, last year, variance).
        entry[period] = {k: v[pi * 3] for k, v in vals.items() if len(v) > pi * 3}
        entry[period + " LY"] = {k: v[pi * 3 + 1] for k, v in vals.items() if len(v) > pi * 3 + 1}

with open(OUT, "w") as f:
    json.dump({"source": PDF, "asOf": as_of, "properties": properties}, f, indent=1)

print(f"Parsed {len(properties)} properties from {PDF} (as of {as_of}) -> {OUT}")
missing = [c for c in INV2CODE.values() if c not in properties]
if set(missing) - set(properties):
    print(f"  properties not found: {sorted(set(missing) - set(properties))}", file=sys.stderr)
