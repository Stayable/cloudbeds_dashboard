# Three-Dashboard Stayable App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing occupancy-first Cloudbeds dashboard into three audience-specific views — base `/` (ops), `/exec` (CEO), `/test` (public intake form) — add a PII-free Lease-vs-Transient metric, and add Neon-backed persistence for team requirement submissions and exec feedback.

**Architecture:** One Next.js App Router app on Vercel. A role-based PIN gate (two levels, SHA-256 cookie tokens, no DB) replaces the single-PIN middleware. The exec view reuses the existing Cloudbeds client plus one new Data Insights query (lease mix) and prior-window occupancy for WoW/MoM deltas. `/test` is a fully static intake form (catalog + fake sample values, zero Cloudbeds calls) that writes to Neon Postgres via a public, BotID-protected `POST /api/submit`. Rob's exec feedback writes via an exec-gated `POST /api/feedback`. A read-only script exports the `submissions` table to `outputs/*.xlsx`.

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript, Tailwind 3, `@neondatabase/serverless` (already installed), Vercel BotID (`botid`), Vitest (new dev dependency for tests), `openpyxl` via Python (already used by `scripts/build-catalog.py`) for the xlsx export — actually export uses Node, see Task 12.

## Global Constraints

These apply to **every** task. Exact values copied from CLAUDE.md and the spec.

- **No credentials in the browser.** Cloudbeds keys, `DATABASE_URL`, and PINs are server-only. Never `NEXT_PUBLIC_`. (CLAUDE.md §5.1)
- **No guest PII anywhere — ever.** Lease/Transient is derived from rate-plan strings only; no Guest scope, no new API key. (CLAUDE.md §5.2, spec §7)
- **Read-only against Cloudbeds.** This app never writes to Cloudbeds. (CLAUDE.md §5.3)
- **Server-side cache TTL = 600s** (`REVALIDATE_SECONDS` in `lib/cloudbeds.ts`). Reuse it for new Cloudbeds calls. (CLAUDE.md §5.4)
- **The only public write surface is `POST /api/submit`.** It MUST be BotID-protected + server-validated (required fields, ≥1 metric) + lightly rate-limited. `POST /api/feedback` is exec-gated. (spec §6a, §7)
- **Output files go to the project `outputs/` folder only. Never OneDrive.** Property-specific outputs follow `Title_PropertyID_MMDDYY`; portfolio/entity outputs substitute the entity name. (CLAUDE.md §7)
- **Branch:** `claude/nifty-thompson-ts8zny`. Do not open a PR unless explicitly asked. (CLAUDE.md §8)
- **Aesthetic:** IB-clean — dark (`bg-ink` = `#0b1220`) headers, `accent` = `#2563eb`, clean grid, no chartjunk. All three views mobile-responsive (collapse to single column on phones). (spec §1, §4)
- **Exec view EXCLUDES revenue.** Exact revenue is blocked; do not ship a labeled-estimate revenue figure to the CEO. (spec §4)
- **PIN values:** base = `DASHBOARD_PIN` (existing env). exec = `EXEC_PIN` = `STYBLCEO` (new env). (spec §2)
- **Property IDs are mandatory on property-specific output.** Davenport business ID 44199 / API ID 318197 is the validation property. (CLAUDE.md §3)
- **TDD:** every code change is test-first where a test is feasible (pure logic, route handlers with mocks). Live-API behavior is covered by an explicit validation task, not a unit test. Commit after each task.

---

## File Structure

| File | Responsibility | New/Modify |
|---|---|---|
| `vitest.config.ts` | Vitest config (node env, `@/` alias) | **new** |
| `lib/auth.ts` | Level map, `tokenFor(level,pin)`, `requiredLevel(path)`, `expectedTokens()`, `decideAccess()` — pure, Edge-safe | **modify** |
| `middleware.ts` | Compute expected tokens, call `decideAccess`, redirect to `/login?next=`; exclude `/test`, `/api/submit` | **modify** |
| `app/api/auth/route.ts` | Accept either PIN; set level-appropriate cookie | **modify** |
| `app/login/page.tsx` | Honor `?next=`; redirect there on success | **modify** |
| `lib/dates.ts` | Add `priorWindow()` and `priorMonthWindow()` for WoW/MoM | **modify** |
| `lib/lease.ts` | Lease/Transient classification from rate-plan string | **new** |
| `lib/cloudbeds.ts` | Add `getPortfolioLeaseMix(asOf)` (DI dataset 3) | **modify** |
| `config/catalog-sample.ts` | Enumerated catalog metrics + deterministic SAMPLE values | **new** |
| `lib/db.ts` | Neon client + `insertSubmission()` + `insertFeedback()` | **new** |
| `next.config.ts` | Wrap with `withBotId` | **modify** (or new if absent) |
| `app/api/submit/route.ts` | Public, BotID + validation + rate-limit intake write | **new** |
| `app/api/feedback/route.ts` | Exec-gated feedback write | **new** |
| `components/IntakeForm.tsx` | Client intake form (name/role/team/metrics/notes) + BotID client | **new** |
| `app/test/page.tsx` | Static intake page (catalog + form) | **new** |
| `components/ExecView.tsx` | Leaderboard + WoW/MoM + ADR/RevPAR + lease mix | **new** |
| `components/ExecFeedback.tsx` | Rob's feedback textarea → `/api/feedback` | **new** |
| `app/exec/page.tsx` | Exec server page (fetch + compose) | **new** |
| `scripts/export-submissions.mjs` | Dump `submissions` → `outputs/Submissions_Stayable_<MMDDYY>.xlsx` | **new** |
| `.env.example` | Document `EXEC_PIN`, `DATABASE_URL` | **modify** |

---

## Task 1: Test harness + role-based auth core (pure logic)

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json` (add `vitest` devDep + `test` script)
- Modify: `lib/auth.ts`
- Test: `lib/__tests__/auth.test.ts`

**Interfaces:**
- Produces:
  - `AUTH_COOKIE: string` (unchanged, `"sd_auth"`)
  - `type Level = "base" | "exec"`
  - `tokenFor(level: Level, pin: string): Promise<string>` — SHA-256 hex of `stayable-dashboard:${level}:${pin}`
  - `requiredLevel(pathname: string): Level` — `/exec` or `/exec/...` → `"exec"`, else `"base"`
  - `expectedTokens(): Promise<{ base: string | null; exec: string | null }>` — reads `DASHBOARD_PIN`/`EXEC_PIN`; `base` null when no `DASHBOARD_PIN`; `exec` falls back to the base token when `EXEC_PIN` is unset
  - `decideAccess(pathname: string, cookieToken: string | undefined, expected: { base: string | null; exec: string | null }): "allow" | "deny"`

- [ ] **Step 1: Add Vitest dependency and script**

Run: `npm install -D vitest@^2`

Then edit `package.json` `scripts` to add:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 2: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: { environment: "node", include: ["lib/**/*.test.ts", "app/**/*.test.ts"] },
  resolve: { alias: { "@": resolve(__dirname, ".") } },
});
```

- [ ] **Step 3: Write the failing test** — `lib/__tests__/auth.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { tokenFor, requiredLevel, decideAccess } from "@/lib/auth";

describe("tokenFor", () => {
  it("is deterministic and level-scoped", async () => {
    const base = await tokenFor("base", "1234");
    const exec = await tokenFor("exec", "1234");
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    expect(base).not.toBe(exec); // same PIN, different level => different token
    expect(await tokenFor("base", "1234")).toBe(base);
  });
});

describe("requiredLevel", () => {
  it("requires exec for /exec routes, base otherwise", () => {
    expect(requiredLevel("/exec")).toBe("exec");
    expect(requiredLevel("/exec/anything")).toBe("exec");
    expect(requiredLevel("/")).toBe("base");
    expect(requiredLevel("/api/feedback")).toBe("base");
  });
});

describe("decideAccess", () => {
  const base = "BASE_TOKEN";
  const exec = "EXEC_TOKEN";

  it("allows everything when the gate is disabled (no base pin)", () => {
    expect(decideAccess("/exec", undefined, { base: null, exec: null })).toBe("allow");
  });
  it("base token reaches base routes but not exec", () => {
    expect(decideAccess("/", base, { base, exec })).toBe("allow");
    expect(decideAccess("/exec", base, { base, exec })).toBe("deny");
  });
  it("exec token reaches both base and exec routes", () => {
    expect(decideAccess("/", exec, { base, exec })).toBe("allow");
    expect(decideAccess("/exec", exec, { base, exec })).toBe("allow");
  });
  it("denies unknown/empty token on gated routes", () => {
    expect(decideAccess("/", undefined, { base, exec })).toBe("deny");
    expect(decideAccess("/exec", "garbage", { base, exec })).toBe("deny");
  });
  it("when EXEC_PIN is unset, exec falls back to the base token (never locks out)", () => {
    expect(decideAccess("/exec", base, { base, exec: base })).toBe("allow");
  });
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `npm test -- lib/__tests__/auth.test.ts`
Expected: FAIL — `requiredLevel`/`decideAccess` not exported.

- [ ] **Step 5: Rewrite `lib/auth.ts`**

```ts
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
```

- [ ] **Step 6: Run to verify it passes**

Run: `npm test -- lib/__tests__/auth.test.ts`
Expected: PASS (all 8 assertions).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json vitest.config.ts lib/auth.ts lib/__tests__/auth.test.ts
git commit -m "feat(auth): role-based PIN levels + vitest harness"
```

---

## Task 2: Wire middleware, auth route, and login `?next=`

**Files:**
- Modify: `middleware.ts`
- Modify: `app/api/auth/route.ts`
- Modify: `app/login/page.tsx`
- Test: `lib/__tests__/auth.test.ts` (extend — no separate file; middleware itself is wired manually-verified)

**Interfaces:**
- Consumes: `AUTH_COOKIE`, `expectedTokens`, `decideAccess`, `tokenFor`, `requiredLevel` from Task 1.
- Produces: gated app where base PIN reaches `/` but not `/exec`; exec PIN reaches both; `/test` and `/api/submit` are never gated.

- [ ] **Step 1: Rewrite `middleware.ts`**

```ts
import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, decideAccess, expectedTokens } from "@/lib/auth";

// Role-based PIN gate. Disabled (open) when DASHBOARD_PIN is unset, so a
// misconfigured deploy never locks itself out. /test and /api/submit are the
// public surfaces (excluded in the matcher). /exec needs the exec token.
export async function middleware(req: NextRequest) {
  const expected = await expectedTokens();
  const token = req.cookies.get(AUTH_COOKIE)?.value;
  if (decideAccess(req.nextUrl.pathname, token, expected) === "allow") {
    return NextResponse.next();
  }
  const url = req.nextUrl.clone();
  const next = req.nextUrl.pathname + req.nextUrl.search;
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(next)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Protect everything except: login, auth endpoint, the PUBLIC intake page and
  // its write endpoint, Next internals, and static files.
  matcher: [
    "/((?!login|api/auth|api/submit|test|_next/static|_next/image|favicon.ico|robots.txt).*)",
  ],
};
```

- [ ] **Step 2: Rewrite `app/api/auth/route.ts`**

```ts
import { NextResponse } from "next/server";
import { AUTH_COOKIE, tokenFor } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const basePin = process.env.DASHBOARD_PIN;
  const execPin = process.env.EXEC_PIN;
  if (!basePin) {
    return NextResponse.json({ ok: false, error: "PIN gate not configured" }, { status: 400 });
  }

  const body = (await req.json().catch(() => null)) as { pin?: unknown } | null;
  const pin = typeof body?.pin === "string" ? body.pin : "";

  // Determine the highest level this PIN unlocks. Exec PIN wins if it matches.
  let level: "base" | "exec" | null = null;
  if (execPin && pin === execPin) level = "exec";
  else if (pin === basePin) level = "base";

  if (!level) return NextResponse.json({ ok: false }, { status: 401 });

  const res = NextResponse.json({ ok: true, level });
  res.cookies.set(AUTH_COOKIE, await tokenFor(level, pin), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
  return res;
}
```

- [ ] **Step 3: Update `app/login/page.tsx` to honor `?next=`**

Replace the component body so it reads `next` from the URL and redirects there (default `/`). Full file:

```tsx
"use client";

import { useState } from "react";

export default function LoginPage() {
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(false);
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin }),
    });
    if (res.ok) {
      // Redirect back to the originally-requested path (?next=), default "/".
      const params = new URLSearchParams(window.location.search);
      const next = params.get("next");
      const dest = next && next.startsWith("/") ? next : "/"; // only same-site paths
      window.location.assign(dest); // hard nav so the cookie applies before middleware
    } else {
      setLoading(false);
      setError(true);
      setPin("");
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-ink px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl sm:p-8"
      >
        <p className="text-xs font-medium uppercase tracking-widest text-slate-400">
          Stayable · Operating Dashboard
        </p>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">Enter PIN</h1>
        <p className="mt-1 text-sm text-slate-500">
          This dashboard is private to RISE8 / Stayable.
        </p>

        <input
          type="password"
          inputMode="text"
          autoComplete="off"
          autoFocus
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          placeholder="Enter PIN"
          className="mt-5 w-full rounded-lg border border-slate-300 px-4 py-3 text-center text-lg tracking-widest text-slate-900 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
        />

        {error && (
          <p className="mt-2 text-sm text-red-600">Incorrect PIN. Try again.</p>
        )}

        <button
          type="submit"
          disabled={loading || pin.length === 0}
          className="mt-5 w-full rounded-lg bg-ink py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {loading ? "Checking…" : "Unlock"}
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 4: Verify the build compiles and auth tests still pass**

Run: `npm test && npx tsc --noEmit`
Expected: tests PASS; no type errors.

- [ ] **Step 5: Manual smoke (local), then commit**

Run: `npm run dev`, then in another shell confirm redirects (replace PINs with local `.env.local` values):
- `curl -i localhost:3000/exec` → 307 redirect to `/login?next=%2Fexec`
- `curl -i localhost:3000/test` → 200 (not gated)

```bash
git add middleware.ts app/api/auth/route.ts app/login/page.tsx
git commit -m "feat(auth): wire role middleware, level cookie, login ?next="
```

---

## Task 3: Lease vs Transient classification (`lib/lease.ts`)

**Files:**
- Create: `lib/lease.ts`
- Test: `lib/__tests__/lease.test.ts`

**Interfaces:**
- Produces:
  - `type LeaseClass = "lease-monthly" | "lease-weekly" | "transient"`
  - `classifyRatePlan(ratePlan: string | null | undefined): LeaseClass`
  - `MONTHLY_KEYWORDS: string[]`, `WEEKLY_KEYWORDS: string[]` (exported named constants, correctable without touching call sites)

Rule (spec §5, memory `lease-vs-transient`): case-insensitive substring match. Monthly precedence over weekly; any lease keyword present ⇒ lease (handles comma-joined multi-plan stays). Empty/unknown ⇒ transient.

- [ ] **Step 1: Write the failing test** — `lib/__tests__/lease.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { classifyRatePlan } from "@/lib/lease";

describe("classifyRatePlan", () => {
  it("classifies monthly leases", () => {
    expect(classifyRatePlan("Monthly Lease")).toBe("lease-monthly");
    expect(classifyRatePlan("Long Term Rate (21 nights min)")).toBe("lease-monthly");
    expect(classifyRatePlan("Discounted Long Term Rate")).toBe("lease-monthly");
  });
  it("classifies weekly leases", () => {
    expect(classifyRatePlan("Weekly Lease")).toBe("lease-weekly");
    expect(classifyRatePlan("Discounted Weekly Rate")).toBe("lease-weekly");
    expect(classifyRatePlan("Employee Weekly Rate")).toBe("lease-weekly");
    expect(classifyRatePlan("Weekly Rate")).toBe("lease-weekly");
  });
  it("classifies transient", () => {
    expect(classifyRatePlan("Base Rate")).toBe("transient");
    expect(classifyRatePlan("Book Direct and Save")).toBe("transient");
    expect(classifyRatePlan("Non-refundable")).toBe("transient");
  });
  it("is case-insensitive", () => {
    expect(classifyRatePlan("monthly lease")).toBe("lease-monthly");
  });
  it("multi-plan: any lease present => lease, monthly beats weekly", () => {
    expect(classifyRatePlan("Discounted Weekly Rate, Monthly Lease")).toBe("lease-monthly");
    expect(classifyRatePlan("Base Rate, Weekly Lease")).toBe("lease-weekly");
  });
  it("empty/unknown => transient", () => {
    expect(classifyRatePlan("")).toBe("transient");
    expect(classifyRatePlan(null)).toBe("transient");
    expect(classifyRatePlan(undefined)).toBe("transient");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- lib/__tests__/lease.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/lease.ts`**

```ts
// Lease vs Transient classification, derived ONLY from rate-plan strings.
// No guest PII, no Guest scope (CLAUDE.md §5.2). Keyword lists are named
// constants so they can be corrected against real rate-plan inventory without
// touching call sites. See memory `lease-vs-transient` for the verified plans.

export type LeaseClass = "lease-monthly" | "lease-weekly" | "transient";

// Monthly is checked first (precedence). Verified plans + safe synonyms.
export const MONTHLY_KEYWORDS = ["monthly lease", "long term", "discounted long term"];
export const WEEKLY_KEYWORDS = [
  "weekly lease",
  "weekly rate",
  "discounted weekly",
  "employee weekly",
];

/**
 * Classify a (possibly comma-joined multi-plan) rate-plan string.
 * Any lease keyword present => lease; monthly takes precedence over weekly;
 * otherwise transient. Case-insensitive.
 */
export function classifyRatePlan(ratePlan: string | null | undefined): LeaseClass {
  const s = (ratePlan ?? "").toLowerCase();
  if (MONTHLY_KEYWORDS.some((k) => s.includes(k))) return "lease-monthly";
  if (WEEKLY_KEYWORDS.some((k) => s.includes(k))) return "lease-weekly";
  return "transient";
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- lib/__tests__/lease.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/lease.ts lib/__tests__/lease.test.ts
git commit -m "feat(lease): PII-free rate-plan classification"
```

---

## Task 4: WoW/MoM date-window helpers (`lib/dates.ts`)

**Files:**
- Modify: `lib/dates.ts`
- Test: `lib/__tests__/dates.test.ts`

**Interfaces:**
- Consumes: existing `shiftYmd`, `dayCount` from `lib/dates.ts`.
- Produces:
  - `priorWindow(start: string, end: string): { start: string; end: string }` — the equal-length window immediately before `[start, end]`.
  - `priorMonthWindow(start: string, end: string): { start: string; end: string }` — same window shifted back ~one month (subtract 1 from the month component of both ends, clamping day to a valid date).

- [ ] **Step 1: Write the failing test** — `lib/__tests__/dates.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { priorWindow, priorMonthWindow } from "@/lib/dates";

describe("priorWindow", () => {
  it("returns the equal-length window immediately before", () => {
    // 7-day window 2026-06-10..2026-06-16 -> 2026-06-03..2026-06-09
    expect(priorWindow("2026-06-10", "2026-06-16")).toEqual({
      start: "2026-06-03",
      end: "2026-06-09",
    });
  });
  it("handles a single day", () => {
    expect(priorWindow("2026-06-16", "2026-06-16")).toEqual({
      start: "2026-06-15",
      end: "2026-06-15",
    });
  });
});

describe("priorMonthWindow", () => {
  it("shifts the window back one calendar month", () => {
    expect(priorMonthWindow("2026-06-10", "2026-06-16")).toEqual({
      start: "2026-05-10",
      end: "2026-05-16",
    });
  });
  it("clamps to the last valid day when the target month is shorter", () => {
    // March 31 -> February: clamp to Feb 28 (2026 is not a leap year)
    expect(priorMonthWindow("2026-03-31", "2026-03-31")).toEqual({
      start: "2026-02-28",
      end: "2026-02-28",
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- lib/__tests__/dates.test.ts`
Expected: FAIL — helpers not exported.

- [ ] **Step 3: Append to `lib/dates.ts`**

```ts
/** The equal-length window immediately before [start, end] (inclusive). */
export function priorWindow(start: string, end: string): { start: string; end: string } {
  const len = dayCount(start, end); // inclusive day count
  return { start: shiftYmd(start, -len), end: shiftYmd(end, -len) };
}

/** Shift a YYYY-MM-DD back one calendar month, clamping the day to a valid date. */
function shiftMonth(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const targetMonth = m === 1 ? 12 : m - 1;
  const targetYear = m === 1 ? y - 1 : y;
  // Last day of the target month (day 0 of the following month, UTC).
  const lastDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return `${targetYear}-${String(targetMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Same-shaped window one calendar month earlier (both ends clamped). */
export function priorMonthWindow(start: string, end: string): { start: string; end: string } {
  return { start: shiftMonth(start), end: shiftMonth(end) };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- lib/__tests__/dates.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/dates.ts lib/__tests__/dates.test.ts
git commit -m "feat(dates): prior-window + prior-month helpers for WoW/MoM"
```

---

## Task 5: Lease-mix Data Insights query (`lib/cloudbeds.ts`)

> **Probe-first task.** The exact DI Reservations (dataset 3) column names for the in-house overlap filter and the room-count aggregation are NOT fully confirmed in public docs. Confirm them with a read-only scratch probe before writing the implementation. The classification math is already unit-tested (Task 3); this task wires the live query and is verified end-to-end in Task 13.

**Files:**
- Create (scratch, not committed to app): `scripts/probe-lease-query.mjs`
- Modify: `lib/cloudbeds.ts`

**Interfaces:**
- Consumes: `classifyRatePlan` (Task 3); `readKey`, `PROPERTIES`, `REVALIDATE_SECONDS`, `DI_BASE` patterns already in `lib/cloudbeds.ts`.
- Produces:
  - `type LeaseMix = { monthly: number; weekly: number; transient: number; total: number }`
  - `type PropertyLeaseMix = { property: Property; configured: boolean; result: CloudbedsResult<LeaseMix> | null }`
  - `getPortfolioLeaseMix(asOf: string): Promise<PropertyLeaseMix[]>` — per-property in-house lease mix as of date `asOf` (YYYY-MM-DD).

- [ ] **Step 1: Write the scratch probe** — `scripts/probe-lease-query.mjs`

Model it on the existing `scripts/probe-lease-transient.mjs` (same `.env.local` loader, same `DI` base, Davenport `318197`). Goal: confirm (a) the date columns that bound an in-house stay (candidates: `check_in_date`, `check_out_date`, `arrival_date`, `departure_date`), (b) a usable rooms measure (candidates: `room_count`, `rooms_count`, `room_nights_count`), and (c) that filtering to an as-of date returns a sane row count.

```js
// Read-only probe: confirm the in-house overlap query for lease mix.
// No guest scope. Davenport (318197) only.  Run: node scripts/probe-lease-query.mjs
import { readFileSync } from "node:fs";
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}
const KEY = process.env.CLOUDBEDS_API_KEY_DP;
const PROP = "318197";
const DI = "https://api.cloudbeds.com/datainsights/v1.1";
const H = { Authorization: `Bearer ${KEY}`, "X-PROPERTY-ID": PROP, Accept: "application/json" };
const asOf = process.argv[2] || new Date().toISOString().slice(0, 10);

// dump dataset 3 column names so we can see exact date/room columns
const detail = await (await fetch(`${DI}/datasets/3`, { headers: H })).json();
const cols = (detail.cdfs ?? []).flatMap((g) => (g.cdfs ?? []).map((c) => c.column));
console.log("date-ish:", cols.filter((c) => /date|arriv|depart|check/i.test(c)).join(", "));
console.log("room-ish:", cols.filter((c) => /room|count|night/i.test(c)).join(", "));

// try the overlap query grouped by public_rate_plan
const body = {
  property_ids: [Number(PROP)],
  dataset_id: 3,
  columns: [{ cdf: { column: "room_count" }, modifier: "sum" }],
  group_rows: [{ cdf: { column: "public_rate_plan" } }],
  filters: {
    and: [
      { cdf: { column: "check_in_date" }, operator: "less_than_or_equal", value: asOf },
      { cdf: { column: "check_out_date" }, operator: "greater_than", value: asOf },
    ],
  },
  settings: { totals: true, details: false },
};
const r = await fetch(`${DI}/reports/query/data?mode=Run`, {
  method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify(body),
});
console.log("query status", r.status);
console.log(JSON.stringify(await r.json(), null, 2).slice(0, 2000));
```

- [ ] **Step 2: Run the probe and record the working column names**

Run: `node scripts/probe-lease-query.mjs 2026-06-24`
Expected: HTTP 200 with rows keyed by rate-plan name and a numeric room measure. **Note in the task which column names actually worked** (date bounds + room measure). If `room_count`/`check_in_date`/`check_out_date` error, substitute the names printed by the `date-ish`/`room-ish` lines. If no room measure aggregates, fall back to counting reservations (rows) per rate plan.

- [ ] **Step 3: Implement `getPortfolioLeaseMix` in `lib/cloudbeds.ts`**

Append (adjust the three quoted column names to whatever the probe confirmed; the version below uses the documented candidates):

```ts
import { classifyRatePlan } from "@/lib/lease";

export type LeaseMix = { monthly: number; weekly: number; transient: number; total: number };

/** In-house lease mix for one property as of `asOf` (YYYY-MM-DD), from DI dataset 3. */
async function getLeaseMix(
  apiKey: string,
  apiPropertyId: string,
  asOf: string,
): Promise<CloudbedsResult<LeaseMix>> {
  const body = {
    property_ids: [Number(apiPropertyId)],
    dataset_id: 3,
    columns: [{ cdf: { column: "room_count" }, modifier: "sum" }],
    group_rows: [{ cdf: { column: "public_rate_plan" } }],
    filters: {
      and: [
        { cdf: { column: "check_in_date" }, operator: "less_than_or_equal", value: asOf },
        { cdf: { column: "check_out_date" }, operator: "greater_than", value: asOf },
      ],
    },
    settings: { totals: false, details: false },
  };

  let res: Response;
  try {
    res = await fetch(`${DI_BASE}/reports/query/data?mode=Run`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "X-PROPERTY-ID": apiPropertyId,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      next: { revalidate: REVALIDATE_SECONDS },
    });
  } catch (e) {
    return { ok: false, status: 0, error: `Network error reaching Data Insights: ${String(e)}` };
  }

  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* keep raw */
  }
  if (!res.ok) return { ok: false, status: res.status, error: `Data Insights HTTP ${res.status}`, body: parsed };

  // records keyed by the group value (rate-plan name); the summed measure lives
  // under records[plan].room_count.aggregated (fall back to 0).
  const records = (parsed as { records?: Record<string, Record<string, { aggregated?: number }>> })?.records ?? {};
  const mix: LeaseMix = { monthly: 0, weekly: 0, transient: 0, total: 0 };
  for (const plan of Object.keys(records)) {
    const n = records[plan]?.room_count?.aggregated;
    const rooms = typeof n === "number" ? n : 0;
    const cls = classifyRatePlan(plan);
    if (cls === "lease-monthly") mix.monthly += rooms;
    else if (cls === "lease-weekly") mix.weekly += rooms;
    else mix.transient += rooms;
    mix.total += rooms;
  }
  return { ok: true, data: mix };
}

export type PropertyLeaseMix = {
  property: Property;
  configured: boolean;
  result: CloudbedsResult<LeaseMix> | null;
};

/** In-house lease mix for every configured property as of `asOf`, in parallel. */
export async function getPortfolioLeaseMix(asOf: string): Promise<PropertyLeaseMix[]> {
  return Promise.all(
    PROPERTIES.map(async (property): Promise<PropertyLeaseMix> => {
      const key = readKey(property.code);
      if (!key || !property.apiPropertyId) return { property, configured: false, result: null };
      return { property, configured: true, result: await getLeaseMix(key, property.apiPropertyId, asOf) };
    }),
  );
}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit** (the scratch probe stays out of the app but is fine to commit alongside the other `scripts/probe-*.mjs`)

```bash
git add lib/cloudbeds.ts scripts/probe-lease-query.mjs
git commit -m "feat(cloudbeds): getPortfolioLeaseMix (in-house mix, DI dataset 3)"
```

---

## Task 6: Catalog enumeration with sample values (`config/catalog-sample.ts`)

**Files:**
- Create: `config/catalog-sample.ts`
- Test: `config/__tests__/catalog-sample.test.ts`

**Interfaces:**
- Produces:
  - `type CatalogMetric = { key: string; name: string; explanation: string; category: string; type: string; cadence: string; sample: string }`
  - `CATALOG: CatalogMetric[]`
  - `CATALOG_BY_CATEGORY: { category: string; metrics: CatalogMetric[] }[]` (grouped, source order preserved)

Source of truth is the `data` array in `scripts/build-catalog.py` (lines 97–213): tuples of `(name, explanation, category, source, type, cadence, on_now)`. Port every tuple. `key` = slugified `name`. `sample` = deterministic fake from `type` via `sampleFor`, with a few marquee overrides. All samples are watermarked "SAMPLE" in the UI (Task 10), so fixed fakes are honest.

- [ ] **Step 1: Write the failing test** — `config/__tests__/catalog-sample.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { CATALOG, CATALOG_BY_CATEGORY } from "@/config/catalog-sample";

describe("catalog-sample", () => {
  it("enumerates the full catalog", () => {
    expect(CATALOG.length).toBeGreaterThanOrEqual(90);
  });
  it("every metric has a unique key and a non-empty sample", () => {
    const keys = new Set<string>();
    for (const m of CATALOG) {
      expect(m.key).toMatch(/^[a-z0-9-]+$/);
      expect(keys.has(m.key)).toBe(false);
      keys.add(m.key);
      expect(m.name.length).toBeGreaterThan(0);
      expect(m.sample.length).toBeGreaterThan(0);
    }
  });
  it("groups cover every metric exactly once", () => {
    const grouped = CATALOG_BY_CATEGORY.flatMap((g) => g.metrics);
    expect(grouped.length).toBe(CATALOG.length);
  });
  it("formats samples by type", () => {
    const occ = CATALOG.find((m) => m.key === "occupancy");
    expect(occ?.sample).toMatch(/%$/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- config/__tests__/catalog-sample.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `config/catalog-sample.ts`**

Write the file with: (a) a `slug()` helper, (b) a `sampleFor(type, name)` helper with the rules below, (c) `RAW` — **every tuple ported from `scripts/build-catalog.py` lines 97–213** as `[name, explanation, category, type, cadence]` (drop the `source` and `on_now` columns; keep name/explanation/category/type/cadence), and (d) the derived `CATALOG` + `CATALOG_BY_CATEGORY`. Skeleton with the first three rows shown — port the remaining tuples verbatim from the Python source:

```ts
// Static catalog for the public /test intake form. NO Cloudbeds calls — these
// are the showable metrics from the data catalog (scripts/build-catalog.py) with
// deterministic SAMPLE values. Every value is fake and must be watermarked
// "SAMPLE" wherever rendered (spec §6).

export type CatalogMetric = {
  key: string;
  name: string;
  explanation: string;
  category: string;
  type: string;
  cadence: string;
  sample: string;
};

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[()/.,&%-]/g, " ")
    .trim()
    .replace(/\s+/g, "-");
}

// Deterministic fake sample by type, with marquee overrides by name.
const OVERRIDES: Record<string, string> = {
  "Occupancy %": "82.4%",
  "Occupancy % (live)": "84.1%",
  "ADR - Average Daily Rate": "$118.50",
  "RevPAR - Revenue Per Available Room": "$97.30",
  "Total Revenue": "$48,250",
  "Total Room Revenue": "$41,800",
};

function sampleFor(type: string, name: string): string {
  if (OVERRIDES[name]) return OVERRIDES[name];
  switch (type) {
    case "Percent": return "76.0%";
    case "Count": return "37";
    case "Currency": return "$1,250.00";
    case "Number": return "12";
    case "Category": return "Retail";
    case "Flag": return "Yes";
    case "Timestamp": return "2:14 PM EDT";
    case "Date": return "Jun 24, 2026";
    case "Text": return "Sample text";
    default: return "—";
  }
}

// [name, explanation, category, type, cadence] — ported from build-catalog.py.
const RAW: [string, string, string, string, string][] = [
  ["Occupancy % (live)", "Share of sellable rooms occupied right now.", "Occupancy", "Percent", "Live now"],
  ["Rooms Occupied (live)", "Number of rooms occupied right now.", "Occupancy", "Count", "Live now"],
  ["Sellable Capacity", "Total rooms available to sell (inventory).", "Occupancy", "Count", "Live now"],
  // … PORT THE REMAINING ROWS from scripts/build-catalog.py lines 102–212,
  //    one entry per tuple, dropping the `source` (5th) and `on_now` (last)
  //    columns. Keep source order so categories group naturally.
];

export const CATALOG: CatalogMetric[] = RAW.map(([name, explanation, category, type, cadence]) => ({
  key: slug(name),
  name,
  explanation,
  category,
  type,
  cadence,
  sample: sampleFor(type, name),
}));

export const CATALOG_BY_CATEGORY: { category: string; metrics: CatalogMetric[] }[] = (() => {
  const order: string[] = [];
  const map = new Map<string, CatalogMetric[]>();
  for (const m of CATALOG) {
    if (!map.has(m.category)) {
      map.set(m.category, []);
      order.push(m.category);
    }
    map.get(m.category)!.push(m);
  }
  return order.map((category) => ({ category, metrics: map.get(category)! }));
})();
```

> **Important:** `slug()` can collide (e.g. "Out-of-Service Rooms" appears in both the live and occupancy sections). If the uniqueness test fails, disambiguate by prefixing the duplicate's key with a short category tag (e.g. `occ-out-of-service-rooms`) — adjust the colliding `RAW` entry's name minimally or special-case in `slug`. The test in Step 1 enforces uniqueness, so this surfaces immediately.

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- config/__tests__/catalog-sample.test.ts`
Expected: PASS. If the count or uniqueness assertions fail, finish porting rows / fix key collisions.

- [ ] **Step 5: Commit**

```bash
git add config/catalog-sample.ts config/__tests__/catalog-sample.test.ts
git commit -m "feat(catalog): static catalog metrics + sample values for /test"
```

---

## Task 7: Neon DB client + submission/feedback inserts (`lib/db.ts`)

**Files:**
- Create: `lib/db.ts`
- Test: `lib/__tests__/db.test.ts`

**Interfaces:**
- Produces:
  - `type SubmissionInput = { name: string; role: string; team: string; metrics: string[]; notes?: string }`
  - `insertSubmission(input: SubmissionInput): Promise<void>` — inserts `source='team-intake'`
  - `insertFeedback(notes: string): Promise<void>` — inserts `source='exec-feedback'`, `name='Rob'`
  - both throw if `DATABASE_URL` is unset or the query fails.

The Neon `neon()` tagged-template client is created lazily inside each function (so importing the module never throws at build time when `DATABASE_URL` is absent). Tests mock `@neondatabase/serverless`.

- [ ] **Step 1: Write the failing test** — `lib/__tests__/db.test.ts`

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Capture the SQL tag calls from a mocked neon client.
const calls: { strings: string[]; values: unknown[] }[] = [];
vi.mock("@neondatabase/serverless", () => ({
  neon: () => (strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ strings: Array.from(strings), values });
    return Promise.resolve([]);
  },
}));

import { insertSubmission, insertFeedback } from "@/lib/db";

beforeEach(() => {
  calls.length = 0;
  process.env.DATABASE_URL = "postgresql://test";
});

describe("insertSubmission", () => {
  it("inserts an intake row with the metrics array", async () => {
    await insertSubmission({ name: "Ana", role: "PM", team: "Crystal", metrics: ["occupancy"], notes: "hi" });
    expect(calls.length).toBe(1);
    expect(calls[0].values).toContain("team-intake");
    expect(calls[0].values).toContain("Ana");
    // metrics serialized as JSON string for jsonb
    expect(calls[0].values).toContain(JSON.stringify(["occupancy"]));
  });
});

describe("insertFeedback", () => {
  it("inserts an exec-feedback row attributed to Rob", async () => {
    await insertFeedback("dashboard looks great");
    expect(calls[0].values).toContain("exec-feedback");
    expect(calls[0].values).toContain("Rob");
    expect(calls[0].values).toContain("dashboard looks great");
  });
});

describe("guards", () => {
  it("throws when DATABASE_URL is unset", async () => {
    delete process.env.DATABASE_URL;
    await expect(insertFeedback("x")).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- lib/__tests__/db.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/db.ts`**

```ts
// Server-only Neon Postgres client (CLAUDE.md §6 reversal — sanctioned for
// persisting /test submissions and exec feedback). Never import from a client
// component. One table `submissions` (see scripts/db-init.mjs).
import { neon } from "@neondatabase/serverless";

function db() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return neon(url);
}

export type SubmissionInput = {
  name: string;
  role: string;
  team: string;
  metrics: string[];
  notes?: string;
};

/** Insert a team requirements submission from /test (source='team-intake'). */
export async function insertSubmission(input: SubmissionInput): Promise<void> {
  const sql = db();
  await sql`
    insert into submissions (source, name, role, team, metrics, notes)
    values ('team-intake', ${input.name}, ${input.role}, ${input.team},
            ${JSON.stringify(input.metrics)}::jsonb, ${input.notes ?? null})
  `;
}

/** Insert Rob's exec feedback (source='exec-feedback', name='Rob'). */
export async function insertFeedback(notes: string): Promise<void> {
  const sql = db();
  await sql`
    insert into submissions (source, name, notes)
    values ('exec-feedback', 'Rob', ${notes})
  `;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- lib/__tests__/db.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/db.ts lib/__tests__/db.test.ts
git commit -m "feat(db): Neon insertSubmission + insertFeedback"
```

---

## Task 8: BotID wiring + public `POST /api/submit`

**Files:**
- Modify (or create): `next.config.ts`
- Modify: `package.json` (add `botid`)
- Create: `lib/ratelimit.ts`
- Create: `app/api/submit/route.ts`
- Test: `app/api/__tests__/submit.test.ts`, `lib/__tests__/ratelimit.test.ts`

**Interfaces:**
- Consumes: `insertSubmission` (Task 7).
- Produces:
  - `lib/ratelimit.ts`: `allow(key: string, limit: number, windowMs: number): boolean` — in-memory fixed-window limiter (best-effort; resets on cold start, acceptable for low-sensitivity abuse control).
  - `POST /api/submit`: validates `{ name, role, team, metrics[], notes? }`; runs BotID; rate-limits; inserts; returns `{ ok: true }` or an error status.

- [ ] **Step 1: Install BotID**

Run: `npm install botid`

- [ ] **Step 2: Wrap `next.config.ts` with `withBotId`**

If `next.config.ts`/`next.config.mjs` exists, wrap its export; otherwise create `next.config.ts`:

```ts
import type { NextConfig } from "next";
import { withBotId } from "botid/next/config";

const nextConfig: NextConfig = {};

export default withBotId(nextConfig);
```

(If a `next.config.*` already exists, preserve its contents and only wrap the final export in `withBotId(...)`.)

- [ ] **Step 3: Write the failing rate-limit test** — `lib/__tests__/ratelimit.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { allow } from "@/lib/ratelimit";

describe("allow", () => {
  it("permits up to the limit then blocks within the window", () => {
    const key = "test-ip";
    expect(allow(key, 2, 60_000)).toBe(true);
    expect(allow(key, 2, 60_000)).toBe(true);
    expect(allow(key, 2, 60_000)).toBe(false);
  });
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `npm test -- lib/__tests__/ratelimit.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 5: Implement `lib/ratelimit.ts`**

```ts
// Best-effort in-memory fixed-window rate limiter. Resets on cold start; this is
// a light abuse guard for the single public write (/api/submit), not a hard SLA.
const hits = new Map<string, { count: number; resetAt: number }>();

export function allow(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const rec = hits.get(key);
  if (!rec || now >= rec.resetAt) {
    hits.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (rec.count >= limit) return false;
  rec.count += 1;
  return true;
}
```

- [ ] **Step 6: Run to verify it passes**

Run: `npm test -- lib/__tests__/ratelimit.test.ts`
Expected: PASS.

- [ ] **Step 7: Write the failing route test** — `app/api/__tests__/submit.test.ts`

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const inserted: unknown[] = [];
vi.mock("@/lib/db", () => ({
  insertSubmission: vi.fn(async (input: unknown) => { inserted.push(input); }),
}));
// Default: not a bot. Individual tests can override.
const checkBotId = vi.fn(async () => ({ isBot: false }));
vi.mock("botid/server", () => ({ checkBotId: () => checkBotId() }));

import { POST } from "@/app/api/submit/route";

function req(body: unknown) {
  return new Request("http://localhost/api/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": "1.2.3.4" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  inserted.length = 0;
  checkBotId.mockResolvedValue({ isBot: false });
});

describe("POST /api/submit", () => {
  it("rejects missing required fields", async () => {
    const res = await POST(req({ name: "", role: "", team: "", metrics: [] }));
    expect(res.status).toBe(400);
    expect(inserted.length).toBe(0);
  });
  it("rejects zero metrics", async () => {
    const res = await POST(req({ name: "A", role: "PM", team: "Crystal", metrics: [] }));
    expect(res.status).toBe(400);
  });
  it("rejects bots", async () => {
    checkBotId.mockResolvedValue({ isBot: true });
    const res = await POST(req({ name: "A", role: "PM", team: "Crystal", metrics: ["occupancy"] }));
    expect(res.status).toBe(403);
    expect(inserted.length).toBe(0);
  });
  it("inserts on the happy path", async () => {
    const res = await POST(req({ name: "A", role: "PM", team: "Crystal", metrics: ["occupancy"], notes: "x" }));
    expect(res.status).toBe(200);
    expect(inserted.length).toBe(1);
  });
});
```

> Note: the in-memory limiter is shared across tests in one process. Keep happy-path requests ≤ the configured limit, or vary `x-forwarded-for` per test. With the default `limit=5/min` and 4 tests on the same IP, this is fine.

- [ ] **Step 8: Run to verify it fails**

Run: `npm test -- app/api/__tests__/submit.test.ts`
Expected: FAIL — route module not found.

- [ ] **Step 9: Implement `app/api/submit/route.ts`**

```ts
import { NextResponse } from "next/server";
import { checkBotId } from "botid/server";
import { insertSubmission } from "@/lib/db";
import { allow } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

const TEAMS = ["Crystal", "Remote Property Managers", "Property Managers & Attendants", "Other"];

export async function POST(req: Request) {
  // 1) Bot check (Vercel BotID). Off-Vercel/dev returns isBot:false.
  const verdict = await checkBotId();
  if (verdict.isBot) return NextResponse.json({ ok: false, error: "Bot detected" }, { status: 403 });

  // 2) Light rate limit by client IP.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!allow(`submit:${ip}`, 5, 60_000)) {
    return NextResponse.json({ ok: false, error: "Too many requests" }, { status: 429 });
  }

  // 3) Parse + validate.
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const role = typeof body?.role === "string" ? body.role.trim() : "";
  const team = typeof body?.team === "string" ? body.team.trim() : "";
  const metrics = Array.isArray(body?.metrics)
    ? (body!.metrics as unknown[]).filter((m): m is string => typeof m === "string")
    : [];
  const notes = typeof body?.notes === "string" ? body.notes.trim() : "";

  if (!name || !role || !team) {
    return NextResponse.json({ ok: false, error: "name, role, and team are required" }, { status: 400 });
  }
  if (!TEAMS.includes(team)) {
    return NextResponse.json({ ok: false, error: "invalid team" }, { status: 400 });
  }
  if (metrics.length < 1) {
    return NextResponse.json({ ok: false, error: "select at least one metric" }, { status: 400 });
  }

  // 4) Persist.
  try {
    await insertSubmission({ name, role, team, metrics, notes: notes || undefined });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "could not save submission" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 10: Run to verify it passes**

Run: `npm test -- app/api/__tests__/submit.test.ts`
Expected: PASS (4 assertions).

- [ ] **Step 11: Commit**

```bash
git add package.json package-lock.json next.config.ts lib/ratelimit.ts app/api/submit/route.ts \
  lib/__tests__/ratelimit.test.ts app/api/__tests__/submit.test.ts
git commit -m "feat(api): public BotID-protected /api/submit with validation + rate limit"
```

---

## Task 9: Exec-gated `POST /api/feedback`

**Files:**
- Create: `app/api/feedback/route.ts`
- Test: `app/api/__tests__/feedback.test.ts`

**Interfaces:**
- Consumes: `insertFeedback` (Task 7); `AUTH_COOKIE`, `expectedTokens` (Task 1).
- Produces: `POST /api/feedback` — requires the exec cookie token; inserts feedback; returns `{ ok: true }` or 401/400.

This route is also behind the middleware gate (base level), but it self-checks for the **exec** token specifically so a base-only session cannot post feedback. Reads the cookie via `next/headers`.

- [ ] **Step 1: Write the failing test** — `app/api/__tests__/feedback.test.ts`

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const inserted: string[] = [];
vi.mock("@/lib/db", () => ({
  insertFeedback: vi.fn(async (notes: string) => { inserted.push(notes); }),
}));

// Control the cookie + expected tokens.
let cookieToken: string | undefined;
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (_: string) => (cookieToken ? { value: cookieToken } : undefined) }),
}));
vi.mock("@/lib/auth", async (orig) => {
  const actual = await (orig as () => Promise<typeof import("@/lib/auth")>)();
  return { ...actual, expectedTokens: async () => ({ base: "BASE", exec: "EXEC" }) };
});

import { POST } from "@/app/api/feedback/route";

function req(body: unknown) {
  return new Request("http://localhost/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => { inserted.length = 0; cookieToken = undefined; });

describe("POST /api/feedback", () => {
  it("rejects without the exec token", async () => {
    cookieToken = "BASE"; // base session cannot post feedback
    const res = await POST(req({ notes: "hi" }));
    expect(res.status).toBe(401);
    expect(inserted.length).toBe(0);
  });
  it("rejects empty notes", async () => {
    cookieToken = "EXEC";
    const res = await POST(req({ notes: "   " }));
    expect(res.status).toBe(400);
  });
  it("inserts with the exec token", async () => {
    cookieToken = "EXEC";
    const res = await POST(req({ notes: "great dashboard" }));
    expect(res.status).toBe(200);
    expect(inserted).toContain("great dashboard");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- app/api/__tests__/feedback.test.ts`
Expected: FAIL — route module not found.

- [ ] **Step 3: Implement `app/api/feedback/route.ts`**

```ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { AUTH_COOKIE, expectedTokens } from "@/lib/auth";
import { insertFeedback } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // Require the EXEC token specifically (a base-only session must not post).
  const expected = await expectedTokens();
  const token = (await cookies()).get(AUTH_COOKIE)?.value;
  if (!expected.exec || token !== expected.exec) {
    return NextResponse.json({ ok: false, error: "exec access required" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as { notes?: unknown } | null;
  const notes = typeof body?.notes === "string" ? body.notes.trim() : "";
  if (!notes) return NextResponse.json({ ok: false, error: "notes required" }, { status: 400 });

  try {
    await insertFeedback(notes);
  } catch {
    return NextResponse.json({ ok: false, error: "could not save feedback" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
```

> Note on the gate-disabled case: when `EXEC_PIN`/`DASHBOARD_PIN` are unset, `expected.exec` is null and feedback POSTs are rejected (401). That is the safe default — feedback is exec-only by design; a deploy with no PINs simply can't record exec feedback. Acceptable.

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- app/api/__tests__/feedback.test.ts`
Expected: PASS (3 assertions).

- [ ] **Step 5: Commit**

```bash
git add app/api/feedback/route.ts app/api/__tests__/feedback.test.ts
git commit -m "feat(api): exec-gated /api/feedback"
```

---

## Task 10: Public intake form — `app/test/page.tsx` + `components/IntakeForm.tsx`

**Files:**
- Create: `components/IntakeForm.tsx`
- Create: `app/test/page.tsx`

**Interfaces:**
- Consumes: `CATALOG_BY_CATEGORY`, `CatalogMetric` (Task 6); `POST /api/submit` (Task 8); BotID client from `botid/client`.
- Produces: a fully static (no Cloudbeds, no env needed to render) mobile-responsive intake form.

No unit test (pure presentational + network). Verified by the build + manual smoke in Task 13. Keep the catalog list server-rendered (page is a server component); the form interactivity lives in the client component.

- [ ] **Step 1: Create `components/IntakeForm.tsx`**

```tsx
"use client";

import { useState } from "react";
import { BotIdClient } from "botid/client";
import type { CatalogMetric } from "@/config/catalog-sample";

const TEAMS = ["Crystal", "Remote Property Managers", "Property Managers & Attendants", "Other"];

export default function IntakeForm({
  groups,
}: {
  groups: { category: string; metrics: CatalogMetric[] }[];
}) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [team, setTeam] = useState("");
  const [otherTeam, setOtherTeam] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const metrics = Object.keys(selected).filter((k) => selected[k]);
  const toggle = (k: string) => setSelected((s) => ({ ...s, [k]: !s[k] }));
  const effectiveTeam = team === "Other" ? otherTeam.trim() : team;
  const canSubmit =
    name.trim() && role.trim() && effectiveTeam && metrics.length > 0 && status !== "saving";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("saving");
    setErrorMsg("");
    const res = await fetch("/api/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, role, team: team === "Other" ? "Other" : team, metrics, notes }),
    });
    if (res.ok) {
      setStatus("done");
    } else {
      const b = await res.json().catch(() => ({}));
      setErrorMsg(b?.error || "Something went wrong. Please try again.");
      setStatus("error");
    }
  }

  if (status === "done") {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-center">
        <p className="text-lg font-semibold text-emerald-900">Thank you — your selections were recorded.</p>
        <p className="mt-1 text-sm text-emerald-700">
          {metrics.length} metric{metrics.length === 1 ? "" : "s"} submitted. You can close this page.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      {/* Register the public write path for BotID protection. */}
      <BotIdClient protect={[{ path: "/api/submit", method: "POST" }]} />

      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Name *</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Role *</span>
          <input
            value={role}
            onChange={(e) => setRole(e.target.value)}
            required
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Team *</span>
          <select
            value={team}
            onChange={(e) => setTeam(e.target.value)}
            required
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          >
            <option value="">Select…</option>
            {TEAMS.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </label>
      </div>

      {team === "Other" && (
        <label className="block">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Your team</span>
          <input
            value={otherTeam}
            onChange={(e) => setOtherTeam(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </label>
      )}

      <div>
        <p className="text-sm font-semibold text-slate-900">
          Which metrics do you want on your dashboard? <span className="text-slate-400">(pick at least one)</span>
        </p>
        <p className="mt-0.5 text-xs text-slate-500">
          Values shown are <span className="font-semibold">SAMPLE</span> data — not live figures.
        </p>
        <div className="mt-3 space-y-5">
          {groups.map((g) => (
            <fieldset key={g.category}>
              <legend className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                {g.category}
              </legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {g.metrics.map((m) => (
                  <label
                    key={m.key}
                    className={
                      "flex cursor-pointer items-start gap-3 rounded-lg border bg-white p-3 transition " +
                      (selected[m.key] ? "border-accent ring-1 ring-accent/30" : "border-slate-200 hover:border-slate-300")
                    }
                  >
                    <input
                      type="checkbox"
                      checked={!!selected[m.key]}
                      onChange={() => toggle(m.key)}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-slate-900">{m.name}</span>
                      <span className="block text-xs text-slate-500">{m.explanation}</span>
                      <span className="mt-1 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
                        SAMPLE: {m.sample}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
      </div>

      <label className="block">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Notes (optional)</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
        />
      </label>

      {status === "error" && <p className="text-sm text-red-600">{errorMsg}</p>}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded-lg bg-ink px-5 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {status === "saving" ? "Submitting…" : "Submit selections"}
        </button>
        <span className="text-xs text-slate-400">{metrics.length} selected</span>
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Create `app/test/page.tsx`**

```tsx
import IntakeForm from "@/components/IntakeForm";
import { CATALOG_BY_CATEGORY } from "@/config/catalog-sample";

// Public, no PIN (excluded in middleware matcher). Fully static — no Cloudbeds
// calls, no env needed to render. Sample values only (watermarked SAMPLE).
export const dynamic = "force-static";

export default function TestPage() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
      <header className="mb-6 rounded-xl bg-ink px-5 py-4 text-white shadow-sm sm:mb-8 sm:px-6 sm:py-5">
        <p className="text-xs font-medium uppercase tracking-widest text-white/60">
          Stayable · Dashboard Requirements
        </p>
        <h1 className="mt-1 text-2xl font-semibold sm:text-3xl">Tell us what to put on your dashboard</h1>
        <p className="mt-1 text-sm text-white/70">
          Browse the available metrics, pick the ones your team needs, and submit. No login required.
        </p>
      </header>

      <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        Please submit your selections within <span className="font-semibold">24 hours</span> if you can.
        The form stays open — there is no hard deadline.
      </div>

      <IntakeForm groups={CATALOG_BY_CATEGORY} />

      <p className="mt-8 text-xs text-slate-400">
        All values on this page are SAMPLE data for illustration only — not live Cloudbeds figures. No guest
        personal data is shown anywhere on this site.
      </p>
    </main>
  );
}
```

- [ ] **Step 3: Type-check + build (catches BotID client import + RSC boundaries)**

Run: `npx tsc --noEmit && npm run build`
Expected: build succeeds; `/test` is in the route list.

> If `BotIdClient`'s import path differs in the installed `botid` version, check `node_modules/botid` exports and adjust the import (e.g. `botid/client` vs `botid`). The build error will name it.

- [ ] **Step 4: Commit**

```bash
git add components/IntakeForm.tsx app/test/page.tsx
git commit -m "feat(test): public intake form with catalog + sample values"
```

---

## Task 11: Exec view — `components/ExecView.tsx`, `components/ExecFeedback.tsx`, `app/exec/page.tsx`

**Files:**
- Create: `components/ExecFeedback.tsx`
- Create: `components/ExecView.tsx`
- Create: `app/exec/page.tsx`

**Interfaces:**
- Consumes: `getPortfolio`, `getPortfolioInsights`, `getPortfolioLeaseMix` (Tasks 5 + existing), `resolveRange`, `priorWindow`, `priorMonthWindow`, `dayCount` (Task 4 + existing), `LeaseMix`, `PROPERTIES`.
- Produces: the exec dashboard at `/exec` — occupancy headline + WoW/MoM deltas, ranked leaderboard with exception flags, ADR/RevPAR per property + portfolio, lease-vs-transient mix, and Rob's feedback box. No revenue.

`ExecView` is presentational (client component for the leaderboard sort + tooltips). `app/exec/page.tsx` is the server component that fetches everything in parallel and computes deltas. `ExecFeedback` is a small client component posting to `/api/feedback`.

- [ ] **Step 1: Create `components/ExecFeedback.tsx`**

```tsx
"use client";

import { useState } from "react";

export default function ExecFeedback() {
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">("idle");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("saving");
    const res = await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes }),
    });
    if (res.ok) {
      setStatus("done");
      setNotes("");
    } else {
      setStatus("error");
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Feedback</p>
      <h2 className="mt-1 text-lg font-semibold text-slate-900">Leave a note on this dashboard</h2>
      <form onSubmit={submit} className="mt-3 space-y-3">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="What would you change, add, or remove?"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
        />
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={!notes.trim() || status === "saving"}
            className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {status === "saving" ? "Sending…" : "Send feedback"}
          </button>
          {status === "done" && <span className="text-sm text-emerald-600">Thanks — recorded.</span>}
          {status === "error" && <span className="text-sm text-red-600">Could not send. Try again.</span>}
        </div>
      </form>
    </section>
  );
}
```

- [ ] **Step 2: Create `components/ExecView.tsx`**

```tsx
"use client";

import ExecFeedback from "@/components/ExecFeedback";

export type ExecProperty = {
  code: string;
  name: string;
  county: string;
  id: string;
  occupancy: number | null; // range avg %, capacity-adjusted
  adr: number | null;
  revpar: number | null;
  lease: { monthly: number; weekly: number; transient: number; total: number } | null;
  excludeDefault: boolean;
};

export type ExecData = {
  portfolioOcc: number | null;
  wow: number | null; // delta in percentage points vs prior equal window
  mom: number | null; // delta vs prior month
  portfolioAdr: number | null;
  portfolioRevpar: number | null;
  portfolioLease: { monthly: number; weekly: number; transient: number; total: number };
  rangeLabel: string;
  leaseAsOf: string;
  properties: ExecProperty[];
};

function pct(n: number | null) {
  return n === null ? "—" : `${n.toFixed(1)}%`;
}
function money(n: number | null) {
  return n === null ? "—" : `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function Delta({ value, label }: { value: number | null; label: string }) {
  if (value === null) return <span className="text-xs text-slate-400">{label} —</span>;
  const up = value >= 0;
  return (
    <span className={"text-xs font-medium " + (up ? "text-emerald-600" : "text-red-600")}>
      {label} {up ? "▲" : "▼"} {Math.abs(value).toFixed(1)} pts
    </span>
  );
}
function leasePctParts(l: { monthly: number; weekly: number; transient: number; total: number } | null) {
  if (!l || l.total <= 0) return null;
  const f = (n: number) => (n / l.total) * 100;
  return { monthly: f(l.monthly), weekly: f(l.weekly), transient: f(l.transient) };
}

export default function ExecView({ data }: { data: ExecData }) {
  const ranked = [...data.properties].sort((a, b) => (b.occupancy ?? -1) - (a.occupancy ?? -1));
  const lp = leasePctParts(data.portfolioLease);

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Occupancy headline + trend */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Portfolio Occupancy</p>
          <span className="text-xs text-slate-400">{data.rangeLabel}</span>
        </div>
        <span className="mt-1 block text-5xl font-semibold text-slate-900 sm:text-6xl">{pct(data.portfolioOcc)}</span>
        <div className="mt-2 flex gap-4">
          <Delta value={data.wow} label="WoW" />
          <Delta value={data.mom} label="MoM" />
        </div>
      </section>

      {/* ADR / RevPAR portfolio KPIs */}
      <section className="grid grid-cols-2 gap-3 sm:gap-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">ADR (portfolio)</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900 sm:text-3xl">{money(data.portfolioAdr)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">RevPAR (portfolio)</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900 sm:text-3xl">{money(data.portfolioRevpar)}</p>
        </div>
      </section>

      {/* Leaderboard */}
      <section>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
          Property leaderboard — occupancy, best to worst
        </p>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="bg-ink text-left text-xs uppercase tracking-wide text-white/70">
                <th className="px-4 py-3 font-medium">#</th>
                <th className="px-4 py-3 font-medium">Property</th>
                <th className="px-4 py-3 font-medium">Occupancy</th>
                <th className="px-4 py-3 font-medium">ADR</th>
                <th className="px-4 py-3 font-medium">RevPAR</th>
                <th className="px-4 py-3 font-medium">Flags</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((p, i) => {
                const low = p.occupancy !== null && p.occupancy < 5;
                return (
                  <tr key={p.code} className="border-t border-slate-100">
                    <td className="px-4 py-3 text-slate-400">{i + 1}</td>
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {p.name} <span className="text-xs text-slate-400">· {p.county}</span>
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-900">{pct(p.occupancy)}</td>
                    <td className="px-4 py-3 text-slate-700">{money(p.adr)}</td>
                    <td className="px-4 py-3 text-slate-700">{money(p.revpar)}</td>
                    <td className="px-4 py-3">
                      {low && (
                        <span className="rounded bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
                          near-zero occ
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Lease vs Transient */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Lease vs Transient (in-house)</p>
          <span className="text-xs text-slate-400">as of {data.leaseAsOf}</span>
        </div>
        {lp ? (
          <>
            <div className="mt-3 flex h-3 w-full overflow-hidden rounded-full bg-slate-100">
              <div className="h-full bg-accent" style={{ width: `${lp.monthly}%` }} title={`Monthly lease ${lp.monthly.toFixed(1)}%`} />
              <div className="h-full bg-accent/60" style={{ width: `${lp.weekly}%` }} title={`Weekly lease ${lp.weekly.toFixed(1)}%`} />
              <div className="h-full bg-slate-300" style={{ width: `${lp.transient}%` }} title={`Transient ${lp.transient.toFixed(1)}%`} />
            </div>
            <div className="mt-3 grid grid-cols-3 gap-3 text-center">
              <div><p className="text-xs text-slate-500">Monthly lease</p><p className="text-lg font-semibold text-slate-900">{lp.monthly.toFixed(1)}%</p></div>
              <div><p className="text-xs text-slate-500">Weekly lease</p><p className="text-lg font-semibold text-slate-900">{lp.weekly.toFixed(1)}%</p></div>
              <div><p className="text-xs text-slate-500">Transient</p><p className="text-lg font-semibold text-slate-900">{lp.transient.toFixed(1)}%</p></div>
            </div>
          </>
        ) : (
          <p className="mt-2 text-sm text-slate-400">No in-house rooms for the as-of date.</p>
        )}
      </section>

      <ExecFeedback />
    </div>
  );
}
```

- [ ] **Step 3: Create `app/exec/page.tsx`**

```tsx
import ExecView, { type ExecData, type ExecProperty } from "@/components/ExecView";
import { resolveRange, priorWindow, priorMonthWindow } from "@/lib/dates";
import { getPortfolioInsights, getPortfolioLeaseMix } from "@/lib/cloudbeds";
import PeriodControls from "@/components/PeriodControls";

export const dynamic = "force-dynamic";

// Capacity-adjusted average occupancy over a property's daily rows.
function avgOcc(rows: { occupancy: number }[]): number | null {
  return rows.length ? rows.reduce((s, r) => s + r.occupancy, 0) / rows.length : null;
}
// Capacity-weighted portfolio occupancy (simple mean of reporting props for the
// delta baseline; matches the headline's intent without re-fetching capacity).
function portfolioMean(values: (number | null)[]): number | null {
  const v = values.filter((x): x is number => x !== null);
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
}

export default async function ExecPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; start?: string; end?: string }>;
}) {
  const sp = await searchParams;
  const { preset, start, end } = resolveRange(sp.preset, sp.start, sp.end);
  const pw = priorWindow(start, end);
  const pm = priorMonthWindow(start, end);

  const [cur, prevW, prevM, lease] = await Promise.all([
    getPortfolioInsights(start, end),
    getPortfolioInsights(pw.start, pw.end),
    getPortfolioInsights(pm.start, pm.end),
    getPortfolioLeaseMix(end), // in-house mix as of the range end
  ]);

  const leaseByCode = new Map(lease.map((l) => [l.property.code, l]));
  const prevWByCode = new Map(prevW.map((p) => [p.property.code, p]));
  const prevMByCode = new Map(prevM.map((p) => [p.property.code, p]));

  const properties: ExecProperty[] = cur.map((ins) => {
    const rows = ins.result?.ok ? ins.result.data : [];
    const occ = avgOcc(rows);
    const adr = rows.length ? rows.reduce((s, r) => s + r.adr, 0) / rows.length : null;
    const revpar = rows.length ? rows.reduce((s, r) => s + r.revpar, 0) / rows.length : null;
    const lm = leaseByCode.get(ins.property.code);
    return {
      code: ins.property.code,
      name: ins.property.name,
      county: ins.property.county,
      id: ins.property.id,
      occupancy: occ,
      adr,
      revpar,
      lease: lm?.result?.ok ? lm.result.data : null,
      excludeDefault: !!ins.property.excludeFromAggregate,
    };
  });

  // Portfolio occupancy + deltas (exclude default-off props, e.g. JN).
  const included = properties.filter((p) => !p.excludeDefault);
  const portfolioOcc = portfolioMean(included.map((p) => p.occupancy));
  const prevWOcc = portfolioMean(
    cur.filter((i) => !i.property.excludeFromAggregate).map((i) => {
      const r = prevWByCode.get(i.property.code);
      return r?.result?.ok ? avgOcc(r.result.data) : null;
    }),
  );
  const prevMOcc = portfolioMean(
    cur.filter((i) => !i.property.excludeFromAggregate).map((i) => {
      const r = prevMByCode.get(i.property.code);
      return r?.result?.ok ? avgOcc(r.result.data) : null;
    }),
  );

  const portfolioAdr = portfolioMean(included.map((p) => p.adr));
  const portfolioRevpar = portfolioMean(included.map((p) => p.revpar));
  const portfolioLease = included.reduce(
    (acc, p) => {
      if (p.lease) {
        acc.monthly += p.lease.monthly;
        acc.weekly += p.lease.weekly;
        acc.transient += p.lease.transient;
        acc.total += p.lease.total;
      }
      return acc;
    },
    { monthly: 0, weekly: 0, transient: 0, total: 0 },
  );

  const data: ExecData = {
    portfolioOcc,
    wow: portfolioOcc !== null && prevWOcc !== null ? portfolioOcc - prevWOcc : null,
    mom: portfolioOcc !== null && prevMOcc !== null ? portfolioOcc - prevMOcc : null,
    portfolioAdr,
    portfolioRevpar,
    portfolioLease,
    rangeLabel: start === end ? start : `${start} → ${end}`,
    leaseAsOf: end,
    properties,
  };

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <header className="mb-6 rounded-xl bg-ink px-5 py-4 text-white shadow-sm sm:mb-8 sm:px-6 sm:py-5">
        <p className="text-xs font-medium uppercase tracking-widest text-white/60">
          Stayable · Executive Dashboard
        </p>
        <h1 className="mt-1 text-2xl font-semibold sm:text-3xl">Portfolio Performance</h1>
      </header>

      <section className="mb-6">
        <PeriodControls preset={preset} start={start} end={end} />
      </section>

      <ExecView data={data} />

      <p className="mt-6 text-xs text-slate-400">
        Occupancy/ADR/RevPAR are daily averages over the selected range (Cloudbeds Data Insights).
        Lease vs Transient is an in-house snapshot as of {end}, derived from rate plan only — no guest PII.
        Revenue is intentionally excluded. Aggregated metrics only · read-only · cached up to 10 min.
      </p>
    </main>
  );
}
```

> The `PeriodControls` component currently navigates with `searchParams` on the current path, so it works on `/exec` unchanged. If it hardcodes `/`, change it to use `usePathname()` — check `components/PeriodControls.tsx` during this step and adjust only if needed.

- [ ] **Step 4: Type-check + build**

Run: `npx tsc --noEmit && npm run build`
Expected: build succeeds; `/exec` appears in the route list.

- [ ] **Step 5: Commit**

```bash
git add components/ExecView.tsx components/ExecFeedback.tsx app/exec/page.tsx
git commit -m "feat(exec): CEO view — occupancy/WoW/MoM, leaderboard, ADR/RevPAR, lease mix, feedback"
```

---

## Task 12: Submissions export script (`scripts/export-submissions.mjs`)

**Files:**
- Create: `scripts/export-submissions.mjs`

**Interfaces:**
- Consumes: Neon `DATABASE_URL` from `.env.local`; the `submissions` table.
- Produces: `outputs/Submissions_Stayable_<MMDDYY>.xlsx` with IB-clean formatting.

No unit test (one-shot operational script, like `db-init.mjs`). Uses the same `.env.local` loader pattern. For xlsx generation in Node without adding a heavy dependency, use the `exceljs` package (add as a devDependency) — it is the Node equivalent of the Python openpyxl styling already used for the catalog.

- [ ] **Step 1: Add the xlsx writer dependency**

Run: `npm install -D exceljs`

- [ ] **Step 2: Create `scripts/export-submissions.mjs`**

```js
// Read-only export: dump the submissions table to an IB-formatted xlsx in
// outputs/. Run:  node scripts/export-submissions.mjs
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import ExcelJS from "exceljs";

// load .env.local (no dep)
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}
const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) { console.error("No DATABASE_URL in .env.local"); process.exit(1); }

const sql = neon(url);
const rows = await sql`
  select id, created_at, source, name, role, team, metrics, notes
  from submissions order by created_at desc
`;

const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet("Submissions", { views: [{ state: "frozen", ySplit: 1 }] });
ws.columns = [
  { header: "ID", key: "id", width: 6 },
  { header: "Submitted (UTC)", key: "created_at", width: 22 },
  { header: "Source", key: "source", width: 16 },
  { header: "Name", key: "name", width: 20 },
  { header: "Role", key: "role", width: 22 },
  { header: "Team", key: "team", width: 28 },
  { header: "Metrics", key: "metrics", width: 60 },
  { header: "Notes", key: "notes", width: 50 },
];
// IB-clean dark header
ws.getRow(1).eachCell((c) => {
  c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B1F3A" } };
  c.font = { name: "Arial", bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
  c.alignment = { vertical: "middle", horizontal: "left" };
});
for (const r of rows) {
  ws.addRow({
    id: Number(r.id),
    created_at: new Date(r.created_at).toISOString().replace("T", " ").slice(0, 19),
    source: r.source,
    name: r.name ?? "",
    role: r.role ?? "",
    team: r.team ?? "",
    metrics: Array.isArray(r.metrics) ? r.metrics.join(", ") : (r.metrics ?? ""),
    notes: r.notes ?? "",
  });
}
ws.eachRow((row, i) => {
  row.eachCell((c) => {
    c.font = c.font?.bold ? c.font : { name: "Arial", size: 10 };
    c.alignment = { vertical: "top", wrapText: true, ...(c.alignment || {}) };
  });
  if (i > 1 && i % 2 === 0) row.eachCell((c) => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEF1F6" } };
  });
});

// filename: Submissions_Stayable_<MMDDYY>
const d = new Date();
const mmddyy = `${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}${String(d.getFullYear()).slice(-2)}`;
const out = new URL(`../outputs/Submissions_Stayable_${mmddyy}.xlsx`, import.meta.url);
await wb.xlsx.writeFile(out);
console.log("saved:", out.pathname, "| rows:", rows.length);
```

- [ ] **Step 3: Smoke-run (requires `DATABASE_URL` and at least the table existing)**

Run: `node scripts/export-submissions.mjs`
Expected: `saved: .../outputs/Submissions_Stayable_<MMDDYY>.xlsx | rows: N` (N may be 0 if no submissions yet — still produces a valid file with headers).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json scripts/export-submissions.mjs
git commit -m "feat(scripts): export submissions to IB-formatted xlsx"
```

---

## Task 13: End-to-end verification, lease-mix sanity check, docs

**Files:**
- Modify: `.env.example`
- Modify: `CLAUDE.md` (§6 DB reversal note), `TODO.md` (mark Phase items, update Pickup)

**Interfaces:** none (verification + docs only).

- [ ] **Step 1: Full test + build gate**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: all unit tests PASS; no type errors; build lists routes `/`, `/exec`, `/test`, `/login`, `/api/auth`, `/api/submit`, `/api/feedback`.

- [ ] **Step 2: Lease-mix sanity check vs `getDashboard` (spec §5, §10)**

With `npm run dev` running and the base/exec PINs in `.env.local`, fetch `/exec` (exec PIN) and read the Davenport lease total; separately run a quick check that the in-house lease `total` is in the same ballpark as Davenport's live `inHouse` from `getDashboard`. Use this scratch check:

```bash
node -e "import('./scripts/probe-lease-query.mjs')" 2>/dev/null || node scripts/probe-lease-query.mjs
```

Compare the summed room count to the dashboard in-house count for today. If they diverge materially, the overlap filter or the room measure is wrong — adjust the column names in `lib/cloudbeds.ts` `getLeaseMix` (Task 5, Step 3) and/or the keyword lists in `lib/lease.ts`, then re-run `npm test`. **Record the verified column names in a comment in `lib/cloudbeds.ts`.**

- [ ] **Step 3: Manual route smoke (local)**

- `/test` loads with NO PIN, shows the catalog with SAMPLE watermarks, submits successfully (check a row lands: `node scripts/export-submissions.mjs` then open the xlsx, or query Neon).
- `/login` with base PIN → reaches `/` but `/exec` redirects back to `/login?next=/exec`.
- `/login` with exec PIN (`STYBLCEO`) → reaches both `/` and `/exec`; feedback box submits (row with `source='exec-feedback'`).
- Confirm no secrets in the client bundle: `npm run build` then `grep -r "DATABASE_URL\|cbat_\|STYBLCEO" .next/static` returns nothing.

- [ ] **Step 4: Update `.env.example`**

Add (preserve existing content):

```
# Exec dashboard PIN (role-based gate). Unlocks /exec AND base /.
EXEC_PIN=STYBLCEO

# Neon Postgres (server-only). Pooled connection string from the Neon console /
# Vercel Storage tab. Required for /api/submit and /api/feedback.
DATABASE_URL=postgresql://...
```

- [ ] **Step 5: Update `CLAUDE.md` §6 and `TODO.md`**

In `CLAUDE.md` §5 rule 6 / §6, replace the "No database" absolute with a note that Neon Postgres is now used for `/test` submissions and exec feedback (one `submissions` table; server-only; no guest PII), keeping Cloudbeds itself read-and-cache only. In `TODO.md`, check off the three-dashboard items, the mobile-responsive Phase 6 item, and rewrite the Pickup marker to the next real action (Vercel env: set `EXEC_PIN`; deploy; DNS).

- [ ] **Step 6: Set Vercel env + deploy (only if asked — CLAUDE.md §8 says no PR/deploy without permission)**

Document the command for the operator rather than running it unprompted:
`vercel env add EXEC_PIN production` (value `STYBLCEO`) and ensure `DATABASE_URL` is already set (it is, per TODO provisioning). Then redeploy.

- [ ] **Step 7: Commit**

```bash
git add .env.example CLAUDE.md TODO.md
git commit -m "docs: EXEC_PIN, Neon DB reversal note, TODO/Phase updates"
```

---

## Self-Review (completed against the spec)

**Spec coverage:**
- §2 role/PIN model → Tasks 1, 2. `?next=` → Task 2. `/test` excluded + `/api/submit` public → Task 2 matcher.
- §3 base unchanged → untouched; base now also accepts exec token (Task 1 `decideAccess`).
- §4 exec: occupancy+WoW/MoM+leaderboard, ADR/RevPAR, lease mix, feedback box, revenue excluded → Task 11 (+ Tasks 4, 5).
- §5 lease classification + named keyword constants + in-house as-of snapshot + validation → Tasks 3, 5, 13.
- §6 intake form (catalog menu w/ sample values + checkboxes, fields incl. team taxonomy + Other, ≥1 metric, soft 24h banner, mobile) → Tasks 6, 10.
- §6a persistence (one table, both sources), `/api/submit` public+BotID+validation, `/api/feedback` exec-gated, export script → Tasks 7, 8, 9, 12.
- §7 no new key / no Guest scope / public-write posture → enforced in Tasks 3, 5, 8 (no Cloudbeds in /test; BotID + validation + rate-limit).
- §8 components/files table → all mapped in File Structure.
- §10 testing (lease units, middleware access, route validation, catalog offline, lease sanity) → Tasks 1, 3, 6, 8, 9, 13.

**Placeholder scan:** The only deliberate "port the rest" instruction is the catalog `RAW` array (Task 6) — it cites exact source lines (`scripts/build-catalog.py` 97–213) and shows the exact transform + 3 sample rows; this is mechanical transcription of existing repo data, not an undefined placeholder. The lease-mix column names (Task 5) are intentionally probe-confirmed before implementation, with documented fallbacks — flagged as the one genuine live-API uncertainty.

**Type consistency:** `LeaseMix` shape `{monthly,weekly,transient,total}` is identical across Tasks 5, 7-usage, 11. `tokenFor(level,pin)`, `decideAccess`, `expectedTokens` signatures match between Tasks 1, 2, 9. `CatalogMetric`/`CATALOG_BY_CATEGORY` match between Tasks 6 and 10. `ExecData`/`ExecProperty` defined in Task 11 `ExecView` and consumed by `app/exec/page.tsx` in the same task.

**Known risk (called out, not hidden):** the DI dataset-3 in-house overlap query (Task 5) is the one piece not verifiable without the live API; Task 5 probes first and Task 13 validates against `getDashboard`.
