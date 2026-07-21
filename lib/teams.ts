export async function postAdaptiveCard(card: object): Promise<{ ok: boolean; status: number }> {
  const url = process.env.TEAMS_FLOW_URL;
  if (!url) return { ok: false, status: 0 };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(card),
  });
  return { ok: res.status === 202 || res.ok, status: res.status };
}
