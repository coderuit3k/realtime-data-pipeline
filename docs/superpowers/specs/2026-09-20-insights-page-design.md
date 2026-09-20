# Insights page — design spec

## Overview

Add a fifth real screen to the `web/` Next.js app: `/insights`, a 2x2 grid
of trending-correlation cards (top keywords, crypto mentions ↔ price,
GitHub↔HN keyword overlap, weather snapshot), with a "Hôm nay / 7 ngày"
time-range toggle. This is the third of 8 sub-projects extending the
mockup to real, AWS-backed pages (Catalog and Explorer shipped first).

Reference mockup: Design canvas
`https://claude.ai/artifact/Ccbcs7E8ZSsf4fUG5opm4W`, `project/Insights.dc.html`.

Unlike Explorer, this page never accepts user-controlled SQL — all 4
queries are fixed, built server-side, and run automatically on page load
and on toggle change, the same trust model as the existing Dashboard page.
No SQL guard, no dedicated rate limiter, and no new IAM are needed.

## Prerequisite: expand real weather ingestion coverage

The mockup's weather card originally showed 4 regions (TP.HCM, Vũng Tàu,
Đồng Nai, Đà Lạt), which happened to match `common/config.py`'s
`WEATHER_LOCATIONS` exactly. Per explicit user direction, this sub-project
expands real weather coverage to 12 Southern Vietnam provinces/cities —
the same 12 already used in the (mockup-only, not yet built) Weather
screen — so Insights and the future Weather sub-project draw from one
consistent real data source:

| Location (stored in `location` column) | Latitude | Longitude |
|---|---|---|
| Tay Ninh | 11.3100 | 106.0989 |
| Ho Chi Minh City | 10.7769 | 106.7009 |
| Thu Dau Mot (Binh Duong) | 10.9804 | 106.6519 |
| Long Xuyen (An Giang) | 10.3860 | 105.4351 |
| Bien Hoa (Dong Nai) | 10.9574 | 106.8426 |
| Can Tho | 10.0452 | 105.7469 |
| My Tho (Tien Giang) | 10.3600 | 106.3600 |
| Soc Trang | 9.6003 | 105.9800 |
| Vung Tau | 10.4114 | 107.1362 |
| Rach Gia (Kien Giang) | 10.0124 | 105.0809 |
| Ca Mau | 9.1769 | 105.1500 |
| Da Lat | 11.9404 | 108.4583 |

Coordinates are public, well-known city-center coordinates (not
fabricated) — precise enough for Open-Meteo's forecast grid, which is the
same precision the original 4-location list already relied on. This is a
real code change to `common/config.py` (consumed by
`ingestion/weather_ingestion.py`), shipped through the normal Lambda
redeploy path documented in `infra/README.md`'s "Updating Lambda code"
section (`./scripts/build_lambdas.sh` + `terraform apply` — the zip hash
change triggers a redeploy of just the weather Lambda, no new AWS
resource, no IAM change).

**Sequencing consequence:** newly added locations have zero historical
data until the ingestion Lambda actually runs after this deploys (every
10 minutes, per the existing shared `EventBridge` schedule). This is why
the plan's Task 1 is this config change + deploy, done first and pushed
immediately — so real data accumulates for all 12 locations while the
rest of this sub-project's cards are built, reviewed, and merged.

## Non-goals

- No user-controlled SQL (that's Explorer's job).
- No new time ranges beyond "today" and "7 ngày" (no custom date picker).
- The weather card always shows the latest available reading regardless
  of the today/7-day toggle — it's a live snapshot, not a trend, matching
  the mockup (the toggle pills visually sit above the whole grid, but only
  the 3 non-weather cards' underlying queries actually change with it).
- No historical trend charts (the "7 ngày" toggle changes the aggregation
  window, not a time-series chart) — out of scope for this sub-project.

## Architecture

```
GET /api/insights?range=today|7d   (default: today)
  → web/lib/dateRange.ts: lastNDaysUtcParts(range === "7d" ? 7 : 1)
  → web/lib/insightsQueries.ts: 4 query builders, each taking the day-parts list
  → Promise.all([runAthenaQuery × 4]) via the existing web/lib/athena.ts client
  → web/lib/types.ts: InsightsResponse
  → Cache-Control: s-maxage=60 (same freshness window as Dashboard)
```

- **`web/lib/dateRange.ts` (new).** `lastNDaysUtcParts(n: number, now: Date = new Date()): TodayParts[]` — returns `n` consecutive `TodayParts` ending today (UTC), most recent first. `n=1` reduces to today only.
- **`web/lib/athena.ts` (modified).** Adds `partitionPredicateAny(partsList: TodayParts[], alias?: string): string`, returning `(year='Y1' AND month='M1' AND day='D1') OR (year='Y2' AND ...) OR ...` (no `WHERE` keyword, no wrapping parens around the whole thing — callers compose it into their own `WHERE`/`AND`). Optional `alias` prefixes each column (`c.year='...'`) for multi-table queries. This is additive; `partitionWhere` (single-day, unaliased, includes `WHERE`) is untouched and still used by Dashboard/Explorer.
- **`web/lib/insightsQueries.ts` (new).** Four builder functions:
  - `buildTopKeywordsQuery(partsList)` — `UNION ALL` of `hackernews_stories`/`news_articles`, `UNNEST(split(keywords, ','))`, `GROUP BY`/`ORDER BY COUNT(*) DESC LIMIT 6`.
  - `buildCryptoMentionsQuery(partsList)` — per-coin latest `price_usd`/`change_24h_pct` via `ROW_NUMBER() OVER (PARTITION BY coin_id ORDER BY observed_at DESC) = 1`, joined with a correlated mention count using the same `POSITION(coin_id IN keywords)` substring-match technique verified in the Explorer sub-project (no fictional `mentions` table here either).
  - `buildGithubHnOverlapQuery(partsList)` — `UNNEST` on `github_repos.keywords`, joined against `hackernews_stories` via `POSITION`, grouped by keyword with `COUNT(DISTINCT full_name) AS overlap_count`.
  - `buildWeatherSnapshotQuery(parts: TodayParts)` — single-day (always "today"), `ROW_NUMBER() OVER (PARTITION BY location ORDER BY observed_at DESC) = 1`, one row per of the 12 real locations.
- **`web/lib/types.ts` (modified).** Adds `InsightsResponse` and its 4 row types (`TopKeyword`, `CryptoMention`, `GithubHnOverlap`, `WeatherSnapshot`).
- **`web/app/api/insights/route.ts` (new, GET).** Reads `?range=` search param (`"today"` default, `"7d"` the only other accepted value — anything else falls back to `"today"` rather than erroring, since this is a UI-driven toggle, not user-facing free input). Runs the 4 queries in parallel via `Promise.all`, maps each result with `parseAthenaRows`, returns `InsightsResponse`.
- **`web/app/insights/page.tsx` (new).** Two pill buttons ("Hôm nay" / "7 ngày") driving a `range` state that refetches `/api/insights?range=...` on change; a 2x2 CSS grid of 4 cards matching the mockup's layout (keyword bars, crypto mention rows with colored `change_24h_pct`, overlap bars). The weather card's mini-grid was sized in the mockup for exactly 4 locations (`grid-template-columns: repeat(2, ...)`, 4 tiles) — with 12 real locations now available, this card switches to a scrollable grid (same 2-column tile style, `overflow-auto`, no fixed row count) rather than the mockup's fixed 2x2, so it can show however many of the 12 locations actually have data.
- **`web/components/NavBar.tsx`** gains a 5th entry: `{ href: "/insights", label: "Insights" }`.
- **`common/config.py`** — `WEATHER_LOCATIONS` expands from 4 to the 12 entries in the table above.

## Error handling

Matches Dashboard's existing convention exactly: any failure (env var
missing, Athena error) → `console.error` + `{ error: "Không tải được
Insights, thử lại sau." }` at 500, uncached. No per-card partial-failure
handling — if any of the 4 queries fails, the whole response fails, same
as Dashboard treats its own multi-query `Promise.all`.

## Testing

- `web/lib/dateRange.test.ts` — `lastNDaysUtcParts(1)` equals
  `[todayUtcParts()]`; `lastNDaysUtcParts(7)` returns 7 consecutive
  calendar days ending today, most recent first, correctly rolling over a
  month/year boundary (test with a fixed `Date` near e.g. 2026-01-03).
- `web/lib/athena.test.ts` — new tests for `partitionPredicateAny`: single
  day, multiple days, with and without an alias.
- `web/lib/insightsQueries.test.ts` — each builder's SQL references every
  day in a multi-day `partsList`; `buildWeatherSnapshotQuery` takes a
  single `TodayParts`, not a list; no fabricated table/column names
  (cross-checked against `infra/glue.tf` during review, same as Explorer's
  Task 4).
- `web/app/api/insights/route.test.ts` — default range, explicit `7d`
  range, invalid range value falls back to `today`, and the 500 error
  path.
- No component tests (project convention) — manual live-verification
  checklist after deploy: load `/insights`, confirm all 4 cards render
  real data (not empty/placeholder), toggle to "7 ngày" and confirm the 3
  non-weather cards' numbers change while weather stays the same, confirm
  all 12 weather locations that have data by then appear (a location may
  still show nothing if fewer than one ingestion cycle has passed since
  the Task 1 deploy — acceptable, not a bug).

## Open assumptions

- The 12 provincial coordinates are sourced from public geographic
  knowledge, not measured/verified against an authoritative source beyond
  ordinary confidence in well-known city locations — acceptable precision
  for a weather API grid lookup, consistent with how the original 4 were
  presumably sourced.
- `ROW_NUMBER() OVER (...)` window functions are supported by Athena's
  default (Trino-based) engine, same assumption already verified true for
  Explorer's `UNNEST`/`split`/`POSITION` usage.
- A location with zero ingested rows in the requested range (e.g. right
  after the Task 1 deploy, before its first ingestion cycle) simply does
  not appear in `weatherSnapshot` — the UI renders however many rows come
  back, not a fixed 12-slot grid with placeholders.
