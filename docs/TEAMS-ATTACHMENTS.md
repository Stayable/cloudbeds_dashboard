# Daily revenue report → Teams, with file attachments

How the daily Occupancy/Revenue post reaches Teams, and the exact sequence for
turning attachments on. Written 07/29/26.

## What the code does

`app/api/cron/revenue-report/route.ts` (Vercel Cron, 10:00 UTC) banks
yesterday's snapshot, builds the report, and POSTs to the Power Automate flow at
`TEAMS_FLOW_URL`.

The POST body has **two shapes**, selected by `TEAMS_FLOW_ATTACHMENTS`:

| `TEAMS_FLOW_ATTACHMENTS` | Body posted | Notes |
|---|---|---|
| unset / anything but `1` | the Adaptive Card object, at the top level | The shape the live flow has consumed since 07/22/26. Unchanged. |
| `1` | `{ card: {...}, files: [{ name, contentBase64 }] }` | `files[0]` is the report **PDF** — the only attachment. |

**PDF only** (Kyle, 07/29/26). That is what Monica posts; the `Occ% Report…xlsx`
files in `Occupancy Report/` are her working model, not her post. Our `.xlsx`
stays reachable at `/report/latest.xlsx` and keeps its card button. `files` is a
list so adding a second file later needs no flow change.

The gate exists so the **code deploy and the flow edit are independent**.
Changing the body shape unconditionally would break the daily post the moment it
deployed, because the flow's "post card" step feeds `triggerBody()` straight
into the card. With the gate, nothing changes until the env var is set, and
unsetting it rolls back instantly with no redeploy.

When the PDF is attached, the card **drops its "Download PDF" button**: it points
at `/report/latest.pdf`, which `middleware.ts` gates behind the `MAIN` pin — a
login wall rather than a download for anyone in the chat without that pin — and
the real file is now in the channel. "View report" and "Download Excel" stay.

File names match Monica's convention exactly —
`Occupancy Report as of July 27, 2026.pdf` — so the channel's file history stays
continuous when this takes over from her manual post. The title date is the
**run** date, one day after the last day of data (`reportFileBase`, unit-tested).


## Flow edit (Kyle — Claude has no Power Automate access)

In the flow behind the Revenue chat's trigger URL:

1. **Add a step before the post**: SharePoint → **Create file**
   - *Site Address* / *Folder Path*: the Revenue channel's Files library
     (the channel's SharePoint document library, `General` or the channel folder).
   - *File Name*: `triggerBody()?['files'][0]['name']`
   - *File Content*: `base64ToBinary(triggerBody()?['files'][0]['contentBase64'])`
   - One file today (the PDF). To stay future-proof, wrap it in an `Apply to each`
     over `triggerBody()?['files']` using `items('Apply_to_each')?['name']` and
     `base64ToBinary(items('Apply_to_each')?['contentBase64'])` instead.
2. **Change the existing post step** to read the card from the wrapper:
   `triggerBody()?['card']` instead of `triggerBody()`.
3. Save.

> **Unverified:** whether this connector version exposes a native file-attachment
> field on "Post message in a chat or channel". If it does, that is simpler than
> Create file + link — check in the designer; connectors change, so don't take it
> from memory. Either way step 2 is required.

## Go-live sequence

The two switches are separate on purpose. Do them in this order:

1. **Deploy the code.** Nothing changes: `TEAMS_FLOW_ATTACHMENTS` is unset, so
   the body shape and the card are exactly what the flow gets today.
2. **Edit the flow** (above). Still nothing changes — the flow now reads
   `triggerBody()?['card']`, which is absent, so **the card breaks until step 3**.
   If that gap matters, keep the old post step and add a second one, or do 2 and
   3 back to back.
3. **Set `TEAMS_FLOW_ATTACHMENTS=1`** in Vercel (Production) and redeploy.
4. **Test against the TEST channel first.** `TEAMS_FLOW_URL` in Vercel Production
   still holds the **test**-channel flow. Run the cron manually
   (Vercel → Cron Jobs → Run on `revenue-report`) and confirm the response:
   `{"ok":true,"status":202,"attached":1,"attachmentNames":["Occupancy Report as of ….pdf"]}`
   and that the PDF lands in the test channel's Files tab.
5. **Only then** swap `TEAMS_FLOW_URL` to the Revenue-channel URL
   (`TEAMS_FLOW_URL_REVENUE` in `.env.local`). **That swap IS the go-live post** —
   the route has no dry-run flag, so the next 10:00 UTC run goes to the real
   chat. Tell Monica before, not after.

## Rollback

Unset `TEAMS_FLOW_ATTACHMENTS` (or set it to `0`). The next run posts the bare
card again. Reverting the flow's post step to `triggerBody()` completes the
rollback.

## Outstanding

- The Revenue-channel trigger URL was pasted in plaintext into a Claude Code
  transcript on 07/29/26. Anyone holding it can fire the flow. Regenerating it in
  Power Automate is cheap insurance.
- **Size, measured on a real 8-property render (2026-07-28 data): 580 KB PDF →
  773 KB base64.** An earlier ~72 KB estimate in this file was wrong — it came
  from a single-property export. Still comfortably inside the limits on the path
  (Vercel accepts 100 MB request bodies; Power Automate HTTP triggers accept
  ~100 MB), and hers are 150–620 KB, so this is the same order as her own files.
  Worth re-checking if the report ever grows a lot of pages.
