# Ops Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a role-based, PIN-gated Ops Dashboard at `/ops` showing Occupancy (live), Lease (placeholder pending API), and Evictions (live).

**Architecture:** Reuse the existing signed-cookie level gate and shared section component library. Register a new `ops` level (route `/ops`, PIN `OPS`, env fallback `OPS_PIN`) exactly like the per-user dashboards, then compose a page from existing section components plus one static "pending" block.

**Tech Stack:** Next.js App Router (server components), TypeScript, Neon Postgres (PIN store, unchanged), Vitest, Tailwind.

## Global Constraints

- Branch: `claude/nifty-thompson-ts8zny`. Do NOT open a PR (CLAUDE.md §8).
- No `NEXT_PUBLIC_` on any secret; Cloudbeds stays server-side, read-only (§5).
- No guest PII — only aggregate/operational sections (§5 rule 2).
- Header title MUST read exactly **Ops Dashboard**.
- Level name MUST be exactly `ops`; route `/ops`; env var `OPS_PIN`; PIN value `OPS`.
- Section order: Occupancy → Lease → Evictions.
- No DB schema change; no Cloudbeds scope change; no changes to other dashboards.
- Commit messages end with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer.

---

## File Structure

- `lib/auth.ts` (modify) — add `ops` to the level union, level lists, and PIN maps. Owns the level taxonomy.
- `lib/pins.ts` (modify) — add `ops` to the PIN→level resolution order. Owns login PIN matching.
- `lib/__tests__/auth.test.ts` (modify) — extend coverage to the `ops` level.
- `app/ops/page.tsx` (create) — the Ops Dashboard page. Owns the Ops view composition.
- `TODO.md` (modify) — record the shipped item + the manual `OPS_PIN` Vercel step.

---

## Task 1: Register the `ops` level (auth + pins)

**Files:**
- Modify: `lib/auth.ts`
- Modify: `lib/pins.ts:37` (the `order` array in `findLevelByPin`)
- Test: `lib/__tests__/auth.test.ts`

**Interfaces:**
- Consumes: existing `Level` union, `USER_PINS`, `ENV_PIN_FOR`, `ALL_LEVELS`, `requiredLevel`, `homeForLevel`, `canAccess` from `lib/auth.ts`.
- Produces: `Level` now includes `"ops"`; `requiredLevel("/ops") === "ops"`; `homeForLevel("ops") === "/ops"`; `canAccess("ops","/ops") === true`, `canAccess("ops","/monica") === false`, `canAccess("exec","/ops") === true`. No signature changes — only the taxonomy widens.

- [ ] **Step 1: Write the failing tests**

Add these cases to `lib/__tests__/auth.test.ts`. Extend the existing `requiredLevel`, `homeForLevel`, and `canAccess` blocks by appending the new assertions inside their existing `it(...)` bodies:

In the `requiredLevel` test (`it("maps /rob → exec, ...")`), add:
```ts
    expect(requiredLevel("/ops")).toBe("ops");
```

In the `homeForLevel` test (`it("routes each level to its own dashboard")`), add:
```ts
    expect(homeForLevel("ops")).toBe("/ops");
```

In the `canAccess` test, add a new `it` block:
```ts
  it("ops reaches only /ops; exec still sees it", () => {
    expect(canAccess("ops", "/ops")).toBe(true);
    expect(canAccess("ops", "/monica")).toBe(false);
    expect(canAccess("ops", "/")).toBe(false);
    expect(canAccess("exec", "/ops")).toBe(true);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/__tests__/auth.test.ts`
Expected: FAIL — `requiredLevel("/ops")` returns `"base"` (not `"ops"`), and TypeScript/assertion errors on the unknown `"ops"` level.

- [ ] **Step 3: Implement — widen the level taxonomy in `lib/auth.ts`**

Make these four edits:

Change the `Level` type (line 13):
```ts
export type Level = "base" | "exec" | "crystal" | "monica" | "bea" | "ops";
```

Add `ops` to `USER_PINS` (after the `bea` entry):
```ts
export const USER_PINS: { level: Exclude<Level, "base" | "exec">; envVar: string }[] = [
  { level: "crystal", envVar: "CRYSTAL_PIN" },
  { level: "monica", envVar: "MONICA_PIN" },
  { level: "bea", envVar: "BEA_PIN" },
  { level: "ops", envVar: "OPS_PIN" },
];
```

Add `ops` to `ENV_PIN_FOR`:
```ts
export const ENV_PIN_FOR: Record<Level, string> = {
  base: "DASHBOARD_PIN",
  exec: "EXEC_PIN",
  crystal: "CRYSTAL_PIN",
  monica: "MONICA_PIN",
  bea: "BEA_PIN",
  ops: "OPS_PIN",
};
```

Add `ops` to `ALL_LEVELS`:
```ts
export const ALL_LEVELS: Level[] = ["base", "exec", "crystal", "monica", "bea", "ops"];
```

`requiredLevel`, `homeForLevel`, and `canAccess` need NO change — they already
derive behavior from `USER_PINS`. (`requiredLevel` finds `ops` via `USER_PINS`;
`homeForLevel` falls through to `` `/${level}` `` → `/ops`; `canAccess` treats
`ops` as a non-base user level reaching only its own route.)

- [ ] **Step 4: Implement — add `ops` to PIN resolution in `lib/pins.ts`**

In `findLevelByPin` (line 37), add `"ops"` to the `order` array:
```ts
  const order: Level[] = ["exec", "crystal", "monica", "bea", "ops"];
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run lib/__tests__/auth.test.ts`
Expected: PASS — all `ops` assertions green, existing cases still pass.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (the `Record<Level, …>` maps now cover `ops`; if any switch/map over `Level` is non-exhaustive, the compiler flags it here).

- [ ] **Step 7: Commit**

```bash
git add lib/auth.ts lib/pins.ts lib/__tests__/auth.test.ts
git commit -m "feat(ops): register ops level (route /ops, PIN OPS, env OPS_PIN)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Build the `/ops` page + update TODO

**Files:**
- Create: `app/ops/page.tsx`
- Modify: `TODO.md`

**Interfaces:**
- Consumes: `OccupancyView`, `PeriodControls`, `EvictionsSection`, `ChangePin`, `SectionNav` (with `NavItem`) from `@/components/*`; `resolveRange`, `dayCount` from `@/lib/dates`; `getPortfolio`, `getPortfolioInsights` from `@/lib/cloudbeds`; `getEvictions` from `@/lib/smartsheet`; `buildOccProperties` from `@/lib/occupancy`. These are the exact symbols `app/monica/page.tsx` imports — reuse the same signatures.
- Produces: a server-rendered page at `/ops`. No exports consumed by other tasks.

> Note: this is an async server component composing existing components. There is
> no unit-test harness for pages in this repo (no `app/**/page.test.tsx` exists),
> so verification is a clean production build plus a manual browser check — not a
> Vitest test. Do not invent a page test; follow the build+manual steps below.

- [ ] **Step 1: Create `app/ops/page.tsx`**

```tsx
import Link from "next/link";
import OccupancyView from "@/components/OccupancyView";
import PeriodControls from "@/components/PeriodControls";
import EvictionsSection from "@/components/EvictionsSection";
import ChangePin from "@/components/ChangePin";
import SectionNav, { type NavItem } from "@/components/SectionNav";
import { dayCount, resolveRange } from "@/lib/dates";
import { getPortfolio, getPortfolioInsights } from "@/lib/cloudbeds";
import { getEvictions } from "@/lib/smartsheet";
import { buildOccProperties } from "@/lib/occupancy";

// Ops Dashboard — role-based (not person-named) operational view. Gated to the
// ops level (OPS_PIN) OR exec/CEO. Occupancy + Evictions are live; Lease is a
// placeholder pending the Cloudbeds DI Reservations API access request.
export const dynamic = "force-dynamic";

const NAV: NavItem[] = [
  { id: "occupancy", label: "Occupancy", n: 1 },
  { id: "lease", label: "Lease", n: 2 },
  { id: "evictions", label: "Evictions", n: 3 },
];

function SectionHeading({ n, title, sub }: { n: number; title: string; sub: string }) {
  return (
    <div className="mb-3 flex items-baseline gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-semibold text-white">
        {n}
      </span>
      <div>
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        <p className="text-xs text-slate-500">{sub}</p>
      </div>
    </div>
  );
}

export default async function OpsPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; start?: string; end?: string }>;
}) {
  const sp = await searchParams;
  const { preset, start, end } = resolveRange(sp.preset, sp.start, sp.end);

  const [portfolio, insights, evictions] = await Promise.all([
    getPortfolio(),
    getPortfolioInsights(start, end),
    getEvictions(),
  ]);

  const properties = buildOccProperties(portfolio, insights);
  const days = dayCount(start, end);
  const rangeLabel = start === end ? start : `${start} → ${end}`;

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <header className="mb-6 rounded-xl bg-ink px-5 py-4 text-white shadow-sm sm:mb-8 sm:px-6 sm:py-5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-medium uppercase tracking-widest text-white/60">
            Stayable · Operations
          </p>
          <Link
            href="/"
            className="shrink-0 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/20"
          >
            ← Dashboard
          </Link>
        </div>
        <h1 className="mt-1 text-2xl font-semibold sm:text-3xl">Ops Dashboard</h1>
        <p className="mt-1 text-sm text-white/70">
          Operational view — occupancy, lease mix, and evictions across the portfolio.
        </p>
      </header>

      <div className="lg:flex lg:gap-8">
        <SectionNav items={NAV} />

        <div className="min-w-0 flex-1">
          <section id="occupancy" className="mb-10 scroll-mt-20 lg:scroll-mt-6">
            <SectionHeading
              n={1}
              title="Occupancy"
              sub={`${rangeLabel} · ${days} day${days === 1 ? "" : "s"} · Eastern`}
            />
            <div className="mb-4">
              <PeriodControls preset={preset} start={start} end={end} />
            </div>
            <OccupancyView properties={properties} exportDate={end} />
          </section>

          <section id="lease" className="mb-10 scroll-mt-20 lg:scroll-mt-6">
            <SectionHeading n={2} title="Lease" sub="Lease vs. transient mix · per property" />
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-center">
              <p className="text-sm font-semibold text-slate-700">Pending Cloudbeds API access</p>
              <p className="mt-1 text-xs text-slate-500">
                Lease vs. transient mix (from Data Insights Reservations) goes live once the
                API scope request is granted. No data is shown until then.
              </p>
            </div>
          </section>

          <section id="evictions" className="mb-10 scroll-mt-20 lg:scroll-mt-6">
            <SectionHeading n={3} title="Evictions" sub="Live from Smartsheet · counts only · no case detail" />
            <EvictionsSection
              configured={evictions.configured}
              error={evictions.error}
              views={evictions.views}
              asOf={end}
            />
          </section>

          <p className="mb-6 text-xs text-slate-400">
            Aggregated metrics only · no guest PII · read-only · cached up to 10 min. Only
            properties with a configured Cloudbeds key report (Davenport today).
          </p>

          <ChangePin />
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Verify the production build compiles**

Run: `npm run build`
Expected: build succeeds; output lists a route for `/ops`. No type errors.

- [ ] **Step 3: Manual smoke check (record result; do not skip)**

Run: `npm run dev`, then in a browser:
1. Visit `/ops` unauthenticated → redirected to `/login?next=%2Fops`. ✅
2. Enter PIN `OPS` (requires `OPS_PIN=OPS` in `.env.local` for local test) → lands on `/ops`, header reads **Ops Dashboard**. ✅
3. Sidebar nav shows Occupancy / Lease / Evictions; clicking each scrolls to its section. ✅
4. Occupancy renders with the period controls + per-property/All toggle; Evictions renders from Smartsheet; Lease shows the "Pending Cloudbeds API access" block. ✅
5. (Optional) Log in with the exec PIN and confirm `/ops` is reachable.

If any check fails, fix before committing and note what failed.

- [ ] **Step 4: Update `TODO.md`**

Add an entry under the current sprint recording: Ops Dashboard shipped (`/ops`, sections Occupancy + Evictions live, Lease placeholder pending API), and a manual action item: **set `OPS_PIN=OPS` in Vercel env** (group it with the open `EXEC_PIN` env task). Also note "Lease section: flip placeholder to live data when DI Reservations API access lands" and "add remaining Ops sections (Live now, Out of service, …) next week".

- [ ] **Step 5: Commit**

```bash
git add app/ops/page.tsx TODO.md
git commit -m "feat(ops): Ops Dashboard page — Occupancy + Evictions live, Lease pending

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Post-implementation (manual, outside this plan)

- **Vercel:** add env var `OPS_PIN = OPS` (Production + Preview). Until set, the
  gate stays closed for the ops level unless a `dashboard_pins` row exists.
- **When the Lease API lands:** replace the placeholder block in
  `app/ops/page.tsx#section#lease` with a real lease-vs-transient component fed
  from DI Reservations (dataset id 3) — separate change, separate plan if large.

---

## Self-Review

**Spec coverage:**
- §2 access/identity → Task 1 (level, route, PIN, env, exec visibility). ✅
- §3 sections (Occupancy live, Lease placeholder, Evictions live; order; sidebar nav; per-property toggle) → Task 2. ✅
- §4 change set (lib/auth.ts, lib/pins.ts, app/ops/page.tsx, middleware.ts verify-only, TODO, Vercel env) → Tasks 1–2 + Post-implementation. middleware.ts needs no edit (matcher already gates non-base routes); covered by Task 2 Step 3 check #1. ✅
- §6 security → no `NEXT_PUBLIC_`, no PII, read-only — honored in Task 2 code + Global Constraints. ✅
- §7 acceptance criteria 1–7 → Task 1 tests (3,4) + Task 2 manual checks (1,2,5,6) + build (7). ✅

**Placeholder scan:** No TBD/TODO-in-code/"handle edge cases"/vague steps. The Lease "placeholder" is a concrete, fully-specified static block, not a plan placeholder. ✅

**Type consistency:** `Level` widened once in Task 1 and used consistently; `NavItem` shape (`{id,label,n}`) matches `app/monica/page.tsx`; component props (`OccupancyView`, `EvictionsSection`) copied verbatim from the working Monica page. ✅
