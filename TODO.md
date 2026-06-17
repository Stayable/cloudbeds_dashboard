# TODO — Cloudbeds Dashboard

Status legend: `[ ]` open · `[~]` in progress · `[x]` done · `[?]` needs decision

---

## Phase 0 — Decisions & access (do before building)

- [?] **URL**: confirm `dashboard.rentstayable.com` (recommended) vs.
      `rentstayable.com/dashboard`. Affects DNS + Vercel config.
- [?] **Public access posture**: fully public, unguessable URL, or Vercel
      password protection? (Revenue data is sensitive — see CLAUDE.md §5.)
- [ ] **Cloudbeds API permissions**: Kyle to share the scope/permission options.
      Confirm read scopes for dashboard, reservations, rooms, property info.
- [ ] **Auth method**: OAuth 2.0 client credentials vs. API key — pick one.
- [ ] **Active properties**: confirm which **6 of 8** are live in Cloudbeds and
      get exact property IDs verified.
- [ ] **Pilot scope**: confirm Davenport (44199) as the first property to wire.
- [ ] Confirm Vercel account/team to deploy under (Vercel MCP is connected).

## Phase 1 — Scaffold (planning files) ✅ this PR

- [x] `CLAUDE.md` — project guidance & context.
- [x] `TODO.md` — this roadmap.
- [x] `start-claude.bat` — Windows launcher (pull + run Claude Code).
- [x] `scripts/clone-repo.ps1` — PowerShell clone helper.

## Phase 2 — App skeleton

- [ ] Initialize Next.js (App Router) + TypeScript.
- [ ] `config/properties.ts` — property list with IDs (start: Davenport 44199).
- [ ] Server-side Cloudbeds API client (env-var creds, no browser exposure).
- [ ] `.env.example` documenting required env vars (no real secrets committed).
- [ ] Server-side response caching (5–15 min TTL).

## Phase 3 — Occupancy view (pilot: Davenport)

- [ ] Daily occupancy for Davenport (44199).
- [ ] Daily/weekly/monthly toggle (weekly & monthly aggregate daily data).
- [ ] Verify numbers against Cloudbeds UI for the same dates.

## Phase 4 — Portfolio status metrics

- [ ] Per-property + portfolio occupancy %.
- [ ] Rooms sold / available / out-of-order / total.
- [ ] ADR and RevPAR.
- [ ] Today: arrivals / departures / in-house / stayovers (counts only).
- [ ] Period revenue.
- [ ] Pace/pickup (if available — confirm).
- [ ] Expand from Davenport to the other active properties.

## Phase 5 — Deploy

- [ ] Set env vars in Vercel (server-side secrets).
- [ ] Deploy to Vercel.
- [ ] Apply chosen access posture (password protection / unguessable URL).
- [ ] Wire DNS for chosen URL.
- [ ] Smoke test: data loads, no PII exposed, no secrets in client bundle.

## Phase 6 — Hardening

- [ ] Loading / empty / error states per property.
- [ ] Rate-limit handling & graceful degradation if Cloudbeds is down.
- [ ] Mobile-responsive layout (IB-clean aesthetic: dark headers, clean grid).
- [ ] Auto-refresh interval for the live view.

---

## Open questions for Kyle
1. URL: subdomain or path? (recommend subdomain)
2. Any access protection acceptable, or strictly public?
3. Cloudbeds API permission options — share screen/options.
4. Which 6 properties are active in Cloudbeds right now?

> Note: org standing rule routes surfaced tasks to the Smartsheet Action Items
> Staging Sheet. No Smartsheet tool is connected in this session, so tasks are
> tracked here in `TODO.md` for now.
