// Auth-gate helpers. Shared by middleware (Edge) and server routes (Node) — both
// have Web Crypto (crypto.subtle), so the same code runs in either.
//
// Scheme: PINs live in Neon (lib/pins.ts), checked ONLY at login. The cookie is a
// signed level token `"<level>.<hmac>"` (HMAC-SHA256 over the level with a server
// secret), so middleware verifies access from the cookie alone — no DB read per
// request, and changing a PIN never invalidates live sessions. Cloudbeds data is
// still read-and-cache only; the pins table is the sole auth state (CLAUDE.md §6).
// Edge-safe: Web Crypto only, no Node APIs.

export const AUTH_COOKIE = "sd_auth";

export type Level = "base" | "exec" | "crystal" | "monica" | "bea";

// Per-user dashboard levels (each unlocks only its own /<level> route; exec/CEO
// sees everything). `envVar` is the migration fallback PIN if the DB has no row.
export const USER_PINS: { level: Exclude<Level, "base" | "exec">; envVar: string }[] = [
  { level: "crystal", envVar: "CRYSTAL_PIN" },
  { level: "monica", envVar: "MONICA_PIN" },
  { level: "bea", envVar: "BEA_PIN" },
];

// Env-var fallback PIN per level (used by lib/pins.ts when the DB row is absent).
export const ENV_PIN_FOR: Record<Level, string> = {
  base: "DASHBOARD_PIN",
  exec: "EXEC_PIN",
  crystal: "CRYSTAL_PIN",
  monica: "MONICA_PIN",
  bea: "BEA_PIN",
};

export const ALL_LEVELS: Level[] = ["base", "exec", "crystal", "monica", "bea"];

/** Which level a path needs. /rob (the CEO's own view) => exec; each per-user
 *  route => its own level; everything else => base. */
export function requiredLevel(pathname: string): Level {
  const seg = pathname.split("/")[1] ?? "";
  if (seg === "rob") return "exec";
  const user = USER_PINS.find((u) => u.level === seg);
  if (user) return user.level;
  return "base";
}

/** The dashboard a level lands on after login. Exec/CEO (Rob) → /rob; each
 *  per-user level → its own route; base → /. */
export function homeForLevel(level: Level): string {
  if (level === "base") return "/";
  if (level === "exec") return "/rob";
  return `/${level}`; // crystal, monica, bea, …
}

/** Can `level` view `pathname`? exec sees all; a user level reaches only its own
 *  route; base reaches only base routes. */
export function canAccess(level: Level, pathname: string): boolean {
  if (level === "exec") return true; // CEO sees everything
  const need = requiredLevel(pathname);
  if (need === "base") return level === "base";
  return need === level;
}

/** Sanitize a post-login redirect target to a same-site path. */
export function safeNextPath(next: string | null | undefined): string {
  if (!next) return "/";
  if (!next.startsWith("/") || next.startsWith("//")) return "/";
  return next;
}

// --- Signed cookie -----------------------------------------------------------

// Signing secret: AUTH_SECRET if set, else fall back to DATABASE_URL (always
// present in prod) so the gate is NEVER accidentally open. Set AUTH_SECRET in
// Vercel to decouple the gate from the DB connection string.
function secret(): string {
  return process.env.AUTH_SECRET || process.env.DATABASE_URL || "";
}

/** Gate is enabled whenever a signing secret exists (always true in prod). */
export function gateEnabled(): boolean {
  return secret().length > 0;
}

async function hmacHex(message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Cookie value for an authenticated level: "<level>.<hmac(level)>". */
export async function signLevel(level: Level): Promise<string> {
  return `${level}.${await hmacHex(level)}`;
}

/** Verify a cookie and return its level, or null if missing/forged/unknown. */
export async function verifyCookie(cookie: string | undefined): Promise<Level | null> {
  if (!cookie) return null;
  const dot = cookie.lastIndexOf(".");
  if (dot <= 0) return null;
  const level = cookie.slice(0, dot);
  const sig = cookie.slice(dot + 1);
  if (!ALL_LEVELS.includes(level as Level)) return null;
  const expected = await hmacHex(level);
  // length-safe constant-ish comparison
  if (sig.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0 ? (level as Level) : null;
}
