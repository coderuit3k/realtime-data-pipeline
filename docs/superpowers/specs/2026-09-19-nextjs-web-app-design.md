# Next.js web app for the real-time data pipeline (Dashboard + RAG Assistant)

Status: approved for planning
Date: 2026-09-19

## 1. Overview

The pipeline (5 ingestion Lambdas → S3 → Glue/Athena, plus 2 parallel RAG
architectures on Bedrock) has no user-facing surface today — every
verification so far has been the AWS console or the CLI. This adds a small
Next.js web app that gives the portfolio a real, live, clickable product:

- **Dashboard** (`/`) — KPIs and per-source volume pulled from Athena, plus
  CloudWatch alarm state.
- **RAG Assistant** (`/assistant`) — a chat UI that lets a visitor ask a
  question and choose which of the two deployed RAG Lambdas answers it
  (`rag_query` = fixed CRAG pipeline, `rag_agent` = tool-calling agent),
  showing the real answer, sources, and per-mode trace.

Both screens hit real AWS resources through Next.js API routes — no mock
data, no changes to existing Lambda code. Visual design reuses the palette
and layout already validated in the Design canvas artifact (dark navy
`#0B1120`, accent `#2DD4BF`, Space Grotesk / Work Sans / IBM Plex Mono).

## 2. Non-goals (this iteration)

- The other 7 mockup screens (Data Explorer, Insights, Ops, Catalog, CI/CD,
  Settings, Landing) are not built now — `/assistant` and `/` only.
- No write actions (nothing here pauses ingestion, edits secrets, or
  triggers `terraform apply`) — read-only against AWS.
- No authentication/user accounts — the app is public, protected only by
  rate limiting (below).
- No live AWS cost data (Cost Explorer needs extra IAM scope and isn't
  real-time) — the cost figure shown is the static estimate already
  documented in `infra/README.md`.

## 3. Repo structure

```
web/
  app/
    page.tsx                  Dashboard screen
    assistant/page.tsx        RAG Assistant screen
    api/dashboard/route.ts    Athena-backed KPI endpoint
    api/assistant/route.ts    Lambda-invoke endpoint (rate limited)
    layout.tsx, globals.css
  lib/
    aws.ts                    AWS SDK v3 client singletons (Athena, Lambda, CloudWatch)
    athena.ts                 startQuery + poll + parse helpers
    ratelimit.ts              Upstash sliding-window limiter
  components/
    KpiCard.tsx, SourceVolumeChart.tsx, ActivityFeed.tsx
    ChatThread.tsx, ModeToggle.tsx, ToolTrace.tsx
  package.json, tsconfig.json, tailwind.config.ts, next.config.ts
```

Lives in this repo under `web/`, deployed independently to Vercel (Vercel
project root directory = `web/`) — does not touch the existing GitHub
Actions Terraform workflow.

Stack: Next.js 15 (App Router, TypeScript), Tailwind CSS, `next/font` for
the three Google fonts, `@aws-sdk/client-athena`, `@aws-sdk/client-lambda`,
`@aws-sdk/client-cloudwatch`, `@upstash/ratelimit` + `@upstash/redis`. No
chart library — the per-source volume chart is CSS bars, same as the
mockup.

## 4. AWS integration

### 4.1 IAM (new: `infra/web_access.tf`)

One least-privilege IAM user + access key, in the existing `infra` stack:

```hcl
resource "aws_iam_user" "web_app" {
  name = "${local.name_prefix}-web-app"
}

resource "aws_iam_user_policy" "web_app" {
  name = "${local.name_prefix}-web-app-policy"
  user = aws_iam_user.web_app.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["athena:StartQueryExecution", "athena:GetQueryExecution", "athena:GetQueryResults", "athena:StopQueryExecution"]
        Resource = aws_athena_workgroup.main.arn
      },
      {
        Effect   = "Allow"
        Action   = ["glue:GetTable", "glue:GetDatabase", "glue:GetPartitions"]
        Resource = "*" # scoped narrower to the curated database's ARNs in the plan
      },
      {
        Effect = "Allow"
        Action = ["s3:GetObject", "s3:ListBucket"]
        Resource = [aws_s3_bucket.curated.arn, "${aws_s3_bucket.curated.arn}/*"]
      },
      {
        Effect = "Allow"
        Action = ["s3:PutObject", "s3:GetObject"]
        Resource = "${aws_s3_bucket.curated.arn}/athena-results/*"
      },
      {
        Effect   = "Allow"
        Action   = ["cloudwatch:DescribeAlarms"]
        Resource = "*"
      },
      {
        Effect   = "Allow"
        Action   = ["lambda:InvokeFunction"]
        Resource = [aws_lambda_function.rag_query.arn, aws_lambda_function.rag_agent.arn]
      }
    ]
  })
}

resource "aws_iam_access_key" "web_app" {
  user = aws_iam_user.web_app.name
}

output "web_app_access_key_id" {
  value = aws_iam_access_key.web_app.id
}

output "web_app_secret_access_key" {
  value     = aws_iam_access_key.web_app.secret
  sensitive = true
}
```

Same pattern as the existing NewsAPI/Tavily secrets: apply once, then
`terraform output -raw web_app_secret_access_key` and paste into Vercel's
encrypted env vars — never committed, never in a GitHub Actions secret
(this app isn't deployed by that workflow).

### 4.2 Dashboard data (`app/api/dashboard/route.ts`)

Runs 3 Athena queries via `StartQueryExecution` → poll `GetQueryExecution`
until `SUCCEEDED`/`FAILED` → `GetQueryResults`, against workgroup
`${name_prefix}-analytics` (result location is already fixed on the
workgroup, so the client doesn't need to set one):

1. Per-source record count for "today" (UTC date computed server-side at
   request time — **not** hardcoded, unlike the illustrative dates in
   `sql/sample_queries.sql`) — powers the KPI card and the bar chart.
2. 5 most recent rows across all tables (`UNION ALL ... ORDER BY
   ingested_at DESC LIMIT 5`) — powers "recent activity".
3. `cloudwatch:DescribeAlarms` (not Athena) filtered to this project's 6
   alarms — powers the "alarms breaching" KPI.

Response caches for 60s (Next.js `revalidate`) since Athena queries cost
money per scan and the underlying data only changes every 10 minutes
anyway.

### 4.3 Assistant data (`app/api/assistant/route.ts`)

```
POST { question: string, mode: "crag" | "agent" }
→ LambdaClient.invoke({
    FunctionName: mode === "crag" ? RAG_QUERY_FN : RAG_AGENT_FN,
    Payload: JSON.stringify({ question }),
  })
```

The two Lambdas' `lambda_handler` return shapes differ slightly (verified
by reading `rag/query.py` and `rag/agent.py`):

| field | `rag_query` (CRAG) | `rag_agent` |
|---|---|---|
| `answer` | string | string |
| `grounded` | bool | bool |
| `sources[]` | `{title,url,source,score,grade}` | `{title,url,source}` |
| mode-specific | `answer_source`, `discarded_low_relevance[]` | `tool_calls[]` |

The API route passes the raw Lambda payload straight through (typed as a
discriminated union on `mode`); the UI renders the shared fields the same
way for both and renders the "Tool trace" panel from whichever
mode-specific field is present, matching the two states already mocked in
the Design canvas.

## 5. Abuse protection

`api/assistant` is the only endpoint that costs real money per call
(Bedrock, via the Lambda). Upstash Redis (free tier) sliding-window limit:
5 requests/minute per IP, checked before invoking Lambda. On limit-exceeded,
the API returns 429 with a message the UI shows inline ("Đợi một chút rồi
hỏi tiếp") rather than a generic error. `api/dashboard` is not rate limited
beyond its 60s cache (query cost is fixed and small).

## 6. Screens

### 6.1 Dashboard (`/`)

4 KPI cards (records today, sources healthy — derived from whether each
source appears in today's per-source counts, alarms breaching, cost
estimate) + per-source volume bar chart + recent-activity list, all from
`GET /api/dashboard`. Loading and error states: skeleton cards while
fetching, an inline retry banner if Athena or CloudWatch calls fail (never
a blank page).

### 6.2 RAG Assistant (`/assistant`)

Mode toggle (CRAG / Agent) exactly as mocked, a single-question chat (not a
running conversation — each submit is a fresh Lambda invoke, matching how
these Lambdas actually work today with no session state), sources shown as
chips, mode-specific trace panel. Submit is disabled while a request is in
flight; a 429 from the rate limiter is shown as a dismissible inline
notice, not a crash.

## 7. Testing & verification

- `web/`: TypeScript build (`next build`) must pass; component-level tests
  are out of scope for this first iteration given the app is thin
  (API-route glue + presentational components) — verification is a real
  deploy plus manually exercising both screens against live AWS, the same
  bar every other feature in this project has been held to.
- Manual verification checklist (post-deploy): Dashboard shows real
  today's counts matching a manual Athena query; Assistant in both modes
  returns a real Bedrock-backed answer with sources; rate limiter actually
  returns 429 on a 6th rapid request.

## 8. Deployment

Vercel project connected to this GitHub repo, root directory `web/`,
auto-deploys on push to `main` (and preview deploys on PRs) — Vercel's own
git integration, independent of the existing `.github/workflows` Terraform
pipeline. Env vars set once in the Vercel dashboard: `AWS_ACCESS_KEY_ID`,
`AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `ATHENA_WORKGROUP`,
`ATHENA_DATABASE` (= `aws_glue_catalog_database.curated.name` output),
`RAG_QUERY_FUNCTION_NAME`, `RAG_AGENT_FUNCTION_NAME` (both already
Terraform outputs), `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`.

## 9. Open assumptions

- Upstash free tier is acceptable for a portfolio-traffic demo (generous
  enough that this is a safe default, not a risk worth a fallback design).
- "Sources healthy" on the dashboard is inferred from today's Athena counts
  rather than a live per-Lambda health check, since CloudWatch
  `GetMetricData` for 5 functions would add IAM scope and latency for a
  cosmetic KPI.
- `glue:GetTable`/`GetPartitions` resource scoping shown above as `"*"` is
  a placeholder to tighten to the specific database/table ARNs during
  implementation, not an intentional broad grant.
