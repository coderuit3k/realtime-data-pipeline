# CI/CD page — design spec

## Overview

Add a seventh real screen to the `web/` Next.js app: `/cicd`, showing the
real current state of this repo's own GitHub Actions pipeline (a 4-stage
visual matching the CI → Terraform Plan → manual approval gate → Terraform
Apply flow already used for every prior sub-project's deploys this
session) and a real recent-run history list. This is the fifth of 8
sub-projects extending the mockup to real, AWS-backed pages — the first
one whose real data source is GitHub, not AWS.

Reference mockup: Design canvas
`https://claude.ai/artifact/Ccbcs7E8ZSsf4fUG5opm4W`, `project/Cicd.dc.html`.

## Real data sources

The repo (`coderuit3k/realtime-data-pipeline`) is **public**, confirmed via
`gh repo view --json visibility`. Its two real workflows:

- `.github/workflows/ci.yml` — 3 parallel jobs on every push to `main`:
  `lint-and-test` (Python: ruff + pytest), `web-test` (tsc + vitest +
  build), `terraform-validate`.
- `.github/workflows/deploy.yml` — 2 jobs: `plan` (auto), `apply` (`needs:
  plan`, `environment: production` — this is the exact gate every prior
  sub-project's deploy in this session has waited on).

The mockup's 4-stage pipeline maps onto these real jobs as follows:

| Mockup stage | Real source |
|---|---|
| "Lint & Test" | CI workflow's `lint-and-test` job status/conclusion |
| "Terraform Plan" | Deploy workflow's `plan` job status/conclusion |
| "Chờ phê duyệt" | Deploy workflow's `apply` job, while GitHub reports its `status` as the real, documented value `"waiting"` (blocked on the `environment: production` protection rule) |
| "Terraform Apply" | The same `apply` job, once its `status` moves past `"waiting"` (`in_progress`/`completed`) |

Stages 3 and 4 are two phases of the SAME `apply` job's lifecycle, not two
separate jobs — this is accurately modeled as one job whose displayed
stage depends on its current `status`, not as two independent lookups.

The "Lịch sử chạy gần đây" panel uses the Deploy workflow's recent runs
(5 most recent, `branch=main`): each run's real `display_title` (GitHub's
own commit-message-derived title), `head_sha`, `conclusion`, and duration
(`updated_at - run_started_at`).

## Non-goals

- **No write access.** The "Phê duyệt để apply" button in the mockup is
  NOT wired to actually call GitHub's pending-deployment-approval API —
  per explicit user decision, since this page is public and a real
  approve action would let anyone on the internet trigger a real
  `terraform apply` against this project's live AWS account. The button
  becomes a real link to the actual GitHub Actions run's `html_url`, for
  the user to approve themselves in GitHub's own UI — same non-negotiable
  read-only posture already established for the web app (Explorer's SQL
  guard, no page in this app has ever been given a credential capable of
  a destructive or state-changing action against real infrastructure).
- No live-updating/polling UI — the page fetches once per load, same as
  every other real page in this app (Dashboard, Ops, etc.); the user
  refreshes to see a newer state, consistent with the whole app's
  established pattern.
- No historical trend/analytics over CI run times — just the current
  pipeline snapshot and a short recent-run list, matching the mockup.

## Architecture

```
GET /api/cicd
  → web/lib/github.ts:
      getLatestWorkflowRun("ci.yml")   → CI's latest run on main
      getLatestWorkflowRun("deploy.yml") → Deploy's latest run on main
      getRunJobs(deployRun.id)          → Deploy run's job list (plan, apply)
      getRecentRuns("deploy.yml", 5)    → last 5 Deploy runs
  → web/lib/types.ts: CicdResponse { stages: PipelineStage[], recentRuns: CicdRun[] }
  → Cache-Control: s-maxage=30 (shorter than other pages -- CI/CD state
    is the most time-sensitive thing an operator watches, matching how
    this session itself polled deploy gates in short intervals)
```

- **`web/lib/github.ts` (new).** A thin `fetch()`-based wrapper (no SDK
  needed — GitHub's REST API is plain HTTP/JSON) with a shared
  `githubRequest<T>(path: string): Promise<T>` helper that sets
  `Authorization: Bearer ${requiredEnv("GITHUB_TOKEN")}`,
  `Accept: application/vnd.github+json`, and a `User-Agent` header
  (required by GitHub's API, otherwise requests are rejected). Three
  exported functions:
  - `getLatestWorkflowRun(workflowFile: string): Promise<GithubRun | null>` —
    `GET /repos/{owner}/{repo}/actions/workflows/{workflowFile}/runs?branch=main&per_page=1`,
    returns the first run or `null` if the array is empty.
  - `getRunJobs(runId: number): Promise<GithubJob[]>` —
    `GET /repos/{owner}/{repo}/actions/runs/{runId}/jobs`.
  - `getRecentRuns(workflowFile: string, limit: number): Promise<GithubRun[]>` —
    same runs endpoint with `per_page=${limit}`.
  - `GITHUB_OWNER = "coderuit3k"` and `GITHUB_REPO = "realtime-data-pipeline"`
    are hardcoded constants (this app has exactly one repo to report on,
    same treatment as `PIPELINE_LAMBDAS`' hardcoded function list in the
    Ops sub-project) — not environment variables.
- **`web/lib/aws.ts` is NOT touched** — this is the first sub-project with
  no AWS client of any kind.
- **`web/lib/types.ts` (modified).** Adds `PipelineStage = { name: string;
  status: "success" | "failure" | "waiting" | "in_progress" | "pending" |
  "cancelled" | "skipped"; detail: string }`, `CicdRun = { title: string;
  sha: string; branch: string; conclusion: string | null; durationMs:
  number | null; htmlUrl: string }`, `CicdResponse = { stages:
  PipelineStage[]; recentRuns: CicdRun[]; latestDeployRunUrl: string |
  null }` (the last field backs the "open in GitHub Actions" link).
- **`web/app/api/cicd/route.ts` (new, GET).** Fetches CI's latest run,
  Deploy's latest run, that Deploy run's jobs, and Deploy's 5 most recent
  runs — in parallel via `Promise.all` where the calls are independent
  (the jobs fetch depends on the Deploy run's id, so it's sequenced after
  that one call, not blocking the other two). Builds the 4 `PipelineStage`
  entries from the real job statuses per the mapping table above.
- **`web/app/cicd/page.tsx` (new).** The 4-stage pipeline visual (circles
  + connecting lines, colored by real status — teal/success,
  amber/waiting, gray/pending, red/failure), a real `<a>` link (not a
  button with an onClick) to the latest Deploy run's GitHub Actions page,
  and the recent-run history list.
- **`web/components/NavBar.tsx`** gains a 7th entry: `{ href: "/cicd",
  label: "CI/CD" }`.

## New credential

`GITHUB_TOKEN` — a real, fine-grained GitHub Personal Access Token, scoped
to read-only `Actions` permission on exactly this one repository (no
write scope of any kind, on a public repo, so even a leaked token could
only ever read what's already publicly visible on github.com — the token
exists purely to raise the API rate ceiling from 60/hour unauthenticated
to 5,000/hour authenticated, not for confidentiality). Added as a Vercel
project environment variable by the user themselves, same manual pattern
as every AWS credential and the Upstash credentials added in prior
sub-projects — never generated or handled by the assistant.

## Error handling

Matches the established convention: any failure (missing env var, GitHub
API error, rate limit) → `console.error` + `{ error: "Không tải được
CI/CD, thử lại sau." }` at 500, uncached.

## Testing

- `web/lib/github.test.ts` — each of the 3 functions correctly builds its
  request URL/headers and maps a mocked `fetch` JSON response into the
  expected shape; a non-2xx response throws a clear error (mirroring the
  error-message convention already used by `runAthenaQuery`); an empty
  runs array returns `null` (for `getLatestWorkflowRun`) rather than
  throwing.
- `web/app/api/cicd/route.test.ts` — builds the correct 4 stages for:
  (a) a fully green latest run (all `success`), (b) the `apply` job in
  `"waiting"` status (the live gate case this session has repeatedly
  hit), (c) a `plan` failure (subsequent stages shown as not-yet-reached),
  and the 500 error path.
- No component tests (project convention) — manual live-verification
  checklist after deploy: load `/cicd`, confirm the 4 stages reflect the
  actual current state of the most recent real Deploy run (cross-check
  against `gh run list`/`gh run view` output), confirm the recent-run
  list shows real commit titles and SHAs matching `git log`, confirm the
  "view in GitHub Actions" link opens the real run.

## Open assumptions

- GitHub's Jobs API reports an environment-gated job's `status` as
  `"waiting"` while it awaits a required reviewer — this is the
  documented, stable GitHub Actions REST API behavior this design relies
  on; verified against GitHub's own REST API reference during
  brainstorming, not assumed.
- CI and Deploy's `branch=main`-filtered latest runs are treated as
  corresponding to the same commit without explicitly cross-checking
  `head_sha` equality — true for this project's actual workflow (every
  change lands via direct push to `main`, both workflows trigger on the
  same `push` event, no PR-only CI runs ever ranked ahead of a `main`
  push in the `branch=main`-filtered list). If a future PR-based workflow
  is introduced, this assumption would need revisiting — out of scope now.
