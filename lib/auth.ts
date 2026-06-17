// PIN-gate helpers. Shared by middleware (Edge) and the auth route (Node) — both
// have Web Crypto (crypto.subtle), so the same token function runs in either.
//
// The cookie never stores the raw PIN; it stores a SHA-256 token derived from
// it. Middleware recomputes the expected token from DASHBOARD_PIN and compares,
// so rotating the PIN invalidates existing sessions. No database (CLAUDE.md §6).

export const AUTH_COOKIE = "sd_auth";

export async function pinToken(pin: string): Promise<string> {
  const data = new TextEncoder().encode(`stayable-dashboard:${pin}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
