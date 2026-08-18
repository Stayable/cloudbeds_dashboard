import { NextResponse } from "next/server";
import { DUE_OUT_ET_HOUR, easternMinutesNow, easternToday, isValidYmd } from "@/lib/dates";
import { PROPERTIES } from "@/config/properties";
import { readKey } from "@/lib/cloudbeds";
import { buildDueOutCard, getDueOutDetail, getPortfolioDueOuts } from "@/lib/due-outs";
import { buildDdfRows, ddfSheetName, DDF_HEADERS, type DdfSourceRow } from "@/lib/ddf-sheet";
import { dueOutFileName, renderDueOutXlsx } from "@/lib/due-out-xlsx";
import { postAdaptiveCard } from "@/lib/teams";

/** The `ddf` payload block: the sheet to create and the rows to seed it with.
 *
 *  Reads each property a SECOND time (arrival dates are a separate dataset-3
 *  query) rather than reusing the walk-list read. That is deliberate: the walk
 *  list is per-room and this is per-reservation, and folding one into the other
 *  would put one meaning behind two derivations — the failure pattern this repo
 *  has already been bitten by three times. */
async function buildDdfSeed(day: string) {
  const sources: DdfSourceRow[] = await Promise.all(
    PROPERTIES.map(async (property) => {
      const key = readKey(property.code);
      if (!key || !property.apiPropertyId) return { property, reservations: null };
      const res = await getDueOutDetail(key, property.apiPropertyId, day);
      return { property, reservations: res.ok ? res.data : null };
    }),
  );
  return {
    sheetName: ddfSheetName(day),
    headers: [...DDF_HEADERS],
    // Guest names stay off until that decision is made (CLAUDE.md §5 rule 2).
    rows: buildDdfRows(day, sources, { includeGuestNames: process.env.DDF_INCLUDE_GUEST_NAMES === "1" }),
  };
}

/** "YYYY-MM-DD, HH:MM" in EASTERN — stamped on the workbook so a reader can see
 *  how fresh the walk list is. Eastern, never the server clock: Vercel runs UTC,
 *  which is a day ahead of Eastern every evening. */
function easternStamp(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date());
}

// Daily Due-Out Room Walk List (Vercel Cron; see vercel.json). Reads which
// rooms are scheduled to check out TODAY and posts them to the "Daily Due Out
// or Departures" Power Automate flow so PMs/PAs can schedule inspections.
//
// PII-FREE — room numbers and counts only (CLAUDE.md §5 rule 2). See the header
// of lib/due-outs.ts for why balances are excluded even though the same query
// returns them.
//
// TODAY, not yesterday. Unlike every other cron in this directory, this one is
// forward-looking: it reports the day in progress, because a walk list for
// yesterday is useless. That also means it must NOT be back-filled — a missed
// morning is genuinely missed, and posting it at noon would send PMs to rooms
// whose guests have already gone.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }

  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1";
  const test = url.searchParams.get("test") === "1";

  // DST WINDOW GUARD, same shape as capture-daily's and mirrored on purpose.
  // Vercel Cron schedules are fixed UTC, so a single entry drifts an hour
  // against Eastern twice a year. Two entries are scheduled an hour apart
  // (vercel.json) and this admits exactly one:
  //     13:00 UTC = 09:00 EDT (runs, summer) / 08:00 EST (skipped)
  //     14:00 UTC = 10:00 EDT (skipped)      / 09:00 EST (runs, winter)
  // The window is [9:00, 10:00) ET — 60 minutes wide, and the two entries are
  // 60 minutes apart, so exactly one lands inside it in either season.
  const minutes = easternMinutesNow();
  const inWindow = minutes >= DUE_OUT_ET_HOUR * 60 && minutes < (DUE_OUT_ET_HOUR + 1) * 60;
  if (!inWindow && !force) {
    // 200, not an error: skipping IS the correct outcome for the off-DST twin.
    // Labelled explicitly so it can never be read as a delivered list — that
    // ambiguity is what hid the unset-TEAMS_FLOW_URL bug for two weeks.
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: `outside the ${DUE_OUT_ET_HOUR}:00-${DUE_OUT_ET_HOUR + 1}:00 ET delivery window (now ${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")} ET)`,
    });
  }

  // `?day=` is for testing a specific stay date. It does NOT bypass anything
  // else; the default is today in EASTERN time, never the server's UTC date,
  // which is a day ahead every evening.
  const dayParam = url.searchParams.get("day");
  if (dayParam !== null && !isValidYmd(dayParam)) {
    return NextResponse.json({ ok: false, error: "day must be a real YYYY-MM-DD date" }, { status: 400 });
  }
  const day = dayParam ?? easternToday();

  try {
    const rows = await getPortfolioDueOuts(day);
    const failed = rows.filter((r) => r.rooms === null);

    // REFUSE TO POST AN ALL-FAILURE LIST. Eight "unavailable" rows are worse
    // than silence: they train the reader to ignore the 9am post, and the one
    // morning it matters it will be skimmed past. A cron failure is louder and
    // more honest than a card full of dashes. (Learned on 08/14/26, when a
    // malformed query sent exactly that card to the live flow.)
    if (failed.length === rows.length) {
      return NextResponse.json(
        { ok: false, day, error: "every property read failed — nothing posted", properties: rows.length },
        { status: 502 },
      );
    }

    // XLSX ATTACHMENT, GATED SEPARATELY FROM THE REVENUE REPORT'S GATE.
    // The flow currently consumes a bare Adaptive Card at the top level
    // (confirmed received 08/14/26). Sending `{card, files}` before the flow is
    // edited to read `triggerBody()?['card']` would break the post the moment
    // this deploys — so the code deploy and the flow edit stay independent, the
    // same discipline docs/TEAMS-ATTACHMENTS.md established for the revenue
    // flow. Flip DUEOUT_ATTACH_XLSX=1 only AFTER the flow edit; unset it to roll
    // back with no redeploy.
    const attach = process.env.DUEOUT_ATTACH_XLSX === "1";
    const files = attach
      ? [
          {
            name: dueOutFileName(day),
            contentBase64: (
              await renderDueOutXlsx(day, rows, easternStamp())
            ).toString("base64"),
          },
        ]
      : [];

    // DDF SEED BLOCK, gated independently again. When on, the flow's Excel
    // Online steps create the `MM.DD` sheet in DDF Refund <year>.xlsx and write
    // these rows. It is a SEED: the team edits those rows in place all day, so
    // the flow must ADD a sheet and never touch an existing one — if `08.15`
    // already exists the flow should skip, not overwrite. Their edits cannot be
    // reconstructed.
    const seed = process.env.DDF_SEED_ENABLED === "1" ? await buildDdfSeed(day) : null;

    const card = buildDueOutCard(day, rows, { test, workbookUrl: process.env.DDF_WORKBOOK_URL });
    const post = await postAdaptiveCard(card, files, {
      envVar: "TEAMS_FLOW_URL_DUEOUT",
      attach,
      ...(seed ? { extra: { ddf: seed } } : {}),
    });

    const totalRooms = rows.reduce((n, r) => n + (r.rooms?.length ?? 0), 0);
    return NextResponse.json(
      {
        ok: post.ok,
        day,
        totalRooms,
        posted: post.ok,
        attached: post.attached,
        ...(post.attached ? { attachmentName: dueOutFileName(day) } : {}),
        // Named, not swallowed: a partial read still posts, but the caller and
        // the card both say which properties are missing.
        unavailable: failed.map((r) => r.property.id),
        ...(post.ok ? {} : { postError: post.reason, detail: post.detail }),
      },
      // Fail the invocation so Vercel marks the cron run failed rather than
      // reporting a cheerful 200 having delivered nothing.
      { status: post.ok ? 200 : 502 },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, day, error: message }, { status: 500 });
  }
}
