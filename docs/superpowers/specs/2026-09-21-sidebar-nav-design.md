# Sidebar navigation — design spec

## Overview

Replace the shared horizontal top nav bar (`web/components/NavBar.tsx`)
with a left sidebar matching the mockup exactly, across all 9 real
dashboard-style pages (Dashboard, RAG Assistant, Data Explorer, Data
Catalog, Insights, Weather, Ops, CI/CD, Settings). The Landing page
(`/`, shipped as the 8th mockup screen) is explicitly excluded, matching
the mockup's own layout — it's the only one of the 10 mockup screens
that doesn't import a shared `Sidebar` component.

This gap (top bar instead of the mockup's sidebar) predates this
session's tracked window — it was already the established, if incorrect,
pattern before this window's 8 sub-projects began, and was only noticed
once every mockup screen had a real counterpart to compare against
directly.

Reference mockup: Design canvas
`https://claude.ai/artifact/Ccbcs7E8ZSsf4fUG5opm4W`, `project/Sidebar.dc.html`
(the shared component every other mockup screen imports via
`dc-import name="Sidebar" active="<page>"`).

## Real data sources

- The mockup's status footer shows a colored dot + "5/5 nguồn OK" — live
  health, not just the static source count. Real logic already exists in
  `web/app/api/dashboard/route.ts`: `sourcesHealthy =
  sourceVolumes.filter(s => s.records > 0).length`, computed from
  `buildSourceVolumeQuery` (`web/lib/athena.ts`, already shared). Reused
  here, not re-derived.
- `sourcesTotal` — real value from `web/lib/settingsMeta.ts`'s
  `DATA_SOURCES.length` (built for the Settings sub-project) — not a
  fresh hardcoded `5`. `dashboard/route.ts`'s own local `SOURCES_TOTAL =
  5` constant gets updated to the same shared source while touching this
  area, removing a duplicate.
- "us-east-1 · dev" — real values. `AWS_REGION` already exists as a web
  app env var (`us-east-1`, matches `infra/terraform.tfvars.example`
  exactly). `environment` has no existing web app env var, though the
  real Terraform `environment` variable (`infra/variables.tf`, default
  `"dev"`, matches `infra/terraform.tfvars.example`) already exists —
  a new `DEPLOY_ENVIRONMENT` env var carries this real value into the
  web app.

## Non-goals

- No changes to any of the 9 existing pages' own content or
  `page.tsx` files — only the shared layout/nav wrapper changes. Each
  page's own root `<div className="p-9 ...">` is untouched.
- No live-updating/polling for the health check — fetched once per page
  load (now happening on every page instead of only Dashboard/Ops),
  matching this app's established convention everywhere else.
- No change to the Landing page (`/`) — it keeps its current header
  (logo + anchor nav + GitHub/demo buttons), matching the one mockup
  screen with no Sidebar import.

## Architecture

```
web/app/layout.tsx
  <body>
    <div class="flex min-h-screen">
      <Sidebar />              (client component, self-suppresses on "/")
      <main class="flex-1 overflow-auto">{children}</main>
    </div>
  </body>

GET /api/health
  → web/lib/athena.ts: buildSourceVolumeQuery(todayUtcParts()), runAthenaQuery
  → web/lib/settingsMeta.ts: DATA_SOURCES.length (sourcesTotal)
  → process.env.AWS_REGION, process.env.DEPLOY_ENVIRONMENT
  → web/lib/types.ts: HealthResponse { sourcesHealthy, sourcesTotal, region, environment }
  → Cache-Control: s-maxage=60, stale-while-revalidate=120 (matches
    Insights/Ops/Weather/Settings/CI-CD's shared convention; Dashboard's
    own route uses the same s-maxage=60 but a longer
    stale-while-revalidate=300, since this route's query scope is
    intentionally narrower -- it skips the activity-feed query and the
    CloudWatch alarm check entirely, computing only the 2 health numbers
    the sidebar needs, not the full dashboard payload)
```

- **`web/lib/types.ts` (modified, additive).** Adds `HealthResponse = {
  sourcesHealthy: number; sourcesTotal: number; region: string;
  environment: string }`.
- **`web/app/api/health/route.ts` (new, GET).** Runs
  `buildSourceVolumeQuery` + `runAthenaQuery` (both already exist,
  reused unchanged), computes `sourcesHealthy` with the same filter
  `dashboard/route.ts` already uses, reads `sourcesTotal` from
  `DATA_SOURCES.length`, reads `region`/`environment` from
  `requiredEnv("AWS_REGION")`/`requiredEnv("DEPLOY_ENVIRONMENT")`.
- **`web/app/api/dashboard/route.ts` (modified, minimal).** Replaces the
  local `SOURCES_TOTAL = 5` constant with the same `DATA_SOURCES.length`
  source `/api/health` uses, removing a duplicate "5". No other change —
  verified by reading the full file before and after, matching this
  session's established discipline for touching a production-critical
  shared route.
- **`web/components/Sidebar.tsx` (new).** Client component
  (`"use client"`). On mount, fetches `/api/health` (errors are
  swallowed with a fallback display, same treatment as Weather's
  secondary history fetch — this is decorative status, not a page's
  primary content, so a failed fetch must never block the sidebar's nav
  links from rendering). Uses `usePathname()` for the same
  early-return-on-`/`-and-exact-match-highlighting pattern `NavBar.tsx`
  already used. Renders, top to bottom: logo + "DataPulse" / "realtime-pipeline"
  label; "PHÂN TÍCH" group (Tổng quan → `/dashboard`, RAG Assistant →
  `/assistant`, Data Explorer → `/explorer`, Data Catalog → `/catalog`,
  Insights → `/insights`, Weather → `/weather`), each with the mockup's
  exact SVG icon; "VẬN HÀNH" group (Ops & Monitoring → `/ops`, CI/CD →
  `/cicd`, Settings → `/settings`), same treatment; status footer (dot +
  real `{sourcesHealthy}/{sourcesTotal} nguồn OK`, real `{region} ·
  {environment}`).
- **`web/components/NavBar.tsx` — deleted.** Fully replaced; nothing
  else in the app imports it after this change.
- **`web/app/layout.tsx` (modified).** `<NavBar />` → `<Sidebar />`,
  wrapped in `<div className="flex min-h-screen">` with
  `<main className="flex-1 overflow-auto">{children}</main>` around
  `{children}`. No other change to this file.
- **New env var:** `DEPLOY_ENVIRONMENT` (e.g. `dev`), added to Vercel by
  the user, same manual pattern as every other credential this session —
  never generated or set by the assistant.

## Error handling

`/api/health` matches the established convention: unexpected failures →
`console.error` + `{ error: "Không tải được trạng thái, thử lại sau." }`
at 500, uncached. On the client, `Sidebar.tsx`'s fetch failure is handled
more leniently than a full-page error (unlike every other page's
fetch-failure pattern) — the footer falls back to a plain "—" instead of
blocking the whole sidebar, since a broken health check must never take
down navigation on every page in the app.

## Testing

- `web/app/api/health/route.test.ts` — happy path (mocked Athena rows →
  correct `sourcesHealthy` count, real `sourcesTotal` from
  `DATA_SOURCES.length`, env-var passthrough for region/environment),
  500 error path.
- No component test for `Sidebar.tsx` (project convention).
- Manual live-verification checklist after deploy: every one of the 9
  routes shows the sidebar with the correct link highlighted; `/` shows
  no sidebar; the footer shows real, plausible health numbers and the
  real `us-east-1 · dev` label; clicking through all 9 links works;
  confirm no page's own content shifted or broke from the new layout
  wrapper.

## Open assumptions

- `DATA_SOURCES.length` (5) and the real ingestion pipeline's actual
  source count are assumed to stay in sync — true today, and already the
  established assumption this same constant relies on for Settings and
  Landing; not a new assumption introduced here.
