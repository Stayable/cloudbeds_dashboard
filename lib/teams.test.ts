import { describe, it, expect, vi, afterEach } from "vitest";
import { attachmentsEnabled, postAdaptiveCard } from "./teams";

// The body SHAPE is the contract with the Power Automate flow: the live flow
// feeds triggerBody() straight into its "post card" step, so sending the
// wrapped { card, files } shape before the flow is edited would break the daily
// post outright. TEAMS_FLOW_ATTACHMENTS is the gate that keeps the code deploy
// and the flow edit independent — these tests pin it.

const CARD = { type: "AdaptiveCard" };
const FILES = [{ name: "Occupancy Report as of July 27, 2026.pdf", contentBase64: "AAA=" }];

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.TEAMS_FLOW_URL;
  delete process.env.TEAMS_FLOW_ATTACHMENTS;
});

const mockFetch = () =>
  vi.spyOn(global, "fetch").mockResolvedValue(new Response(null, { status: 202 }));

describe("postAdaptiveCard", () => {
  it("POSTs utf-8 JSON and treats 202 as ok", async () => {
    process.env.TEAMS_FLOW_URL = "https://flow.example/x";
    const f = mockFetch();
    const r = await postAdaptiveCard(CARD);
    expect(r).toEqual({ ok: true, status: 202, attached: 0 });
    const init: any = f.mock.calls[0][1];
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json; charset=utf-8");
    expect(init.body).toBe(JSON.stringify(CARD));
  });

  it("returns {ok:false,status:0} when TEAMS_FLOW_URL unset", async () => {
    expect(await postAdaptiveCard({})).toEqual({ ok: false, status: 0, attached: 0 });
  });

  it("non-2xx is not ok", async () => {
    process.env.TEAMS_FLOW_URL = "https://flow.example/x";
    vi.spyOn(global, "fetch").mockResolvedValue(new Response(null, { status: 400 }));
    expect((await postAdaptiveCard({})).ok).toBe(false);
  });

  it("keeps the bare-card shape when attachments are off, even with files supplied", async () => {
    process.env.TEAMS_FLOW_URL = "https://flow.example/x";
    const f = mockFetch();
    const r = await postAdaptiveCard(CARD, FILES);
    expect(JSON.parse((f.mock.calls[0][1] as any).body)).toEqual(CARD);
    expect(r.attached).toBe(0);
  });

  it("wraps into { card, files } once TEAMS_FLOW_ATTACHMENTS=1", async () => {
    process.env.TEAMS_FLOW_URL = "https://flow.example/x";
    process.env.TEAMS_FLOW_ATTACHMENTS = "1";
    const f = mockFetch();
    const r = await postAdaptiveCard(CARD, FILES);
    expect(JSON.parse((f.mock.calls[0][1] as any).body)).toEqual({ card: CARD, files: FILES });
    expect(r.attached).toBe(1);
  });

  it("stays on the bare-card shape when enabled but there is nothing to attach", async () => {
    process.env.TEAMS_FLOW_URL = "https://flow.example/x";
    process.env.TEAMS_FLOW_ATTACHMENTS = "1";
    const f = mockFetch();
    await postAdaptiveCard(CARD, []);
    expect(JSON.parse((f.mock.calls[0][1] as any).body)).toEqual(CARD);
  });

  it('treats any value other than "1" as off', async () => {
    process.env.TEAMS_FLOW_ATTACHMENTS = "true";
    expect(attachmentsEnabled()).toBe(false);
  });
});
