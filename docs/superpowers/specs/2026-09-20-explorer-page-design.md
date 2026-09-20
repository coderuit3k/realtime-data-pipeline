# Explorer page — design spec

## Overview

Add a fourth real screen to the `web/` Next.js app: `/explorer`, a free-form
Athena SQL runner over the 5 curated tables, with a sidebar of curated
starter queries (matching the mockup's "Truy vấn mẫu" panel) that the user
can run as-is or edit before running. This is the second of 8 sub-projects
extending the mockup to real, AWS-backed pages (Catalog shipped first).

Reference mockup: Design canvas
`https://claude.ai/artifact/Ccbcs7E8ZSsf4fUG5opm4W`, `project/Explorer.dc.html`.
The mockup's featured query joins against a `mentions` table that does not
exist in the real schema — this spec replaces it with a real query (see
"Sample queries" below). Unlike the mockup (which only *displays* a fixed
SQL block), this build lets the user edit the SQL before running, per an
explicit user choice made during brainstorming to prioritize a real
ad-hoc-query experience over a narrower, safer curated-only picker.

## Non-goals

- No query history/saved-queries persistence (session-only state).
- No CSV/JSON export of results.
- No pagination through large result sets — capped at the first 100 rows
  (see "Result limits" below); the point of this screen is exploration and
  sample queries, not a full data export tool.
- No cross-database access — the query always runs against the single
  curated database in `ATHENA_DATABASE`; there is no UI to pick another.

## Threat model: free-form SQL on a public page

This is the first sub-project where user-controlled text reaches AWS
Athena directly, so it gets defense in depth instead of a single check:

1. **AWS-enforced cost cap (real infra change).** `infra/glue.tf`'s
   `aws_athena_workgroup.main` gets `bytes_scanned_cutoff_per_query` set to
   1 GiB (`1073741824`). Athena kills any query that exceeds this before
   it can rack up meaningful cost — Athena bills ~$5/TB scanned, so a 1 GiB
   cap bounds a single query at roughly $0.005, regardless of what SQL
   text produced it. This is the layer that actually matters; the other
   layers below are for a fast, cheap rejection and are not airtight on
   their own.
2. **Read-only validator (`web/lib/sqlGuard.ts`).** Rejects anything that
   doesn't start with `SELECT`/`WITH`, and anything containing a
   DDL/DML keyword (`INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`,
   `CREATE`, `GRANT`, `REVOKE`, `TRUNCATE`, `MERGE`, `UNLOAD`, `VACUUM`,
   `CALL`) as a whole word, or a second statement after a `;`. This is a
   heuristic, not a SQL parser — it is explicitly documented as
   defense-in-depth, not the primary control.
3. **IAM as the backstop.** The web-app IAM user (see `infra/README.md`)
   has no `glue:CreateTable`, no `s3:PutObject` outside
   `.../athena-results/*`, and no write actions on any curated resource.
   Even a `CREATE TABLE ... AS SELECT` that slipped past layer 2 would
   fail with `AccessDenied` when Athena tries to register the new table in
   Glue — no new IAM change is needed for this sub-project, since
   `AthenaQuery`, `GlueReadCuratedDatabase`, and `S3ReadCuratedData` (all
   already granted for Dashboard/Catalog) are exactly what a read-only
   `SELECT` against the curated database needs.
4. **Tighter rate limit than Assistant.** A dedicated Upstash limiter,
   3 requests/minute/IP (vs. Assistant's 5/minute), since an Athena query
   can scan more data than one Bedrock Lambda invoke.
5. **Bounded execution time.** Reuses the existing 25 s poll ceiling in
   `runAthenaQuery`'s polling loop (unchanged) — a runaway query times out
   with a clear error instead of hanging the request.

## Sample queries — real SQL, no fictional tables

All 7 sample queries from the mockup are kept, category labels unchanged,
but every SQL string is rewritten against the actual Glue schema (verified
in the Catalog sub-project's spec) and the actual `keywords` column
semantics: `transform/transform.py:170-191` shows `keywords` is a
comma-joined string of LLM-extracted terms, populated only for
`hackernews_stories`, `news_articles`, `github_repos` — always empty
(`""`) for `crypto_prices` and `weather_observations`. There is no
`mentions` table anywhere in the schema.

| Group | Query | Real approach |
|---|---|---|
| Tương quan | Crypto mentions ↔ giá | For each row in today's `crypto_prices`, count today's `news_articles`/`hackernews_stories` rows whose `keywords` string contains the coin's `coin_id` as a substring (`POSITION(c.coin_id IN m.keywords) > 0`) — no separate mentions table needed, the correlation is a keyword substring match. |
| Tương quan | GitHub ↔ HN keyword overlap | `UNNEST(split(github_repos.keywords, ','))` per repo, joined against `hackernews_stories` where that keyword appears as a substring of the story's `keywords` — real Trino/Presto functions (Athena's default engine is Trino-based; UNNEST/split/POSITION are all supported). |
| Xu hướng từ khoá | Top từ khoá HN hôm nay / Top từ khoá News hôm nay | `CROSS JOIN UNNEST(split(keywords, ','))` then `GROUP BY`/`COUNT(*)`/`ORDER BY ... DESC LIMIT 10`, guarding out the empty string from a row with no extracted keywords. |
| Khối lượng & mới nhất | Volume theo nguồn/ngày | Reuses `buildSourceVolumeQuery` from `web/lib/athena.ts` verbatim — already real, already tested, no new SQL to verify. |
| Khối lượng & mới nhất | Weather mới nhất theo khu vực | `SELECT location, temperature_c, humidity_pct, wind_speed_kmh, observed_at FROM weather_observations WHERE <today> ORDER BY observed_at DESC LIMIT 20`. |
| Khối lượng & mới nhất | Trending repos hôm nay | `SELECT full_name, language, stars, forks, pushed_at FROM github_repos WHERE <today> ORDER BY stars DESC LIMIT 20`. |

Exact SQL strings are given verbatim in the implementation plan's Task 2 —
this table is the traceability record, not the source of truth for the
literal text.

## Architecture

```
GET /api/explorer/samples
  → web/lib/explorerQueries.ts: buildSampleQueryGroups(todayUtcParts())
  → { workgroup: ATHENA_WORKGROUP, database: ATHENA_DATABASE, groups: [...] }
  → Cache-Control: s-maxage=60 (date-sensitive, short TTL)

POST /api/explorer/query   { sql: string }
  → web/lib/sqlGuard.ts: validateReadOnlySelect(sql) — 400 if rejected,
    before touching Athena or the rate limiter
  → web/lib/ratelimit.ts: checkRateLimit(clientIp, explorerLimiter) — 429 if exceeded
  → web/lib/athena.ts: runAthenaQueryWithStats(client, sql, maxResults=100)
  → { columns, rows, scannedBytes, elapsedMs, hasMoreRows }
```

- **`web/lib/clientIp.ts` (new, extracted).** The spoof-resistant client-IP
  extraction currently inlined in `web/app/api/assistant/route.ts` (prefers
  `x-vercel-forwarded-for`/`x-real-ip`, falls back to the rightmost
  `X-Forwarded-For` hop) moves here unchanged, so Explorer's rate limiting
  gets the same protection without duplicating security-sensitive logic —
  this exact duplication-of-a-security-fix risk is why it's extracted
  rather than copy-pasted. `assistant/route.ts` is updated to import it.
- **`web/lib/sqlGuard.ts` (new).** `validateReadOnlySelect(sql): {ok: true} | {ok: false, reason: string}` — pure function, no AWS dependency, fully unit-testable.
- **`web/lib/explorerQueries.ts` (new).** `buildSampleQueryGroups(parts: TodayParts): SampleQueryGroup[]` — pure string-building, reuses `buildSourceVolumeQuery` and the `TodayParts` type from `web/lib/athena.ts`.
- **`web/lib/athena.ts` (modified).** Internal poll loop extracted into a private `startAndPollQuery` helper so both the existing `runAthenaQuery` (signature and behavior unchanged — existing tests keep passing) and the new `runAthenaQueryWithStats` share it instead of duplicating ~15 lines of retry logic. `runAthenaQueryWithStats(client, sql, maxResults)` additionally reads `QueryExecution.Statistics.DataScannedInBytes`/`EngineExecutionTimeInMillis` from the final successful poll, and `ResultSetMetadata.ColumnInfo` for column names.
- **`web/lib/ratelimit.ts` (modified).** Adds `getExplorerLimiter()`, a second `Ratelimit` instance (`slidingWindow(3, "1 m")`, prefix `"explorer-ratelimit"` — a different prefix so its Upstash keys never collide with Assistant's).
- **`web/lib/types.ts` (modified).** Adds `SampleQueryGroup`, `SampleQuery`, `ExplorerQueryResult` types.
- **`web/app/api/explorer/samples/route.ts` (new, GET)** and **`web/app/api/explorer/query/route.ts` (new, POST)** as diagrammed above.
- **`web/app/explorer/page.tsx` (new, client component).** Fetches
  `/api/explorer/samples` on mount; clicking a sample sets the (editable)
  SQL textarea's content to that query's SQL; "▶ Chạy" POSTs the textarea's
  current content (whatever it is, edited or not) to `/api/explorer/query`
  and renders the returned columns/rows plus a
  "Quét X MB · Y s · Z dòng" footer (and a "hiển thị 100 dòng đầu" note
  when `hasMoreRows` is true).
- **`web/components/NavBar.tsx`** gains a 4th entry: `{ href: "/explorer", label: "Data Explorer" }`.
- **`infra/glue.tf`** — `aws_athena_workgroup.main`'s `configuration` block
  gains `bytes_scanned_cutoff_per_query = 1073741824`. This is a normal
  Terraform change (not an IAM-user-style manual step) — the existing
  CI/CD deploy pipeline already manages this workgroup resource and will
  apply it through the standard gated `terraform apply`.

## Result limits

`GetQueryResultsCommand`'s `MaxResults: 100` caps the single page fetched
— no pagination loop. This bounds response payload size; it does not
reduce Athena's billed bytes-scanned for the query (that's already fixed
by the time results are fetched), which is why the workgroup cutoff in
the threat model, not this limit, is the real cost control.

## Error handling

- **Guard rejection** (not a `SELECT`/`WITH`, forbidden keyword, multiple
  statements): 400, the guard's specific Vietnamese reason string. Athena
  is never called — this both fails fast and avoids burning any query
  budget on obviously-invalid input.
- **Rate limited:** 429, `"Đợi một chút rồi chạy tiếp."` — checked only
  after the guard passes, so rejected SQL doesn't consume a user's rate
  limit slot for a query that was never going to run.
- **Athena execution failure** (real syntax error, `FAILED`/`CANCELLED`
  state, or the 25 s timeout): 400 (not 500 — the failure is caused by the
  user's own SQL, not a server fault) with the real Athena error message
  as `error`. This is a deliberate exception to this app's usual
  "never leak AWS error text" rule (Dashboard/Assistant/Catalog all hide
  AWS internals behind a generic Vietnamese message) — Explorer's entire
  purpose is showing the user what their query actually did, and Athena's
  parse/type-error messages don't contain credentials or infrastructure
  secrets, only SQL-level detail (e.g. `SYNTAX_ERROR: line 3:5: ...`).
- **`/api/explorer/samples` failure** (a `requiredEnv` throw): 500, a
  generic Vietnamese message, matching every other route's convention —
  this route touches no user input, so there's nothing SQL-specific to
  surface.

## Testing

- `web/lib/sqlGuard.test.ts` — one test per rejection reason (non-SELECT
  start, each forbidden keyword, multiple statements via semicolon, empty
  string) plus at least 2 passing cases (`SELECT ...`, `WITH x AS (...)
  SELECT ...`).
- `web/lib/explorerQueries.test.ts` — asserts all 7 sample queries are
  present across the 3 groups, each SQL string contains the correct
  partition `WHERE` clause for the given `TodayParts`, and the
  volume-by-source entry's SQL is reference-equal to
  `buildSourceVolumeQuery`'s own output (proving reuse, not duplication).
- `web/lib/athena.test.ts` — existing tests unchanged (the refactor must
  not alter `runAthenaQuery`'s behavior); new tests for
  `runAthenaQueryWithStats` covering: stats extracted correctly from a
  mocked `SUCCEEDED` response, `MaxResults` passed through to
  `GetQueryResultsCommand`, `hasMoreRows` reflecting `NextToken` presence.
- `web/lib/clientIp.test.ts` — the existing spoof-resistance test cases
  currently implicit in `assistant/route.test.ts`'s behavior move here (or
  get a dedicated new test file) so the extracted function has its own
  direct unit coverage.
- `web/app/api/explorer/samples/route.test.ts` and
  `web/app/api/explorer/query/route.test.ts` — success path, guard-rejection
  path (query route only, no Athena call expected), rate-limit path, and
  Athena-failure path.
- No component tests (project convention) — manual live-verification
  checklist after deploy: run each of the 7 sample queries against
  production Athena and confirm real rows come back; attempt one guard
  violation (e.g. `DROP TABLE crypto_prices`) and confirm it's rejected
  client-side with a 400 before any Athena cost is incurred; send 4 rapid
  requests and confirm the 4th is 429'd.

## Open assumptions

- Athena's engine version for this workgroup is the default (Trino-based,
  not legacy Hive/engine v1) — `UNNEST`, `split`, `POSITION(x IN y)` all
  require this. `infra/glue.tf`'s `aws_athena_workgroup.main` sets no
  explicit `engine_version` block, which means AWS's current default
  applies; this has been true since the workgroup was first created for
  the Dashboard build and is not changed by this sub-project.
- 1 GiB as the `bytes_scanned_cutoff_per_query` value is a judgment call,
  not a value from an existing spec — chosen because it is roughly 200×
  this project's actual daily ingestion volume (a handful of MB/day per
  `infra/README.md`'s cost table), so it should never trip during normal
  sample-query use while still bounding worst-case cost to fractions of a
  cent per query.
