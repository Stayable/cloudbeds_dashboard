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

export type Level = "base" | "exec" | "crystal" | "monica" | "bea" | "ops" | "elise";

// Per-user dashboard levels (each unlocks only its own /<level> route; exec/CEO
// sees everything). PINs live in Neon (lib/pins.ts) — there is no env-var PIN.
export const USER_PINS: { level: Exclude<Level, "base" | "exec"> }[] = [
  { level: "crystal" },
  { level: "monica" },
  { level: "bea" },
  { level: "ops" },
  { level: "elise" },
];

export const ALL_LEVELS: Level[] = ["base", "exec", "crystal", "monica", "bea", "ops", "elise"];

/** Which level a path needs. /rob (the CEO's own view) => exec; each per-user
 *  route => its own level; everything else => base. */
export function requiredLevel(pathname: string): Level {
  const seg = pathname.split("/")[1] ?? "";
  if (seg === "rob") return "exec";
  const user = USER_PINS.find((u) => u.level === seg);
  if (user) return user.level;
  return "base";
}

/** The dashboard a level lands on after login. Everyone lands on the shared
 *  Home `/` (nav bar reaches everything else they're permitted); the `elise`
 *  level is fully isolated and lands on its own /elise route instead. */
export function homeForLevel(level: Level): string {
  return level === "elise" ? "/elise" : "/";
}

/** Levels that are FULLY ISOLATED — they may reach ONLY their own /<level>
 *  route, not even the shared home (unlike other per-user levels, which can
 *  still see / for the "← Dashboard" back-link). Used for external/vendor
 *  access (e.g. EliseAI support) that must not see anything else in the app. */
export const RESTRICTED_LEVELS = new Set<Level>(["elise"]);

/** Can `level` view `pathname`? Route groups, in priority order:
 *  1. `/elise` — RESERVED for the `elise` pin only. Not even exec/CEO may
 *     reach it (checked before the exec short-circuit below).
 *  2. `elise` itself can reach nothing else — fully isolated.
 *  3. `exec` (CEO) sees everything else — shared pages, every personal
 *     dashboard, and `/rob`.
 *  4. `/rob` is exec-only (exec already handled above).
 *  5. `/crystal`, `/monica`, `/bea` are owner-only per-user dashboards.
 *  6. Everything else (shared pages `/`, `/ops`, `/report`, and any other
 *     gated route) is visible to any authenticated, non-restricted level. */
export function canAccess(level: Level, pathname: string): boolean {
  const seg = "/" + (pathname.split("/")[1] ?? "");
  if (seg === "/elise") return level === "elise"; // /elise: ONLY the ELISE pin — not even exec
  if (level === "elise") return false; // ELISE pin can reach nothing but /elise
  if (level === "exec") return true; // CEO: everything else
  if (seg === "/rob") return false; // exec-only (exec handled above)
  if (seg === "/crystal" || seg === "/monica" || seg === "/bea") return seg === "/" + level; // owner only
  // shared pages + any other gated route → any authenticated non-restricted level
  return true;
}

// --- Nav bar: pages a level may navigate to ----------------------------------

export type PageLink = { href: string; label: string };

export const SHARED_PAGES: PageLink[] = [
  { href: "/", label: "Home" },
  { href: "/ops", label: "Operations" },
  { href: "/report", label: "Revenue Report" },
];

const PERSONAL: Record<string, PageLink> = {
  crystal: { href: "/crystal", label: "Crystal — VP Ops" },
  monica: { href: "/monica", label: "Monica — Revenue" },
  bea: { href: "/bea", label: "Bea — Ops Support" },
};

const EXEC_PAGE: PageLink = { href: "/rob", label: "Exec (CEO)" };

/** Pages this level may navigate to (for the nav bar). */
export function accessiblePages(level: Level): PageLink[] {
  if (level === "elise") return [{ href: "/elise", label: "EliseAI Leasing" }];
  if (level === "exec") return [...SHARED_PAGES, PERSONAL.crystal, PERSONAL.monica, PERSONAL.bea, EXEC_PAGE];
  if (level in PERSONAL) return [...SHARED_PAGES, PERSONAL[level]];
  return [...SHARED_PAGES]; // base, ops (viewer)
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

/** Days a report-file link stays usable after the card that carried it is posted. */
export const FILE_TOKEN_DAYS = 30;

/** A bearer token for the report download route, so the daily Teams card can
 *  link the PDF/Excel WITHOUT everyone in the Revenue chat needing the MAIN
 *  pin. `/report/latest.*` is gated by middleware, which put a login wall in
 *  front of Monica's audience — the alternative was handing the pin (and with
 *  it the whole dashboard) to the chat.
 *
 *  Scope is deliberately "the report files, for a while", not per-user: the
 *  report is aggregate-only and carries no guest PII (CLAUDE.md §5 rule 2), so
 *  the risk being managed is business confidentiality, not privacy. The token
 *  is unguessable and expires; it is not an identity. */
export async function signFileToken(nowMs = Date.now()): Promise<string> {
  const exp = Math.floor(nowMs / 1000) + FILE_TOKEN_DAYS * 86_400;
  return `${exp}.${await hmacHex(`file:${exp}`)}`;
}

/** True iff `token` is well-formed, unexpired and signed by this deployment. */
export async function verifyFileToken(token: string | null, nowMs = Date.now()): Promise<boolean> {
  if (!token) return false;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return false;
  const exp = Number(token.slice(0, dot));
  const sig = token.slice(dot + 1);
  if (!Number.isFinite(exp) || exp * 1000 < nowMs) return false;
  const expected = await hmacHex(`file:${exp}`);
  if (sig.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
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
