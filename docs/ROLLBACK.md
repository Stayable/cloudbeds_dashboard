# Rollback runbook — 07/28/26 redesign + accuracy release

Two commits shipped together on `claude/nifty-thompson-ts8zny`:

| SHA | What |
|---|---|
| `69866b7` | `style:` design system applied across every surface |
| `1439142` | `fix(report):` occupancy / nights / inventory / restatement corrections |

Last known-good commit before both: **`4e1eb0b`**, also tagged
**`pre-redesign-072826`**.

---

## Fastest fix if production looks wrong (seconds, no git)

**Vercel → Deployments → Instant Rollback** on the last good deployment (or
*Promote to Production*). This re-serves an already-built deployment and does not
touch the repository, so it works no matter what the code dependencies are. Do
this first; sort the git history out afterwards.

Note this branch (`claude/nifty-thompson-ts8zny`) deploys straight to the
**production** target and carries `dashboard.rentstayable.com` — a push here is a
production release.

| | Deployment | Commit |
|---|---|---|
| **Current (token report download, 08/04/26)** | `dpl_BH68fdrYkALbqMLyp5MsBsDjFwEb` | `5c17349` |
| **Roll back one step** (429 retry + OOO repair, 08/04/26) | `dpl_EWEmjuJP5LguBVKCJf6xxy2g4kNq` | `2c03b90` |
| **Roll back two steps** (Rob header links, 08/02/26) | `dpl_HEh5Gb2Yjxjqa9hdAXpsxZ8mF7C1` | `97515f0` |
| **Roll back three steps** (session-6 close, 07/30/26) | `dpl_AWt9zKVFGF1QY1QAKmxNGtgrvWB4` | `3d29785` |
| **Roll back to pre-redesign** | `dpl_92vmRYYZhidi6xdQ9fkg79L28sYa` | `4e1eb0b` |

One step back is the right target for a problem with the current release.
`5c17349` adds `/api/report-file` and points the Teams card's file buttons at
it; rolling back returns those buttons to the pin-gated `/report/latest.*`,
which is a worse experience but not a broken one. **Any already-posted card
keeps its tokenised links, and after a rollback those links 404** — so if a
live card is in the Revenue chat, prefer fixing forward.

`2c03b90`'s only behavioural change is that `cbGet` retries HTTP 429/5xx up to
3 times. Its worst case is a slower cron, not a wrong figure — so if production
looks wrong, that release is probably not the cause. Going all the way to
`4e1eb0b` also unwinds the redesign.

**A rollback does not undo the data repair.** `2c03b90` also raised three
banked out-of-order figures (KE/LL/SA 2026-07-20) via
`scripts/repair-zero-ooo.mts`. Those are Neon rows, not code — reverting the
deployment leaves them corrected, which is the safe combination. `observeBlocks`
is raise-only, so nothing can put the zeros back short of a manual `update`.

Rollback target inspectors:
- one step — https://vercel.com/stayable-admins-projects/cloudbeds-dashboard/EWEmjuJP5LguBVKCJf6xxy2g4kNq
- two steps — https://vercel.com/stayable-admins-projects/cloudbeds-dashboard/HEh5Gb2Yjxjqa9hdAXpsxZ8mF7C1
- three steps — https://vercel.com/stayable-admins-projects/cloudbeds-dashboard/AWt9zKVFGF1QY1QAKmxNGtgrvWB4
- pre-redesign — https://vercel.com/stayable-admins-projects/cloudbeds-dashboard/92vmRYYZhidi6xdQ9fkg79L28sYa

---

## Durable git rollback

### The two commits CANNOT be reverted independently

`components/RevenueReportView.tsx` lives in the accuracy commit but imports 19
primitives (`Card`, `Kpi`, `FreshnessStrip`, `TableScroll`, …) from
`components/ui.tsx`, which the **redesign** commit creates. Reverting only
`69866b7` deletes `ui.tsx` and the build fails on a missing module.

So the revert unit is **both commits**:

```
git revert --no-edit 1439142 69866b7
git push
```

That returns the code to `4e1eb0b` while keeping the history forward-only (no
force-push, nothing lost). To inspect before committing to it:

```
git revert --no-commit 1439142 69866b7
```

### Reverting the code does NOT undo the data repairs

The 07/28/26 corrections to `report_daily_snapshot` (phantom inventory cleared,
per-day inventory re-seeded from Monica's workbook, Jacksonville North
out-of-order raised to 107/day, months finalized) live in **Neon**, not in git. A
revert leaves them in place.

That combination is safe and is exactly the state production was in between the
data repair and this deploy: **old code reading corrected data.** The new
`report_daily_snapshot` columns (`comp_nights`, `blocks_by_type`, `ooo_source`,
`is_final`, `flash_room_rev`, `first_captured_at`, `restated_at`,
`finalized_at`) are additive with behaviour-preserving defaults, and the old code
selects columns explicitly, so it ignores them.

What a code revert DOES give back, undesirably:
- room-nights revert to the dataset-3 in-house count, so today's transient
  nights undercount again (Davenport read 7 vs 18 on 7/26);
- the Jacksonville North out-of-order override stops applying to the live
  "today" row, so JN shows ~89 rooms available again for the current day only
  (banked history stays correct);
- the nightly restatement stops, so recent days freeze at their 06:00 capture.

None of that corrupts stored data. It just stops improving it.

### If the data itself needs reversing

There is no automatic undo. The repairs were made by three idempotent scripts
whose dry-run output documents exactly what changed:

```
node scripts/fix-out-of-service-inventory.mjs      # 486 rows, inventory -> 0
node scripts/backfill-inventory-from-monica.mjs <counts.json>   # 873 rows re-seeded
node scripts/apply-ooo-overrides.mjs               # 122 JN rows, ooo -> 107
```

Re-run any of them without `--apply` to see current state. To restore a value,
re-seed from Monica's workbook (the point-in-time source) rather than guessing.

---

## Cron routes added

`/api/cron/restate` runs 11:30 UTC daily (`vercel.json`). To stop restatement
without a code change, remove that entry from `vercel.json` and redeploy; to stop
it immediately, disable the cron in the Vercel dashboard. Finalized rows
(`is_final = true`) are never touched by it in any case.
