// Teams delivery for the daily report, via a Power Automate HTTP-trigger flow.
//
// TWO BODY SHAPES, chosen by env var, because the flow and this code deploy
// independently:
//
//   TEAMS_FLOW_ATTACHMENTS unset/"0"  ->  POST the Adaptive Card at the top
//       level (the shape the live flow has consumed since 2026-07-22; its
//       "post card" step feeds triggerBody() straight into the card).
//   TEAMS_FLOW_ATTACHMENTS="1"        ->  POST { card, files: [...] }, so the
//       flow can save each file into the channel's SharePoint library
//       (base64ToBinary(...)) and then post the card. In practice `files` holds
//       exactly one entry, the report PDF (Kyle, 07/29/26 — that is what Monica
//       posts), but the shape is a list so a second file needs no flow change.
//       Measured payload: ~580 KB PDF -> ~773 KB base64.
//
// The gate exists because changing the body shape unconditionally would break
// the live daily post the moment this deploys, before the flow is edited. With
// the gate, the flow edit and the env-var flip are one reversible step and the
// old shape keeps working until then.
export type TeamsAttachment = {
  /** File name as it should appear in the channel, e.g.
   *  "Occupancy Report as of July 27, 2026.pdf". */
  name: string;
  /** File bytes, base64. Power Automate turns this back into a file with
   *  base64ToBinary(). */
  contentBase64: string;
};

export function attachmentsEnabled(): boolean {
  return process.env.TEAMS_FLOW_ATTACHMENTS === "1";
}

/** Why a post did not land. `unconfigured` is the one that bit us: TEAMS_FLOW_URL
 *  was never set in Vercel, so every production run since 2026-07-22 returned a
 *  cheerful 200 having delivered nothing. The three cases need different fixes
 *  — set an env var, retry, or fix the flow — so they are distinguished here
 *  rather than collapsed into ok:false. */
export type TeamsFailure = "unconfigured" | "network" | "http";

export type TeamsPostResult = {
  ok: boolean;
  status: number;
  attached: number;
  reason?: TeamsFailure;
  detail?: string;
};

/**
 * POST the daily card (and, when enabled, its file attachments) to the flow.
 * Never throws — a Teams outage must not fail the cron that also banks
 * snapshots, and the caller decides how loud to be about `reason`.
 */
export type TeamsPostOptions = {
  /** Which flow to post to. Defaults to the daily revenue report's flow
   *  (`TEAMS_FLOW_URL`). Pass another env var NAME — not a URL — to target a
   *  different flow, e.g. `TEAMS_FLOW_URL_DUEOUT` for the "Daily Due Out or
   *  Departures" flow. The name rather than the value is passed so the
   *  `unconfigured` detail can say which variable is missing, which is the
   *  whole reason that failure mode is distinguishable at all: an unset
   *  TEAMS_FLOW_URL returned a cheerful 200 and delivered nothing for two
   *  weeks. */
  envVar?: string;
  /** Whether to POST the wrapper object instead of the bare card. Defaults to
   *  the GLOBAL `TEAMS_FLOW_ATTACHMENTS` gate, which is correct for the revenue
   *  flow it was written for.
   *
   *  Pass it EXPLICITLY when targeting any other flow. The global env var is one
   *  switch for what are now several independent Power Automate flows, each of
   *  which is edited on its own schedule — leaving them coupled means turning
   *  attachments on for the revenue report would silently change the body shape
   *  the due-out flow receives and break it. One meaning, two flows: the exact
   *  failure pattern recorded in MEMORY.md. */
  attach?: boolean;
  /** Extra top-level keys merged into the wrapper, e.g. the due-out flow's
   *  `ddf` block (sheet name + headers + rows) that its Excel Online steps
   *  consume. Supplying this FORCES the wrapper shape — a bare card has nowhere
   *  to put them, and silently dropping them would look like the flow was
   *  misconfigured rather than like we never sent the data. */
  extra?: Record<string, unknown>;
};

export async function postAdaptiveCard(
  card: object,
  files: TeamsAttachment[] = [],
  opts: TeamsPostOptions = {}
): Promise<TeamsPostResult> {
  const envVar = opts.envVar ?? "TEAMS_FLOW_URL";
  const attach = opts.attach ?? attachmentsEnabled();
  const url = process.env[envVar];
  if (!url) {
    return {
      ok: false,
      status: 0,
      attached: 0,
      reason: "unconfigured",
      detail: `${envVar} is not set in this environment — nothing was sent.`,
    };
  }

  const attaching = attach && files.length > 0;
  const hasExtra = opts.extra !== undefined && Object.keys(opts.extra).length > 0;
  const body = attaching || hasExtra ? { card, ...(attaching ? { files } : {}), ...opts.extra } : card;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    // The old code let this propagate despite the "never throws" comment.
    return { ok: false, status: 0, attached: 0, reason: "network", detail: String(e) };
  }

  const ok = res.status === 202 || res.ok;
  return {
    ok,
    status: res.status,
    attached: attaching ? files.length : 0,
    ...(ok ? {} : { reason: "http" as const, detail: `flow returned HTTP ${res.status}` }),
  };
}
