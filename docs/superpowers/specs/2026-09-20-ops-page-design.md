# Ops page — design spec

## Overview

Add a sixth real screen to the `web/` Next.js app: `/ops`, a monitoring
dashboard over the pipeline's 6 Lambda functions (5 ingestion + transform),
its shared EventBridge schedule, CloudWatch alarms, and recent real logs.
This is the fourth of 8 sub-projects extending the mockup to real,
AWS-backed pages. Per explicit user choice, this sub-project does full
real CloudWatch Logs Insights integration rather than a lower-effort
substitute.

Reference mockup: Design canvas
`https://claude.ai/artifact/Ccbcs7E8ZSsf4fUG5opm4W`, `project/Ops.dc.html`.

## Non-goals

- No live AWS Cost Explorer integration — the cost breakdown panel uses
  the same static, documented monthly estimates already in
  `infra/README.md`'s cost table (same treatment as Catalog's cadence
  fact and Dashboard's `COST_ESTIMATE_USD` constant — a real, cited
  number, just not a live API call).
- No write actions (no restart/invoke-now buttons) — read-only
  observability, matching every other real screen so far.
- No RAG Lambda (`rag_build_index`/`rag_query`/`rag_agent`) monitoring —
  the mockup's 6-function scope is the ingestion pipeline + transform
  only, matching `infra/lambda.tf`'s 6 `aws_lambda_function` resources
  outside `infra/rag.tf`.

## Real data sources

| Card/panel | Source | Notes |
|---|---|---|
| Lambda functions X/6 OK | Derived from the same `GetMetricData` call as the health table (Errors₂₄ₕ = 0 → OK) | No separate API call |
| EventBridge schedule | `events:DescribeRule` on `${ALARM_NAME_PREFIX}-ingestion-schedule` | Live `ScheduleExpression` + `State`, not hardcoded — the schedule can be disabled per `infra/README.md`'s teardown section, so this must reflect reality |
| CloudWatch alarms X/6 breaching | **Reused verbatim**: the exact `DescribeAlarms`/`AlarmNamePrefix` call already implemented in `web/app/api/dashboard/route.ts` | No new IAM — `CloudWatchAlarmsReadOnly` already covers this |
| Chi phí ước tính/tháng | **Reused verbatim**: `COST_ESTIMATE_USD = 1.02` already defined in `web/app/api/dashboard/route.ts` | Moved to a shared constant (see Architecture) so both routes reference one source of truth instead of two copies |
| Lambda health table | One batched `cloudwatch:GetMetricData` call, 18 metric queries (6 functions × Invocations/Errors/Duration, 24h window, 300s period) | CloudWatch's `GetMetricData` supports up to 500 metric queries per call — 18 is one round trip |
| Logs gần đây | `logs:StartQuery` + `logs:GetQueryResults` (CloudWatch Logs Insights) across the 6 real log groups pre-created in `infra/logs.tf` | Query: `fields @timestamp, @message, @log \| filter @message like /INFO\|WARN\|ERROR/ \| sort @timestamp desc \| limit 5` — genuine log lines from the real `logger.info(...)`/`logger.exception(...)` calls in `ingestion/*.py`/`transform/transform.py`, not fabricated |
| Chi phí theo hạng mục | Static, cited from `infra/README.md`'s existing cost table: Secrets Manager ~$0.80/mo, CloudWatch alarms ~$0.60/mo, Lambda+S3 ~$0/mo | Same table already backs the dashboard's total estimate |

## Architecture

```
GET /api/ops
  → web/lib/opsMeta.ts: PIPELINE_LAMBDAS (6 suffixes), COST_BREAKDOWN (3 static entries)
  → Promise.all([
      web/lib/cloudwatchMetrics.ts: getLambdaHealth(client, fullFunctionNames)
      web/lib/eventbridge.ts: getScheduleStatus(client, ruleName)
      (existing) DescribeAlarms via getCloudWatchClient()
      web/lib/cloudwatchLogs.ts: queryRecentLogs(client, logGroupNames, 5)
    ])
  → web/lib/types.ts: OpsResponse
  → Cache-Control: s-maxage=60 (same freshness window as Dashboard)
```

- **`web/lib/opsMeta.ts` (new).** `PIPELINE_LAMBDAS: { suffix: string; label: string }[]` — the 6 real suffixes from `infra/lambda.tf` (`hackernews-ingestion`, `news-ingestion`, `weather-ingestion`, `crypto-ingestion`, `github-trending-ingestion`, `transform`), each paired with its display label matching the mockup's Python module names (`hackernews_ingestion`, etc.). `COST_BREAKDOWN: { category: string; monthlyUsd: number }[]` — the 3 static entries above, with an inline comment citing `infra/README.md`'s cost table as the source, same provenance-comment convention as `catalogMeta.ts`.
- **`web/lib/cloudwatchMetrics.ts` (new).** `getLambdaHealth(client: CloudWatchClient, functionNames: string[]): Promise<LambdaHealthRow[]>` — builds 18 `MetricDataQuery` entries (one per function per metric), calls `GetMetricDataCommand` once, and reduces the returned time series into `{ functionName, status: "ok" | "error" | "idle", lastInvocationAt: string | null, errors24h: number, avgDurationMs: number | null }` per function. `status` is `"idle"` when `Invocations` sums to 0 across the whole window (never `"error"` in that case — no invocations means no errors either), `"error"` when `errors24h > 0`, else `"ok"`.
- **`web/lib/eventbridge.ts` (new).** `getScheduleStatus(client: EventBridgeClient, ruleName: string): Promise<{ scheduleExpression: string; enabled: boolean }>` — wraps `DescribeRuleCommand`.
- **`web/lib/cloudwatchLogs.ts` (new).** `queryRecentLogs(client: CloudWatchLogsClient, logGroupNames: string[], limit: number): Promise<LogEntry[]>` — `StartQueryCommand` (24h window, the query string above) then polls `GetQueryResultsCommand` until `status === "Complete"` (same poll-loop shape as `web/lib/athena.ts`'s `startAndPollQuery`, but a separate function in a separate file since it's a different AWS service — no shared abstraction forced across services). Maps each result row's `@timestamp`/`@message`/`@log` fields into `{ timestamp: string; message: string; source: string }`, where `source` strips the `/aws/lambda/${ALARM_NAME_PREFIX}-` prefix from `@log` down to the bare function suffix (falls back to the raw `@log` value if the prefix doesn't match, rather than throwing).
- **`web/lib/aws.ts` (modified).** Adds `getCloudWatchLogsClient()` and `getEventBridgeClient()`, same lazy-singleton pattern as the existing 4 getters. Exact AWS SDK package names (`@aws-sdk/client-cloudwatch-logs`, `@aws-sdk/client-eventbridge`) and field names (`logGroupNames` vs `logGroupName`, etc.) must be verified against the installed packages' type declarations during implementation, per this project's established practice (see Catalog/Explorer's SDK field-name verification).
- **`web/app/api/dashboard/route.ts` (modified, minimal).** `COST_ESTIMATE_USD` moves from a local constant to an import from `web/lib/opsMeta.ts`, so Dashboard and Ops share one source of truth instead of two copies of the same number. No behavior change — same value, same call sites.
- **`web/lib/types.ts` (modified).** Adds `LambdaHealthRow`, `LogEntry`, `CostBreakdownEntry`, `OpsResponse` types.
- **`web/app/api/ops/route.ts` (new, GET).** Runs the 4 independent data fetches via `Promise.all`, assembles `OpsResponse`.
- **`web/app/ops/page.tsx` (new).** 4 KPI cards, the Lambda health table (with a small client-side "X phút trước" relative-time formatter — no existing shared helper for this in the codebase, added as a local function in this file since nothing else needs it yet), the logs panel (colored by level: INFO teal, WARN amber, ERROR red — parsed from each message's leading level word), the cost breakdown panel (horizontal bars, same visual pattern as Insights' keyword bars).
- **`web/components/NavBar.tsx`** gains a 6th entry: `{ href: "/ops", label: "Ops" }`.
- **`infra/README.md`** — the manually-managed IAM user's policy JSON gains 3 new statements (see IAM below).

## IAM (real infra-adjacent change, but doc-only — no `.tf` file touched)

Three new read-only statements added to the existing policy JSON in
`infra/README.md`'s "Web app IAM user" section (the user re-runs
`put-user-policy` themselves, same manual workflow as every prior IAM
change in this project — never done by the assistant or CI):

```json
{
  "Sid": "CloudWatchMetricsReadOnly",
  "Effect": "Allow",
  "Action": ["cloudwatch:GetMetricData"],
  "Resource": "*"
},
{
  "Sid": "EventBridgeReadSchedule",
  "Effect": "Allow",
  "Action": ["events:DescribeRule"],
  "Resource": "arn:aws:events:${REGION}:${ACCOUNT_ID}:rule/${ALARM_NAME_PREFIX}-ingestion-schedule"
},
{
  "Sid": "LogsInsightsReadOnly",
  "Effect": "Allow",
  "Action": ["logs:StartQuery", "logs:GetQueryResults", "logs:StopQuery"],
  "Resource": [
    "arn:aws:logs:${REGION}:${ACCOUNT_ID}:log-group:/aws/lambda/${ALARM_NAME_PREFIX}-hackernews-ingestion:*",
    "arn:aws:logs:${REGION}:${ACCOUNT_ID}:log-group:/aws/lambda/${ALARM_NAME_PREFIX}-news-ingestion:*",
    "arn:aws:logs:${REGION}:${ACCOUNT_ID}:log-group:/aws/lambda/${ALARM_NAME_PREFIX}-weather-ingestion:*",
    "arn:aws:logs:${REGION}:${ACCOUNT_ID}:log-group:/aws/lambda/${ALARM_NAME_PREFIX}-crypto-ingestion:*",
    "arn:aws:logs:${REGION}:${ACCOUNT_ID}:log-group:/aws/lambda/${ALARM_NAME_PREFIX}-github-trending-ingestion:*",
    "arn:aws:logs:${REGION}:${ACCOUNT_ID}:log-group:/aws/lambda/${ALARM_NAME_PREFIX}-transform:*"
  ]
}
```

`cloudwatch:GetMetricData` cannot be scoped more tightly than `Resource:
"*"` in IAM (CloudWatch metric-read actions don't support per-metric ARN
scoping — the same reason the existing `CloudWatchAlarmsReadOnly`
statement is also `Resource: "*"`). `events:DescribeRule` and the 3 Logs
Insights actions ARE scoped exactly to the one rule and the 6 pipeline
log groups respectively — RAG Lambda log groups and every other
CloudWatch/EventBridge resource in the account stay out of reach.

## Error handling

Matches Dashboard's existing convention: any failure (env var missing,
an AWS call erroring) → `console.error` + `{ error: "Không tải được
Ops, thử lại sau." }` at 500, uncached. No per-panel partial-failure
handling, consistent with Dashboard/Insights' existing `Promise.all`
all-or-nothing behavior.

## Testing

- `web/lib/opsMeta.test.ts` — `PIPELINE_LAMBDAS` has exactly the 6 real
  suffixes from `infra/lambda.tf`; each `COST_BREAKDOWN` entry's value
  matches its cited line in `infra/README.md`'s cost table (Secrets
  Manager `0.80`, CloudWatch alarms `0.60`, Lambda+S3 `0`). This test
  does NOT assert the breakdown sums to `COST_ESTIMATE_USD` — it
  doesn't: `infra/README.md`'s own table (`0.80 + 0.60 = 1.40`, before
  even adding the "pennies"-level S3/Logs/Athena rows) already exceeds
  the `$1.02` figure `COST_ESTIMATE_USD` uses, and that figure's own
  prose calls itself "roughly $1/month" — a soft, independently-chosen
  rounding, not a sum of the table. The breakdown panel shows the two
  named, priced cost drivers plus a real "~$0" bucket for the
  free-tier items; it is not represented as an exhaustive decomposition
  of the KPI card's total, and nothing in this spec claims otherwise.
- `web/lib/cloudwatchMetrics.test.ts` — `getLambdaHealth` correctly
  reduces a mocked multi-series `GetMetricData` response into per-function
  rows; covers `ok`, `error` (errors > 0), and `idle` (zero invocations)
  states; picks the correct most-recent non-zero-Invocations timestamp
  for `lastInvocationAt`.
- `web/lib/eventbridge.test.ts` — maps a mocked `DescribeRuleCommand`
  response's `ScheduleExpression`/`State` correctly (`State: "ENABLED"`
  → `enabled: true`, anything else → `false`).
- `web/lib/cloudwatchLogs.test.ts` — `queryRecentLogs` polls until
  `Complete`, maps `@timestamp`/`@message`/`@log` fields correctly,
  strips the known log-group prefix into a bare function suffix, falls
  back gracefully on an unrecognized prefix, and throws with a clear
  message on `Failed`/`Cancelled` query status (mirroring
  `runAthenaQuery`'s existing failure-message pattern).
- `web/app/api/ops/route.test.ts` — success path assembling all 4
  sections, and the 500 error path.
- No component tests (project convention) — manual live-verification
  checklist after deploy: confirm the Lambda health table's 6 rows show
  real "OK" statuses and recent "X phút trước" times (the pipeline runs
  every 10 minutes, so a completely stale table would indicate a real
  problem worth noticing during verification, not just a display bug);
  confirm the EventBridge card shows `rate(10 minutes)` and `ENABLED`;
  confirm the logs panel shows real, readable log lines (not empty, not
  garbled); confirm the alarms/cost KPI cards match Dashboard's own
  numbers (since both now read from the same sources).

## Open assumptions

- `@aws-sdk/client-cloudwatch-logs` and `@aws-sdk/client-eventbridge`
  are not yet installed — added as new dependencies in the
  implementation, following the same pattern as adding
  `@aws-sdk/client-glue` for the Catalog sub-project.
- A 300-second `GetMetricData` period over a 24h window is granular
  enough to find "last invocation" within about 5 minutes of the truth,
  which is precise enough for a "X phút trước" display on a pipeline that
  runs every 10 minutes.
- Logs Insights query cost (billed per GB scanned) is negligible at this
  project's log volume (6 tiny Lambdas, `log_retention_days`-bounded,
  a handful of log lines per 10-minute invocation) — not separately
  budgeted or capped, unlike Explorer's Athena byte-scan cutoff, because
  the data volume here is orders of magnitude smaller and there's no
  free-form user input driving the query.
