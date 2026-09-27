# Trend Events — design spec

## Overview

Add a new daily-scheduled pipeline stage that detects keywords trending
simultaneously across this project's three text-bearing sources (GitHub
Trending, Hacker News, News API), persists each detection as a "Trend
Event" row in the curated zone, and surfaces the resulting history on a
new `/trends` page. This is the second of the two sub-features originally
proposed under "Data Observability & Cross-Source Alerts" — the first
(data-quality alarms on the `transform` Lambda) already shipped in an
earlier sub-project.

Unlike everything else in this data flow, a Trend Event is not derived
from an external API response — it is computed entirely from data already
in the curated zone. It therefore skips the raw-zone → S3-event →
`transform` hop every other source goes through (that hop exists to clean
heterogeneous upstream JSON shapes into a common schema; there is no
upstream JSON here to clean) and writes directly to the curated zone as
Parquet, the same way `transform.py` does.

## Non-goals

- No new AWS service (no DynamoDB, no OpenSearch) — storage stays
  S3 + Glue + Athena, consistent with every other piece of this project.
- No representative example titles/URLs per event in v1 (e.g. "which HN
  story") — only counts per source. A future sub-project could add this;
  it isn't needed for the history/timeline this spec targets.
- No dedup/idempotency guarantee if the Lambda is invoked more than once
  for the same day (manual re-invoke, a misconfigured second schedule,
  etc.) — each run appends a new Parquet file; a re-run produces
  duplicate rows for that day. This matches the rest of the pipeline's
  existing behavior (e.g. `hackernews_ingestion` already re-ingests the
  same story across scans within a day with no cross-file dedup) and
  isn't a new class of problem this sub-project introduces.
- No changes to `weather_observations`/`crypto_prices` — they carry no
  `keywords` column and are excluded from this signal for the same reason
  they're excluded from the RAG index (numeric telemetry, not text).
- No changes to any existing card on `/insights`, `/ops`, or `/dashboard`.

## Architecture

```
EventBridge (new daily rule, cron, default 23:00 UTC)
        │
        ▼
trends/trend_scan.py  (new Lambda "<prefix>-trend-scan", own IAM role)
        │  1. builds one fixed SQL query (today's UTC partition)
        │  2. runs it via common/athena.py's shared run_query()
        │  3. writes 0..N rows to S3 as Parquet
        ▼
s3://<curated-bucket>/source=trend_events/year=YYYY/month=MM/day=DD/*.parquet
        │  (new Glue table "trend_events", same partition-projection
        │   setup as every other curated table)
        ▼
GET /api/trends  →  web/lib/trendsQueries.ts: buildTrendEventsQuery()
        │            bounded by web/lib/dateRange.ts: lastNDaysUtcParts(90)
        ▼
web/app/trends/page.tsx — timeline of past events, most recent first
```

## Detection algorithm

`trends/trend_scan.py` builds and runs exactly one Athena query per
invocation, scoped to the current UTC day's partition only (`year`/`month`/
`day` computed from `datetime.now(timezone.utc)`, the same way
`transform.build_curated_key` does it). Keyword tokens are extracted with
`CROSS JOIN UNNEST(split(keywords, ','))`, the same technique
`buildTopKeywordsQuery` already uses in the web app — not the
substring-`POSITION()` technique a couple of existing Insights queries
use, which is more permissive than intended (e.g. matching `"ai"` inside
`"chain"`) and not worth carrying into new code.

Counts are **distinct ids per keyword**, not raw row counts: ingestion
runs every 30 minutes (~48 times/day per `var.ingestion_schedule`), so an
evergreen HN story or article still in an API's result list gets
re-ingested — and therefore re-counted — on every run that includes it.
Distinct `story_id`/`article_id`/`repo_id` avoids that inflation.

```sql
WITH gh AS (
  SELECT DISTINCT repo_id AS item_id, k AS keyword
  FROM github_repos
  CROSS JOIN UNNEST(split(keywords, ',')) AS t(k)
  WHERE year='{y}' AND month='{m}' AND day='{d}' AND k <> ''
),
hn AS (
  SELECT DISTINCT story_id AS item_id, k AS keyword
  FROM hackernews_stories
  CROSS JOIN UNNEST(split(keywords, ',')) AS t(k)
  WHERE year='{y}' AND month='{m}' AND day='{d}' AND k <> ''
),
news AS (
  SELECT DISTINCT article_id AS item_id, k AS keyword
  FROM news_articles
  CROSS JOIN UNNEST(split(keywords, ',')) AS t(k)
  WHERE year='{y}' AND month='{m}' AND day='{d}' AND k <> ''
)
SELECT
  gh.keyword,
  COUNT(DISTINCT gh.item_id)   AS github_count,
  COUNT(DISTINCT hn.item_id)   AS hn_count,
  COUNT(DISTINCT news.item_id) AS news_count
FROM gh
JOIN hn   ON gh.keyword = hn.keyword
JOIN news ON gh.keyword = news.keyword
GROUP BY gh.keyword
HAVING COUNT(DISTINCT hn.item_id)   >= {hn_min_stories}
   AND COUNT(DISTINCT news.item_id) >= {news_min_articles}
ORDER BY (COUNT(DISTINCT hn.item_id) + COUNT(DISTINCT news.item_id)) DESC
LIMIT {max_events_per_day}
```

The `gh` CTE's inner join implicitly requires ≥1 matching GitHub repo —
no separate GitHub threshold constant is needed since `GITHUB_TRENDING_LIMIT`
(default 20) already keeps that list small and curated.

Three new env-configurable thresholds in `common/config.py` (same pattern
as `RAG_TOP_K`/`GITHUB_TRENDING_LIMIT`), threaded from new Terraform
variables:

| Config var | Default | Terraform variable |
|---|---|---|
| `TREND_HN_MIN_STORIES` | 3 | `var.trend_hn_min_stories` |
| `TREND_NEWS_MIN_ARTICLES` | 2 | `var.trend_news_min_articles` |
| `TREND_MAX_EVENTS_PER_DAY` | 3 | `var.trend_max_events_per_day` |

## Shared Athena helper (refactor)

`rag/agent.py`'s `query_athena` (added in an earlier sub-project) already
contains a full start/poll/get-results loop against the same Athena
workgroup and curated database this Lambda also needs. Rather than copy
that loop a second time, extract it into a new `common/athena.py`:

```python
# common/athena.py
def run_query(sql: str, max_rows: int = 25) -> tuple[list[dict], bool]:
    """Runs sql (assumed already validated by the caller) against
    config.ATHENA_WORKGROUP/config.ATHENA_DATABASE. Returns (rows,
    truncated). Raises RuntimeError on Athena failure/timeout."""
```

This lifts the `_athena()` client getter, the poll loop, and the
`MaxResults`/truncation handling (including the `max_rows + 2` fix from
that sub-project's review) out of `rag/agent.py` verbatim. `rag/agent.py`'s
`query_athena` becomes a thin wrapper:

```python
def query_athena(sql: str, max_rows: int = 25) -> tuple[list[dict], bool]:
    ok, reason = validate_read_only_select(sql)
    if not ok:
        raise ValueError(reason)
    return athena.run_query(sql, max_rows)
```

`trends/trend_scan.py` calls `athena.run_query` directly — its SQL is
Lambda-authored, not LLM/user-authored, so `validate_read_only_select`
does not apply to it (nothing about that guard's rules — read-only
`SELECT`/`WITH` only — is violated by this query anyway, but the guard
exists specifically to constrain *untrusted* SQL, which this isn't).

This refactor moves Python code only — `infra/rag.tf`'s existing IAM
statements (`RunAthenaQueries`, `ReadGlueCuratedSchema`,
`WriteAthenaResults`, `AthenaResultsBucketLocation`) are unchanged, since
`rag_agent` still needs the exact same permissions to call the
(relocated) `run_query` function.

**Existing tests affected by this refactor:** `tests/test_rag_agent.py`'s
`FakeAthena`/`test_query_athena_*` tests currently monkeypatch
`agent._athena` and `agent.time.sleep` — these move to
`tests/test_athena.py` and patch `athena._athena_client`/`athena.time.sleep`
instead. `tests/test_rag_agent.py` keeps a couple of thin tests confirming
`query_athena` calls the guard before calling `athena.run_query` (mirroring
today's `test_query_athena_rejects_invalid_sql_without_calling_athena`,
updated to monkeypatch `agent.athena.run_query` instead of `agent._athena`).

## Storage schema

New Glue table `trend_events` in the existing `curated` database (not a
new database), using the same `partition_projection_base` local and
`source=<name>/year=.../month=.../day=.../` path convention every other
curated table already uses — kept for consistency even though
`trend_events` isn't sourced from an external API the way that prefix
name originally implied.

| Column | Type | Notes |
|---|---|---|
| `event_id` | string | `"{keyword}-{event_date}"`, unique per keyword per day (not globally unique across re-runs — see Non-goals) |
| `keyword` | string | The qualifying keyword, lowercase |
| `event_date` | string | `YYYY-MM-DD` of the scanned partition (also encoded in `year`/`month`/`day`, kept as its own column for easy display without date-reassembly in SQL) |
| `github_count` | bigint | Distinct trending repos mentioning the keyword that day |
| `hn_count` | bigint | Distinct HN stories mentioning the keyword that day |
| `news_count` | bigint | Distinct news articles mentioning the keyword that day |
| `detected_at` | string | ISO 8601 UTC, when the Lambda ran |

`trends/trend_scan.py` writes this itself via a small dedicated
`write_trend_events(rows, event_date) -> str` function (build a
`pandas.DataFrame`, write Parquet to a `build_curated_key`-style path,
upload via boto3) — not by importing `transform.write_parquet`. The two
writers are similar in shape but not identical (this one has no
per-source column normalization or keyword-list-to-string conversion to
share), and coupling `trends/` to `transform/`'s internals for ~15 lines
of savings isn't worth the two modules' now-independent evolution being
entangled. (Contrast with the Athena polling loop above, which was
genuinely identical logic — that one *is* worth sharing.)

No `DRY_RUN` handling — `trend_scan.py` cannot do anything meaningful
without real Athena/S3 access, the same reasoning `rag/agent.py` and
`rag/build_index.py` already follow (neither has `DRY_RUN` support
either).

## Infra (`infra/trends.tf`, new file)

- `aws_iam_role.trend_scan_lambda` — its own role, following this
  project's established "one role per functional Lambda group" convention
  (`ingestion_lambda`, `transform_lambda`, `rag_lambda` each already work
  this way).
- IAM policy statements: `athena:StartQueryExecution`/`GetQueryExecution`/
  `GetQueryResults` scoped to `aws_athena_workgroup.main.arn`;
  `glue:GetDatabase`/`GetTable`/`GetPartitions` scoped to the curated
  database + its tables (same shape as `rag.tf`'s `ReadGlueCuratedSchema`,
  gmail database still excluded); `s3:GetObject` on the whole curated
  bucket (Athena reads the underlying Parquet as the calling identity) +
  `s3:ListBucket` on the bucket; `s3:PutObject` scoped to
  `source=trend_events/*` (this Lambda's own writes) and to
  `athena-results/*` (Athena's query output) + `s3:GetBucketLocation`.
- `aws_lambda_function.trend_scan` — `trend_scan.lambda_handler`, uses
  `var.pandas_layer_arn` (no third-party pip deps, same as `transform`/
  `rag_build_index`), environment: `CURATED_BUCKET`, `ATHENA_WORKGROUP`,
  `ATHENA_DATABASE` (same workgroup/database `rag_agent` already points
  at), `TREND_HN_MIN_STORIES`, `TREND_NEWS_MIN_ARTICLES`,
  `TREND_MAX_EVENTS_PER_DAY`.
- `aws_cloudwatch_log_group.trend_scan`.
- `aws_cloudwatch_event_rule.trend_scan_schedule` (new
  `var.trend_scan_schedule`, default `cron(0 23 * * ? *)`) +
  `aws_cloudwatch_event_target` + `aws_lambda_permission`, following the
  exact shape every existing schedule in `infra/eventbridge.tf` already
  uses. Gated by the existing `var.enable_ingestion_schedule` flag, same
  as every other schedule.
- `infra/glue.tf`: new `trend_events` Glue table (schema above).
- `scripts/build_lambdas.sh`: new
  `package_no_deps trend_scan trends/trend_scan.py` line.

## Web UI

- `web/lib/trendsQueries.ts` (new): `buildTrendEventsQuery(partsList)` —
  `SELECT event_id, keyword, event_date, github_count, hn_count,
  news_count FROM trend_events WHERE (${partitionPredicateAny(partsList)})
  ORDER BY event_date DESC, (hn_count + news_count) DESC`, called with
  `lastNDaysUtcParts(90)` (reusing the existing helper — an explicit
  partition-bounded query, not an unbounded scan across the full
  2024–2035 projected partition range every table's projection config
  technically allows).
- `web/lib/types.ts`: new `TrendEvent` type + `TrendsResponse = {
  events: TrendEvent[] }`.
- `web/app/api/trends/route.ts` (new, GET): runs the one query, maps rows,
  same error-handling convention as every other API route in this app
  (`console.error` + a Vietnamese user-facing error string at 500).
- `web/app/trends/page.tsx` (new): a vertical timeline, one card per
  event — date, keyword, and the three counts (`GitHub: N repos · HN: N
  stories · News: N articles`), matching the approved preview mockup. An
  empty list renders a "no trend events yet" state (a real, expected
  state until the first scheduled run completes, not an error).
- `web/components/Sidebar.tsx`: new entry in `LEGACY_LINKS` (next to
  `/insights`, same "TRANG KHÁC" section it's already in).

## Error handling

- `trends/trend_scan.py`: if the Athena query itself fails, let the
  exception propagate — same convention as every other Lambda in this
  project (no swallowed failures; a failed invocation shows up as a
  Lambda error, which the existing `aws_cloudwatch_metric_alarm.lambda_errors`
  `for_each` block already alarms on once this function is added to it).
- `web/app/api/trends/route.ts`: matches `/api/insights`'s convention
  exactly (500 + safe Vietnamese error message, `console.error` server-side).

## Testing

- `tests/test_athena.py` (new, extracted from `tests/test_rag_agent.py`):
  the `FakeAthena`-based poll/timeout/truncation tests, now targeting
  `common/athena.py` directly.
- `tests/test_rag_agent.py` (modified): `query_athena` tests updated to
  monkeypatch `agent.athena.run_query` (guard-then-delegate behavior only
  — the poll-loop mechanics live in `test_athena.py` now).
- `tests/test_trend_scan.py` (new): `build_detection_query` produces SQL
  referencing all three tables, the `UNNEST`/`split` pattern (not
  `POSITION`), and the configured thresholds; `write_trend_events` writes
  a readable Parquet file with the documented columns (dry local-path
  test, same style as `test_transform.py`'s
  `test_write_parquet_dry_run_writes_readable_parquet`); `lambda_handler`
  wires `run_query` → `write_trend_events` together (monkeypatched, not a
  real Athena call).
- `web/lib/trendsQueries.test.ts` (new): SQL references `trend_events`,
  the partition predicate, and `ORDER BY event_date DESC`.
- `web/app/api/trends/route.test.ts` (new): default success path, empty
  list, 500 error path — following `route.test.ts` conventions used by
  every other API route in this app.
- No `.test.tsx` for `page.tsx` (project-wide convention, zero exceptions
  so far).
- Manual live-verification checklist after deploy (this feature has no
  meaningful "worked in CI" signal beyond unit tests, since qualifying
  for a real trend event depends on real cross-source data existing):
  confirm `/trends` renders the empty state before the first scheduled
  run, confirm a manual `aws lambda invoke` of `trend-scan` completes and
  (if any keyword qualifies that day) a new Parquet file lands under
  `source=trend_events/`, confirm `/trends` then shows it.

## Open assumptions

- `ROW_NUMBER()`/`UNNEST`/`split`/window functions are already verified
  working on this project's Athena engine by prior sub-projects — no new
  Athena capability is assumed here.
- The default thresholds (HN≥3, News≥2 distinct items/day) are a
  reasonable starting point, not derived from real observed data volumes
  in this specific account — expect to tune `var.trend_hn_min_stories`/
  `var.trend_news_min_articles` after watching real results for a few
  days (cheap: Terraform variables, no code change to retune).
- `cron(0 23 * * ? *)` (23:00 UTC) is chosen to capture most of a UTC
  calendar day's ingestion before day rollover; not tied to any specific
  timezone requirement from the user.
