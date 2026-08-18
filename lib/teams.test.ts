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

  it("reports `unconfigured` when TEAMS_FLOW_URL unset", async () => {
    // The real 07/22-08/03 outage: set in .env.local, never in Vercel. The
    // reason has to be distinguishable from a flow error — the fix is different.
    const r = await postAdaptiveCard({});
    expect(r.ok).toBe(false);
    expect(r.status).toBe(0);
    expect(r.reason).toBe("unconfigured");
    expect(r.detail).toMatch(/TEAMS_FLOW_URL/);
  });

  it("non-2xx is not ok and reports `http`", async () => {
    process.env.TEAMS_FLOW_URL = "https://flow.example/x";
    vi.spyOn(global, "fetch").mockResolvedValue(new Response(null, { status: 400 }));
    const r = await postAdaptiveCard({});
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("http");
    expect(r.detail).toContain("400");
  });

  it("does not throw when the flow is unreachable, and reports `network`", async () => {
    process.env.TEAMS_FLOW_URL = "https://flow.example/x";
    vi.spyOn(global, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));
    const r = await postAdaptiveCard({});
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("network");
    expect(r.detail).toContain("ECONNREFUSED");
  });

  it("carries no failure reason on success", async () => {
    process.env.TEAMS_FLOW_URL = "https://flow.example/x";
    mockFetch();
    const r = await postAdaptiveCard(CARD);
    expect(r.ok).toBe(true);
    expect(r.reason).toBeUndefined();
  });

  it("forces the wrapper shape when `extra` is supplied, even with attachments off", async () => {
    // The due-out flow's `ddf` seed block travels this way. A bare card has
    // nowhere to put it, so dropping it silently would look to the flow author
    // like a misconfigured flow rather than like we never sent the data.
    process.env.TEAMS_FLOW_URL = "https://flow.example/x";
    const f = mockFetch();
    const ddf = { sheetName: "08.15", headers: ["Property"], rows: [["DP"]] };
    await postAdaptiveCard(CARD, [], { extra: { ddf } });
    const body = JSON.parse((f.mock.calls[0][1] as any).body);
    expect(body.card).toEqual(CARD);
    expect(body.ddf).toEqual(ddf);
    expect(body.files).toBeUndefined(); // attachments still off
  });

  it("ignores an empty `extra` and stays a bare card", async () => {
    process.env.TEAMS_FLOW_URL = "https://flow.example/x";
    const f = mockFetch();
    await postAdaptiveCard(CARD, [], { extra: {} });
    expect(JSON.parse((f.mock.calls[0][1] as any).body)).toEqual(CARD);
  });

  it("names the missing variable when targeting a different flow", async () => {
    delete process.env.TEAMS_FLOW_URL_DUEOUT;
    const r = await postAdaptiveCard(CARD, [], { envVar: "TEAMS_FLOW_URL_DUEOUT" });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("unconfigured");
    expect(r.detail).toMatch(/TEAMS_FLOW_URL_DUEOUT/);
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
