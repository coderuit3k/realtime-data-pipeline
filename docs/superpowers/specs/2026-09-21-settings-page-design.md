# Settings page — design spec

## Overview

Add a real `/settings` screen to the `web/` Next.js app showing the real
configuration behind this project's 5 real ingestion sources and 2 real
Secrets Manager secrets: real EventBridge schedule state (enabled/
disabled, the real schedule expression), and real secret-configured
status. This is the seventh of 8 sub-projects extending the mockup to
real, AWS-backed pages.

Reference mockup: Design canvas
`https://claude.ai/artifact/Ccbcs7E8ZSsf4fUG5opm4W`, `project/Settings.dc.html`.

## Real data sources

- `web/lib/eventbridge.ts`'s existing `getScheduleStatus(client, ruleName)`
  (built for the Ops sub-project) returns `{ scheduleExpression, enabled }`
  from a real `DescribeRuleCommand` call — reused unchanged.
- Two real EventBridge rules exist (`infra/eventbridge.tf`, added during
  the Ops sub-project's news-rate-limit incident fix):
  `aws_cloudwatch_event_rule.ingestion_schedule` (shared by Hacker News,
  Weather, Crypto, GitHub Trending — `rate(10 minutes)` by default) and
  `aws_cloudwatch_event_rule.news_ingestion_schedule` (News API only,
  `rate(20 minutes)` by default, added specifically because NewsAPI's
  free tier caps at 100 requests/day and the shared 10-minute rule was
  exceeding it).
- 2 real Secrets Manager secrets exist (`infra/secrets.tf`):
  `aws_secretsmanager_secret.news_api` (output `news_secret_name`) and
  `aws_secretsmanager_secret.tavily_api` (output `tavily_secret_name`,
  used by the RAG assistant's CRAG web-search fallback, unrelated to
  ingestion). A real `DescribeSecretCommand` call's `VersionIdsToStages`
  field (verified via `@aws-sdk/client-secrets-manager`'s real
  `.d.ts` types) shows whether any version currently carries the
  `AWSCURRENT` stage — the real, metadata-only signal that a value has
  been set, without ever calling `GetSecretValue`.
- Static real facts (no live check needed, cited to their source):
  `common/config.py`'s `NEWS_QUERY` default (`"cryptocurrency OR
  technology"`), `GITHUB_TRENDING_DAYS`/`GITHUB_TRENDING_LIMIT` (`7`/
  `20`), `WEATHER_LOCATION_NAMES` (reused from `web/lib/weatherMeta.ts`,
  built for the Weather sub-project — not re-declared here),
  `CRYPTO_COIN_IDS` (`bitcoin`, `ethereum`, `solana`), and GitHub's own
  documented unauthenticated Search API rate limit (10 requests/minute —
  confirmed via GitHub's REST API rate-limit docs during brainstorming;
  this ingestion calls `GET /search/repositories`, the Search endpoint,
  confirmed in `ingestion/github_trending_ingestion.py`).

## Non-goals

- **No write access.** The mockup's "Tạm dừng lịch ingest" (pause
  ingestion) button is NOT wired to any real mutating call — this page
  shows the real EventBridge rule's real enabled/disabled state, with no
  button. Pausing stays a manual `terraform apply
  -var="enable_ingestion_schedule=false"` step, exactly as
  `infra/README.md` already documents. Same non-negotiable rule as
  Explorer's SQL guard and CI/CD's inert-link-only approval button — no
  page in this app has ever been given a credential capable of a
  destructive or state-changing action against real infrastructure.
- **No PII on a public page.** The mockup's alarm-notification email
  (`alarm_email`, a plain Terraform variable in `terraform.tfvars`, never
  committed, no existing Terraform output) is dropped entirely — not
  fetched, not shown, not even in masked form. This page is public.
- **No live-editable ingestion config.** The mockup's dashed "+ thêm khu
  vực" / "+ thêm coin" chips (implying an in-place add-a-location/
  add-a-coin action) are dropped — this app has no mechanism to add a
  real ingestion source at runtime; doing so requires a code change to
  `common/config.py` plus a redeploy. Replaced with a static caption
  saying so, rather than a dead-looking interactive affordance.
- **No secret values.** `getSecretStatus` never calls `GetSecretValue` —
  only `DescribeSecret`'s metadata. The actual secret content never
  reaches this app's server or client code, consistent with this
  session's standing rule that the assistant/app never handles real
  credentials.
- **No live-updating/polling.** Fetches once per load, same as every
  other real page in this app.

## Architecture

```
GET /api/settings
  → web/lib/eventbridge.ts: getScheduleStatus(client, sharedRuleName)
  → web/lib/eventbridge.ts: getScheduleStatus(client, newsRuleName)
  → web/lib/secretsManager.ts: getSecretStatus(client, newsSecretId)
  → web/lib/secretsManager.ts: getSecretStatus(client, tavilySecretId)
  → web/lib/types.ts: SettingsResponse {
      sharedSchedule: { scheduleExpression: string; enabled: boolean };
      newsSchedule: { scheduleExpression: string; enabled: boolean };
      secrets: { name: string; configured: boolean }[];
    }
  → Cache-Control: s-maxage=60, stale-while-revalidate=120 (matches
    Dashboard/Insights/Ops/Weather's cadence for ~10-minute-refreshed
    infrastructure state)
```

- **`web/lib/secretsManager.ts` (new).** `getSecretStatus(client:
  SecretsManagerClient, secretId: string): Promise<{ configured: boolean
  }>` — wraps `DescribeSecretCommand`, checks
  `Object.values(response.VersionIdsToStages ?? {}).some(stages =>
  stages.includes("AWSCURRENT"))`.
- **`web/lib/aws.ts` (modified, additive).** Adds
  `getSecretsManagerClient(): SecretsManagerClient`, same pattern as the
  existing client getters.
- **`web/lib/settingsMeta.ts` (new).** Static per-data-source metadata:
  `{ id: string; name: string; description: string; usesNewsSchedule:
  boolean; detail: string }[]` for the 5 ingestion sources (Hacker News,
  News API, Weather, Crypto, GitHub Trending), each `detail` string
  citing its real source (query default, location count, coin list,
  rate-limit note) as described above. `SECRET_LABELS` maps the 2 real
  secret env-var-style names (`news-api-key`, `tavily-api-key`) to their
  display labels, matching the mockup's naming.
- **`web/lib/types.ts` (modified, additive).** Adds `ScheduleStatus`,
  `SecretStatus`, `SettingsResponse` as shown above.
- **`web/app/api/settings/route.ts` (new, GET).** `Promise.all` of the 4
  real calls. Rule names are derived client-side by string construction
  from `ALARM_NAME_PREFIX`, exactly matching Ops's already-shipped,
  already-reviewed pattern (`ops/route.ts`: `` `${prefix}-ingestion-schedule` ``,
  read via `requiredEnv`, not a dedicated per-rule env var) — this route
  adds `` `${prefix}-news-ingestion-schedule` `` the same way, matching
  the real Terraform resource name in `infra/eventbridge.tf`. No new env
  var or Terraform output is needed for either rule name at the route
  level. Secret ids ARE new env vars (`NEWS_SECRET_NAME`,
  `TAVILY_SECRET_NAME`, both via `requiredEnv`), but sourced from the
  Terraform outputs that already exist (`news_secret_name`,
  `tavily_secret_name`) — no new output needed for these either.
- **`web/app/settings/page.tsx` (new).** Two cards: "Nguồn dữ liệu" (5
  rows built from `settingsMeta.ts`'s static metadata merged with the
  real `sharedSchedule`/`newsSchedule` status per row's
  `usesNewsSchedule` flag — a colored dot for enabled/disabled, the real
  schedule expression as a chip, and the `detail` string), "Secrets
  Manager" (2 rows, real configured/not, plus the mockup's existing
  static caption about values being set via AWS CLI). A small caption
  under the data-sources card replaces the "+ add" chips: "Chỉnh sửa
  nguồn dữ liệu qua common/config.py + redeploy."
- **`web/components/NavBar.tsx`** gains a 9th entry: `{ href:
  "/settings", label: "Settings" }`.

## New credential / IAM (manual, added by the user, never by CI or the assistant)

- `events:DescribeRule` extended to include the news rule's ARN (the
  existing `EventBridgeReadSchedule` statement in `infra/README.md`'s IAM
  script currently lists only `ingestion_schedule_rule_name`'s ARN —
  extended to a 2-ARN `Resource` list). This is IAM-script-only, not
  needed by the runtime route (see above) — requires a new Terraform
  output, `news_ingestion_schedule_rule_name`
  (`aws_cloudwatch_event_rule.news_ingestion_schedule.name`), mirroring
  the existing `ingestion_schedule_rule_name` output exactly, so the
  script can derive the exact ARN the same safe way rather than
  string-guessing it in bash (the precise lesson from the Ops
  sub-project's real IAM-ARN-construction incident).
- `secretsmanager:DescribeSecret`, a new statement scoped to exactly the
  2 real secret ARNs (`news_secret_name`, `tavily_secret_name` outputs,
  already exist) — metadata-only, no `GetSecretValue` ever granted.

## Error handling

Matches the established convention: any failure → `console.error` + `{
error: "Không tải được Settings, thử lại sau." }` at 500, uncached.

## Testing

- `web/lib/secretsManager.test.ts` — `getSecretStatus` returns
  `configured: true` when `VersionIdsToStages` has an entry whose stages
  array includes `"AWSCURRENT"`; `configured: false` when
  `VersionIdsToStages` is empty/undefined or has entries but none staged
  `AWSCURRENT`.
- `web/app/api/settings/route.test.ts` — happy path (mocked EventBridge +
  Secrets Manager clients → correctly mapped `SettingsResponse`), 500
  error path.
- No component tests (project convention) — manual live-verification
  checklist after deploy: load `/settings`, confirm both real schedule
  rows show real, currently-true enabled state and the real schedule
  expressions (`rate(10 minutes)` shared, `rate(20 minutes)` news, unless
  changed since), confirm both secrets show `configured: true` (both were
  set via AWS CLI earlier this project), confirm no alarm email, pause
  button, or "+ add" affordance appears anywhere on the page.

## Open assumptions

- `VersionIdsToStages`'s `AWSCURRENT`-presence check is a metadata
  inference, not a documented AWS guarantee that "a value exists" — it's
  the standard, real way every AWS SDK reference and the AWS CLI docs
  describe determining a secret's current version, so treated as
  reliable, but will be cross-checked against this project's own 2 real,
  already-configured secrets during live verification (Task 5) to
  confirm it actually reports `true` for them.
