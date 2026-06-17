---
name: resume
description: Start-of-session catch-up for the Cloudbeds Dashboard. Reads TODO.md + recent git log and reports current phase, open items, and the next action. Keep output under 20 lines.
---

# Resume — Cloudbeds Dashboard

Run at the start of a session to re-establish context fast. Do NOT explore the
codebase broadly — read the two sources below and report.

## Steps

1. Read `TODO.md` (root). The blockquote at the top is the live "Pickup" marker —
   it names the next action. Note the current phase and any `[?]` decision items.
2. Read the last 5 commits: `git log --oneline -5`.
3. Check working tree state: `git status --short` and current branch
   (should be `claude/nifty-thompson-ts8zny` per CLAUDE.md §8).

## Report format (≤ 20 lines)

- **Phase**: current phase from TODO.md.
- **Next action**: the Pickup marker, verbatim or tightened.
- **Open decisions**: any `[?]` items still blocking (e.g. URL, key scoping,
  which 6 properties are active).
- **Uncommitted**: anything dirty in the working tree, or "clean".
- **Branch**: confirm on the dev branch; flag if not.

Then stop and wait for direction. Do not start coding from `/resume` alone.

## Notes

- Property IDs are mandatory on property-specific output (CLAUDE.md §3, §7).
  Pilot is Davenport (44199).
- Never commit secrets — `CLOUDBEDS_API_KEY` lives in `.env.local` / Vercel only.
