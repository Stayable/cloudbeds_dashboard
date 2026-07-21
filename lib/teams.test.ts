import { describe, it, expect, vi, afterEach } from "vitest";
import { postAdaptiveCard } from "./teams";

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.TEAMS_FLOW_URL;
});

describe("postAdaptiveCard", () => {
  it("POSTs utf-8 JSON and treats 202 as ok", async () => {
    process.env.TEAMS_FLOW_URL = "https://flow.example/x";
    const f = vi.spyOn(global, "fetch").mockResolvedValue(new Response(null, { status: 202 }));
    const r = await postAdaptiveCard({ type: "AdaptiveCard" });
    expect(r).toEqual({ ok: true, status: 202 });
    const init: any = f.mock.calls[0][1];
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json; charset=utf-8");
    expect(init.body).toBe(JSON.stringify({ type: "AdaptiveCard" }));
  });
  it("returns {ok:false,status:0} when TEAMS_FLOW_URL unset", async () => {
    expect(await postAdaptiveCard({})).toEqual({ ok: false, status: 0 });
  });
  it("non-2xx is not ok", async () => {
    process.env.TEAMS_FLOW_URL = "https://flow.example/x";
    vi.spyOn(global, "fetch").mockResolvedValue(new Response(null, { status: 400 }));
    expect((await postAdaptiveCard({})).ok).toBe(false);
  });
});
