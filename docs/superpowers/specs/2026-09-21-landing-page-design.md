# Landing page — design spec

## Overview

Add the eighth and final real screen from the mockup: a static portfolio
landing page, replacing `web/app/page.tsx`'s current content (the
Dashboard) at the app's root route (`/`). The Dashboard moves to
`/dashboard`. This is the last of 8 sub-projects extending the mockup to
real, AWS-backed pages this session.

Reference mockup: Design canvas
`https://claude.ai/artifact/Ccbcs7E8ZSsf4fUG5opm4W`, `project/Landing.dc.html`.

## Real data sources

Unlike the other 7 pages, Landing has no live runtime state to fetch —
its "real data" is architectural facts about the codebase/infrastructure,
true at build/deploy time rather than changing minute to minute (no
`/api/landing` route, no new AWS credential). Five numbers were
independently verified during brainstorming, not carried over from the
mockup unchanged (plus corrected copy for ingestion cadence and the tech
stack list, below):

- **5 data sources** — `DATA_SOURCES.length` from `web/lib/settingsMeta.ts`
  (built for the Settings sub-project), reused rather than re-declared.
- **9 Lambda functions** — real count via `grep -n "^resource
  \"aws_lambda_function\"" infra/*.tf`: 6 in `infra/lambda.tf`
  (hackernews/news/weather/crypto/github ingestion + transform) + 3 in
  `infra/rag.tf` (rag_build_index, rag_query, rag_agent). The mockup's
  "6" predates the RAG sub-project and undercounts.
- **233 automated tests** — real combined total: `.venv/bin/python -m
  pytest tests/ --collect-only -q` → 73 (exactly matches the mockup's
  stale "73," which turns out to have been accurate for the Python suite
  alone at the time it was drawn, before the web app's own tests
  existed); `cd web && npx vitest run` → 160. Both are real,
  currently-passing suites for this same project — the honest portfolio
  metric is the sum, not the pre-web-app half. (An initial draft of this
  number, 228, undercounted by exactly 5 -- it was measured before this
  same feature's own `landingMeta.test.ts` existed, which is itself part
  of the real vitest suite the number describes. Caught during Task 1's
  review and corrected; re-verified clean at the final whole-branch
  review.)
- **$1/month** — reused directly from `web/lib/opsMeta.ts`'s existing
  `COST_ESTIMATE_USD = 1.02` (already real, already cited there),
  displayed rounded as `$1`. Not re-derived.
- **12 weather locations** — `WEATHER_LOCATION_NAMES.length` from
  `web/lib/weatherMeta.ts` (built for the Weather sub-project), reused.
  Corrects the mockup's stale "4 khu vực" (from before that sub-project
  expanded coverage).
- **Ingestion cadence** — the mockup's blanket "ingest mỗi 10 phút" is no
  longer accurate for all 5 sources: News API has had its own separate,
  slower `rate(20 minutes)` EventBridge rule since the Ops sub-project's
  real rate-limit incident fix. Corrected to "ingest mỗi 10-20 phút tuỳ
  nguồn" (varies by source) rather than restating a single wrong number.
- **Tech stack** — the mockup's chip list (Python, Terraform, AWS Lambda,
  S3, Glue, Athena, Bedrock, GitHub Actions) predates the web app; adding
  Next.js, TypeScript, and Vercel, all real and currently in use (8 real
  pages built this session, deployed on Vercel).

## Non-goals

- No live API route — every number here is a build-time constant with a
  citation, matching the established convention for static facts
  elsewhere in this app (`opsMeta.ts`'s `COST_ESTIMATE_USD`,
  `PIPELINE_LAMBDAS`), not a live fetch. Nothing on this page changes
  minute to minute the way Ops's alarm counts or CI/CD's run status do,
  so a live route would be machinery this page doesn't need.
- No new AWS credential, no new IAM grant.
- No shared `<NavBar>` on this page — matches the mockup's own explicit
  layout choice (the only one of the 8 mockup screens that does NOT
  import the shared `Sidebar` component), and matches real landing-page
  convention (a minimal marketing header, not the internal app's nav).

## Architecture

```
web/app/dashboard/page.tsx  (new -- moved verbatim from web/app/page.tsx,
                              no content changes)
web/app/page.tsx            (rewritten -- becomes the Landing page)
web/lib/landingMeta.ts      (new -- real, cited constants)
web/lib/landingMeta.test.ts (new)
web/components/NavBar.tsx   (modified)
```

- **`web/app/dashboard/page.tsx` (new).** The current `web/app/page.tsx`
  content, moved with no changes. `/dashboard` becomes the real app's
  demo entry point (what the mockup's own "Xem demo" button always
  pointed at conceptually, since the mockup's Landing screen links out to
  a separate Dashboard screen).
- **`web/lib/landingMeta.ts` (new).** Exports `DATA_SOURCE_COUNT`
  (imported from `settingsMeta.ts`'s `DATA_SOURCES.length`),
  `WEATHER_LOCATION_COUNT` (imported from `weatherMeta.ts`'s
  `WEATHER_LOCATION_NAMES.length`), `LAMBDA_COUNT = 9` (hardcoded, cited
  to the `infra/*.tf` grep above), `TEST_COUNT = 233` (hardcoded, cited
  to the 73+160 breakdown above), `MONTHLY_COST_USD` (imported from
  `opsMeta.ts`'s `COST_ESTIMATE_USD`). Every hardcoded value carries an
  inline citation comment stating exactly how it was verified and when.
- **`web/app/page.tsx` (new Landing, rewritten).** A static server
  component -- no `"use client"`, no `useEffect`/fetch, since every value
  is a build-time constant. Sections, in order:
  1. Header: logo, `#architecture`/`#features` anchor nav, a "Mã nguồn"
     button linking to the real public GitHub repo
     (`https://github.com/coderuit3k/realtime-data-pipeline`), and a
     "Xem demo →" button linking to `/dashboard`.
  2. Hero: headline + subhead (mockup's existing copy, still accurate),
     two CTAs (same GitHub/`/dashboard` links as the header), and the
     4-stat row using `landingMeta.ts`'s real numbers (data sources,
     Lambdas, tests, monthly cost).
  3. "Kiến trúc trong một dòng" -- the mockup's architecture-in-one-line
     diagram, static (S3 raw→curated, Glue/Athena, RAG CRAG+Agent --
     already accurate, no numbers to correct), `id="architecture"` for
     the header's anchor link.
  4. 4 feature cards -- mockup's existing structure, with corrected copy:
     weather region count (12, not 4), ingestion cadence (10-20 min
     varies by source, not a blanket 10), and the second inline "73 test
     tự động" mention (also corrected to the real 233), `id="features"`
     for the header's anchor link.
  5. Tech stack chip row -- original 8 chips + Next.js, TypeScript,
     Vercel.
  6. Footer: the mockup's existing "Xây dựng để ứng tuyển vị trí Data
     Engineer Intern · 2026" line, unchanged (already accurate).
- **`web/components/NavBar.tsx` (modified).** Two changes: (1) the first
  `LINKS` entry changes from `{ href: "/", label: "Tổng quan" }` to `{
  href: "/dashboard", label: "Tổng quan" }`; (2) an early return --
  `if (pathname === "/") return null;` -- added right after the existing
  `usePathname()` call, so the shared nav never renders on the Landing
  route. Chosen over restructuring the app into Next.js route groups
  (moving all 8 existing page directories under a shared layout) because
  it's a 2-line change to one already-`"use client"` component that
  already computes `pathname`, versus a large, unnecessary file-tree
  reorganization for a cosmetic concern.

## Error handling

None needed -- no fetch, no external call, nothing that can fail at
runtime beyond what Next.js itself already handles for any static page.

## Testing

- `web/lib/landingMeta.test.ts` -- `DATA_SOURCE_COUNT` equals the real
  `DATA_SOURCES.length` (not a second hardcoded `5`, to prevent drift if
  a data source is ever added or removed); `WEATHER_LOCATION_COUNT`
  equals the real `WEATHER_LOCATION_NAMES.length` (same reasoning);
  `LAMBDA_COUNT`/`TEST_COUNT`/`MONTHLY_COST_USD` are all positive
  numbers (can't be re-derived from imports the way the other two can,
  so this is a sanity check, not a drift guard).
- No route or component test (project convention for pages; this page
  additionally has no fetch to mock).
- Manual live-verification checklist after deploy: `/` loads the new
  Landing page with no shared nav bar visible; `/dashboard` loads the
  (moved, otherwise unchanged) Dashboard with the shared nav bar visible,
  including a working "Tổng quan" link back to `/dashboard` itself; every
  other existing page's nav still works; the hero stat row shows 5 / 9 /
  233 / $1; the "Mã nguồn" and "Xem demo" links resolve to the real
  GitHub repo and `/dashboard` respectively.

## Open assumptions

- The real Lambda and test counts (9, 233) are point-in-time facts as of
  today (2026-09-21) -- like every other hardcoded static fact in this
  app (`opsMeta.ts`'s `COST_ESTIMATE_USD`, `PIPELINE_LAMBDAS`), they will
  go stale if the codebase grows further, and updating them is a manual
  follow-up, not something this page keeps in sync automatically. This
  is a deliberate choice (see Non-goals) consistent with the rest of the
  app, not an oversight.
