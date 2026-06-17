// Server-side Cloudbeds API client. NEVER import this from a client component.
// The API key lives in a server-only env var and must never reach the browser
// (CLAUDE.md §5 rule 1). This module is read-only — it never writes to Cloudbeds.
//
// Auth (verified against Cloudbeds docs 2026-06-18):
//   Base URL : https://hotels.cloudbeds.com/api/v1.3
//   Header   : Authorization: Bearer cbat_...   (alt: x-api-key: cbat_...)
//   Scope    : the current key is Davenport (44199) only — per-property.

const BASE_URL = "https://hotels.cloudbeds.com/api/v1.3";

// Cache server-side to stay within rate limits and keep the page fast
// (CLAUDE.md §5 rule 4). 10-minute TTL.
const REVALIDATE_SECONDS = 600;

export type CloudbedsResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string; body?: unknown };

function getApiKey(): string | null {
  const key = process.env.CLOUDBEDS_API_KEY;
  return key && key.trim().length > 0 ? key.trim() : null;
}

async function cbGet<T = unknown>(
  path: string,
  params: Record<string, string> = {},
): Promise<CloudbedsResult<T>> {
  const key = getApiKey();
  if (!key) {
    return {
      ok: false,
      status: 0,
      error:
        "CLOUDBEDS_API_KEY is not set. Add it to .env.local (local) or Vercel env (deployed). Server-side only — no NEXT_PUBLIC_ prefix.",
    };
  }

  const url = new URL(`${BASE_URL}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
      },
      next: { revalidate: REVALIDATE_SECONDS },
    });
  } catch (e) {
    return { ok: false, status: 0, error: `Network error reaching Cloudbeds: ${String(e)}` };
  }

  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* leave as raw text */
  }

  if (!res.ok) {
    return { ok: false, status: res.status, error: `Cloudbeds returned HTTP ${res.status}`, body: parsed };
  }
  return { ok: true, data: parsed as T };
}

/**
 * Properties this API key can access, with their real Cloudbeds property IDs.
 * Source of truth for the property ID — do not assume it from config (the
 * "None of the included property id's match" error means the passed ID was
 * wrong; a single-property key resolves its own property from the token).
 */
export function getHotels() {
  return cbGet(`/getHotels`);
}

/**
 * Current operating snapshot for a property (occupancy, arrivals/departures,
 * in-house, etc.). For a single-property key, omit `propertyID` and let the
 * token resolve its own property — passing a mismatched ID errors. Field shapes
 * are intentionally untyped; verify against the live response before typing the
 * UI (CLAUDE.md §6).
 */
export function getDashboard(propertyID?: string) {
  return cbGet(`/getDashboard`, propertyID ? { propertyID } : {});
}
