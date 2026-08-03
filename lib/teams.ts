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
export async function postAdaptiveCard(
  card: object,
  files: TeamsAttachment[] = []
): Promise<TeamsPostResult> {
  const url = process.env.TEAMS_FLOW_URL;
  if (!url) {
    return {
      ok: false,
      status: 0,
      attached: 0,
      reason: "unconfigured",
      detail: "TEAMS_FLOW_URL is not set in this environment — nothing was sent.",
    };
  }

  const attach = attachmentsEnabled() && files.length > 0;
  const body = attach ? { card, files } : card;

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
    attached: attach ? files.length : 0,
    ...(ok ? {} : { reason: "http" as const, detail: `flow returned HTTP ${res.status}` }),
  };
}
