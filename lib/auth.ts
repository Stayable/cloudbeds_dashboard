// PIN-gate helpers. Shared by middleware (Edge) and the auth route (Node) — both
// have Web Crypto (crypto.subtle), so the same token function runs in either.
//
// Role-based: two levels, base (DASHBOARD_PIN) and exec (EXEC_PIN). The cookie
// stores a SHA-256 token of "stayable-dashboard:<level>:<pin>", so the two
// levels yield distinct tokens and rotating a PIN invalidates its sessions.
// No database (CLAUDE.md §6). Edge-safe: Web Crypto only, no Node APIs.

export const AUTH_COOKIE = "sd_auth";

export type Level = "base" | "exec" | "crystal" | "monica" | "bea";

// Per-user dashboard levels → the env var holding their PIN. Each unlocks only
// their own /<level> route (plus exec/CEO, who sees everything). Add a user here
// + an env var in Vercel to grant a new tailored dashboard.
export const USER_PINS: { level: Exclude<Level, "base" | "exec">; envVar: string }[] = [
  { level: "crystal", envVar: "CRYSTAL_PIN" },
  { level: "monica", envVar: "MONICA_PIN" },
  { level: "bea", envVar: "BEA_PIN" },
];

export async function tokenFor(level: Level, pin: string): Promise<string> {
  const data = new TextEncoder().encode(`stayable-dashboard:${level}:${pin}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Which level a path needs. /rob (the CEO's own view) => exec; each per-user
 *  route => its own level; everything else => base. */
export function requiredLevel(pathname: string): Level {
  const seg = pathname.split("/")[1] ?? "";
  if (seg === "rob") return "exec";
  const user = USER_PINS.find((u) => u.level === seg);
  if (user) return user.level;
  return "base";
}

export type ExpectedTokens = {
  base: string | null;
  exec: string | null;
  users: Partial<Record<Level, string>>; // per-user tokens, keyed by level
};

/**
 * Expected cookie tokens for each level, derived from env PINs.
 * - base: null when DASHBOARD_PIN is unset (gate disabled).
 * - exec: token of EXEC_PIN; falls back to the base token when EXEC_PIN is unset.
 * - users[level]: token of that user's PIN env var; falls back to the exec token
 *   when unset, so until the PIN is configured only exec/CEO reaches the route.
 */
export async function expectedTokens(): Promise<ExpectedTokens> {
  const basePin = process.env.DASHBOARD_PIN;
  const execPin = process.env.EXEC_PIN;
  if (!basePin) return { base: null, exec: null, users: {} };
  const base = await tokenFor("base", basePin);
  const exec = execPin ? await tokenFor("exec", execPin) : base;
  const users: Partial<Record<Level, string>> = {};
  for (const { level, envVar } of USER_PINS) {
    const pin = process.env[envVar];
    users[level] = pin ? await tokenFor(level, pin) : exec;
  }
  return { base, exec, users };
}

/** Sanitize a post-login redirect target to a same-site path. Rejects
 *  absolute and protocol-relative (//host) URLs; defaults to "/". */
export function safeNextPath(next: string | null | undefined): string {
  if (!next) return "/";
  // must be a path starting with a single "/", not "//" (protocol-relative)
  if (!next.startsWith("/") || next.startsWith("//")) return "/";
  return next;
}

/** Pure access decision. Middleware computes `expected` then calls this. */
export function decideAccess(
  pathname: string,
  cookieToken: string | undefined,
  expected: ExpectedTokens,
): "allow" | "deny" {
  if (expected.base === null) return "allow"; // gate disabled
  const need = requiredLevel(pathname);
  if (need === "exec") {
    return cookieToken && cookieToken === expected.exec ? "allow" : "deny";
  }
  if (need !== "base") {
    // A per-user route: that user's PIN OR exec/CEO unlocks it; base does not.
    const userToken = expected.users[need];
    return cookieToken && (cookieToken === userToken || cookieToken === expected.exec)
      ? "allow"
      : "deny";
  }
  // base route: base OR exec token unlocks it (CEO sees everything). Per-user
  // tokens are scoped to their own route and do NOT reach base.
  return cookieToken && (cookieToken === expected.base || cookieToken === expected.exec)
    ? "allow"
    : "deny";
}
