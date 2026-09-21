# Real month-to-date cost — design spec

## Overview

Replace the static, hardcoded `COST_ESTIMATE_USD = 1.02` figure shown on
Dashboard and Ops (currently identical every time, regardless of when
you look) with a real, live AWS Cost Explorer query returning genuine
month-to-date spend. Landing keeps the static nominal figure unchanged
-- it was deliberately built with zero live fetches, and real
month-to-date cost is inherently time-varying data that would undermine
that design.

## Real data sources

- `AWS Cost Explorer`'s `GetCostAndUsage` API, real field names verified
  against `@aws-sdk/client-cost-explorer`'s actual `.d.ts` types during
  brainstorming: `GetCostAndUsageRequest { TimePeriod: DateInterval
  {Start, End}, Granularity, Metrics: string[] }`, response
  `GetCostAndUsageResponse { ResultsByTime?: ResultByTime[] }`, each
  `ResultByTime { Total?: Record<string, MetricValue> }`, `MetricValue {
  Amount?: string; Unit?: string }`. `TimePeriod.End` is exclusive
  (confirmed from the real SDK doc comment) -- to include today's data,
  `End` must be tomorrow's date, not today's.
- Real, verified operational constraints (via WebSearch during
  brainstorming, not assumed):
  - Cost Explorer's API endpoint is fixed at `us-east-1`
    (`https://ce.us-east-1.amazonaws.com`) regardless of the account's
    other resources' region.
  - Each `GetCostAndUsage` request costs a real **$0.01** (primary
    billing view). This is non-negligible relative to this whole
    project's own ~$1/month infrastructure cost -- caching strategy is
    a first-class design constraint here, not an afterthought.
  - Cost Explorer's underlying data refreshes at most ~3 times/day
    (roughly every 8 hours) with up to 24 hours of lag. Querying more
    often than the data itself changes buys no real freshness.
- `infra/README.md`'s existing cost table, still the source for
  Landing's unchanged static figure and for the new real line item
  described below.

## Non-goals

- No live fetch added to the Landing page (`/`) -- confirmed with the
  user explicitly. It keeps showing the existing static
  `COST_ESTIMATE_USD` (via `landingMeta.ts`'s `MONTHLY_COST_USD`,
  unchanged) as a nominal "about what this costs" figure.
- No new infrastructure (Lambda, cron, S3/DynamoDB cache) to pre-compute
  or store the cost value -- Vercel's own CDN cache (`Cache-Control:
  s-maxage`) is sufficient and consistent with every other route in this
  app; a dedicated backing service would be real scope creep for a
  single dollar figure.
- No cost breakdown by service/dimension (`GroupBy`) -- just the one
  real month-to-date total. `COST_BREAKDOWN`'s existing static,
  hand-maintained per-category estimates on the Ops page are unrelated
  and unchanged, aside from gaining one new real line item (below).

## Architecture

```
GET /api/cost   (new, dedicated route -- NOT folded into /api/dashboard
                 or /api/ops, because this data needs a completely
                 different cache lifetime: those routes' other data
                 legitimately wants ~60s freshness; this one only
                 changes a few times a day and costs real money per query)
  → web/lib/aws.ts: getCostExplorerClient() -- hardcoded region:
    "us-east-1", NOT the app's AWS_REGION env var (Cost Explorer's real
    endpoint is fixed there regardless of deployment region -- a
    deliberate, documented exception to every other client getter's
    pattern in this file)
  → web/lib/costExplorer.ts: getMonthToDateCostUsd(client)
      TimePeriod: { Start: <first day of current UTC month>,
                     End: <tomorrow, UTC> }   (End is exclusive)
      Granularity: "MONTHLY"
      Metrics: ["UnblendedCost"]
      → parses ResultsByTime[0]?.Total?.UnblendedCost?.Amount (a string)
        to a number
  → web/lib/types.ts: CostResponse { monthToDateCostUsd: number }
  → Cache-Control: public, s-maxage=86400, stale-while-revalidate=172800
    (24h -- matches Cost Explorer's own real ~8h refresh cadence closely
    enough that nothing is lost by not querying more often, and keeps
    this route's own real API cost to roughly $0.01/day = ~$0.30/month)
```

- **`web/lib/costExplorer.ts` (new).** `getMonthToDateCostUsd(client:
  CostExplorerClient): Promise<number>` as described above.
- **`web/lib/aws.ts` (modified, additive).** Adds
  `getCostExplorerClient(): CostExplorerClient`, hardcoded
  `region: "us-east-1"` -- the one client getter in this file that does
  NOT read `AWS_REGION`, with an inline comment explaining why.
- **`web/lib/types.ts` (modified).** Adds `CostResponse = {
  monthToDateCostUsd: number }`. Removes `costEstimateUsd` from the
  existing `DashboardResponse` and `OpsResponse` types (that field moves
  to the new, separately-fetched `CostResponse` instead).
- **`web/app/api/cost/route.ts` (new, GET).** Calls
  `getMonthToDateCostUsd(getCostExplorerClient())`, returns
  `CostResponse` with the 24h Cache-Control above. Error handling
  matches the established convention (`console.error` + safe Vietnamese
  message + 500, uncached).
- **`web/app/api/dashboard/route.ts` (modified).** Removes the
  `COST_ESTIMATE_USD` import and the `costEstimateUsd` field from its
  response -- this route's own data (source volumes, alarms) keeps its
  existing ~60s freshness, now fully decoupled from the cost query's 24h
  cadence.
- **`web/app/api/ops/route.ts` (modified).** Same removal. `COST_BREAKDOWN`
  (still imported from `opsMeta.ts`, unrelated to the live query) gains
  one new real entry: `{ category: "Cost Explorer API", monthlyUsd: 0.30
  }`, cited to the real $0.01/call × ~1 call/day (from the 24h cache) ×
  30 days math above -- this feature's own real cost gets disclosed the
  same way every other line item on this page already is.
- **`web/app/dashboard/page.tsx` / `web/app/ops/page.tsx` (both
  modified).** Each gains a second, independent `fetch("/api/cost")` on
  mount (same pattern already established by Weather's secondary
  history fetch: independent loading state, a failure here must not
  block the page's primary content) and renders its cost KPI card from
  that fetch's result instead of the now-removed `costEstimateUsd` field
  on its primary route's response.
- **`web/lib/opsMeta.ts` (unchanged).** `COST_ESTIMATE_USD` stays exactly
  as it is -- Landing still imports it via `landingMeta.ts`'s
  `MONTHLY_COST_USD`. `COST_BREAKDOWN` gains the one new entry described
  above.

## New credential / IAM (manual, added by the user, never by CI or the assistant)

- `ce:GetCostAndUsage`, a new statement in the existing manual IAM
  script (`infra/README.md`'s "Web app IAM user" section), `Resource:
  "*"` -- Cost Explorer has no resource-level ARN scoping for this
  action, same treatment as the existing `cloudwatch:GetMetricData`/
  `DescribeAlarms` grants.
- **Real prerequisite, not an assumption:** AWS Cost Explorer must be
  enabled for the account (via the AWS Billing console) before
  `GetCostAndUsage` will return real data -- if it has never been
  enabled, the first real API call may fail or return empty results.
  The user checks/enables this themselves, same as every other manual
  AWS setup step this session (e.g. setting Secrets Manager values,
  running the IAM policy script).

## Error handling

`/api/cost` matches the established convention: `console.error` + `{
error: "Không tải được chi phí, thử lại sau." }` at 500, uncached. On
Dashboard/Ops pages, a failed `/api/cost` fetch must not block the
page's own primary content -- the cost KPI card shows its own
independent loading/error state (e.g. "—") while the rest of the page's
real data renders normally, matching Weather's established pattern for
its own secondary fetch.

## Testing

- `web/lib/costExplorer.test.ts` -- `getMonthToDateCostUsd` correctly
  parses a real-shaped mocked response (`ResultsByTime[0].Total.UnblendedCost.Amount`
  as a string) into a number; handles an empty/missing `ResultsByTime`
  gracefully (returns `0` rather than throwing, since a brand-new
  month's first query could plausibly return an empty result set before
  any cost has accrued).
- `web/app/api/cost/route.test.ts` -- happy path, 500 error path, matching
  every other route's test convention.
- `web/app/api/dashboard/route.test.ts` / `web/app/api/ops/route.test.ts`
  -- updated to confirm `costEstimateUsd` no longer appears in either
  response shape.
- No component test for the pages' new secondary fetch (project
  convention) -- manual live-verification checklist after deploy: load
  `/dashboard` and `/ops`, confirm both show a real, plausible
  month-to-date dollar figure (not `$1.02`, not `$0`, unless the account
  genuinely has zero month-to-date spend at verification time -- cross-
  check against the real AWS Billing console's own Cost Explorer view);
  confirm `/` (Landing) still shows the unchanged static `$1` figure with
  no live fetch (re-confirm the non-goal wasn't accidentally violated).

## Open assumptions

- `UnblendedCost` is the right metric for "what this actually costs" --
  it's the standard, most commonly recommended Cost Explorer metric for
  this purpose (costs after discounts, before RI/Savings Plan
  amortization), and this project has no reserved capacity of any kind,
  so the distinction between `UnblendedCost` and other cost metrics
  (e.g. `AmortizedCost`) shouldn't matter in practice for this account.
- The $0.30/month "Cost Explorer API" line item is itself an estimate
  (1 real call/day from the 24h cache, assuming steady traffic keeps the
  cache warm) -- like every other hand-maintained figure in
  `COST_BREAKDOWN`, it's a real, cited approximation, not a live-queried
  number, and is explicitly not asserted to reconcile exactly with
  `COST_BREAKDOWN`'s other entries or with the page's own top-line
  `monthToDateCostUsd` (which already carries this exact caveat from the
  Ops sub-project).
