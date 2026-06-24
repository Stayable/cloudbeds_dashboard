// PIN-gate helpers. Shared by middleware (Edge) and the auth route (Node) — both
// have Web Crypto (crypto.subtle), so the same token function runs in either.
//
// Role-based: two levels, base (DASHBOARD_PIN) and exec (EXEC_PIN). The cookie
// stores a SHA-256 token of "stayable-dashboard:<level>:<pin>", so the two
// levels yield distinct tokens and rotating a PIN invalidates its sessions.
// No database (CLAUDE.md §6). Edge-safe: Web Crypto only, no Node APIs.

export const AUTH_COOKIE = "sd_auth";

export type Level = "base" | "exec";

export async function tokenFor(level: Level, pin: string): Promise<string> {
  const data = new TextEncoder().encode(`stayable-dashboard:${level}:${pin}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Which level a path needs. /exec(/...) => exec; everything else => base. */
export function requiredLevel(pathname: string): Level {
  return pathname === "/exec" || pathname.startsWith("/exec/") ? "exec" : "base";
}

/**
 * Expected cookie tokens for each level, derived from env PINs.
 * - base: null when DASHBOARD_PIN is unset (gate disabled).
 * - exec: token of EXEC_PIN; falls back to the base token when EXEC_PIN is
 *   unset, so /exec never locks itself out (mirrors the old !pin guard).
 */
export async function expectedTokens(): Promise<{ base: string | null; exec: string | null }> {
  const basePin = process.env.DASHBOARD_PIN;
  const execPin = process.env.EXEC_PIN;
  if (!basePin) return { base: null, exec: null };
  const base = await tokenFor("base", basePin);
  const exec = execPin ? await tokenFor("exec", execPin) : base;
  return { base, exec };
}

/** Pure access decision. Middleware computes `expected` then calls this. */
export function decideAccess(
  pathname: string,
  cookieToken: string | undefined,
  expected: { base: string | null; exec: string | null },
): "allow" | "deny" {
  if (expected.base === null) return "allow"; // gate disabled
  const need = requiredLevel(pathname);
  if (need === "exec") {
    return cookieToken && cookieToken === expected.exec ? "allow" : "deny";
  }
  // base route: base OR exec token unlocks it (CEO sees everything)
  return cookieToken && (cookieToken === expected.base || cookieToken === expected.exec)
    ? "allow"
    : "deny";
}
