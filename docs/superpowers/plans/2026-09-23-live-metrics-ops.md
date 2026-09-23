# Live Metrics & Ops (Dashboard/Ops Merge) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge `/dashboard` and `/ops` into a single "Live Metrics & Ops" page at `/dashboard`, matching the Stitch "Terminal Obsidian · Phương án 1" design's second sub-project, backed entirely by real data — including two genuinely new real metrics (S3 bucket storage size via CloudWatch, Athena average query time via CloudWatch) that required no new AWS infrastructure, only two new read-only environment variables.

**Architecture:** `web/app/api/dashboard/route.ts` currently returns Athena-derived ingestion volume plus a basic alarm count; `web/app/api/ops/route.ts` (left untouched by this plan, orphaned like `/settings`/`/weather`) separately returns Lambda health, EventBridge schedule, alarms, cost breakdown, and recent logs. This plan merges the latter's real data sources into `/api/dashboard`'s response, adds two new lib functions (`getBucketStorageStats`, `getAthenaAvgQueryTimeMs`) that call already-permitted CloudWatch APIs (`cloudwatch:GetMetricData` is already granted with `Resource: "*"` — no new IAM policy needed), and rebuilds `web/app/dashboard/page.tsx` into the fuller "Live Metrics & Ops" layout. `web/app/ops/page.tsx` and `web/app/api/ops/route.ts` are not modified or deleted — only unlinked from the sidebar, exactly like `/settings` and `/weather` were in the prior sub-project.

**Tech Stack:** Next.js 15 App Router, TypeScript, Vitest (`environment: "node"`, no component-test infra — same constraint as the prior sub-project), `@aws-sdk/client-cloudwatch`.

**Spec:** No separate spec file, consistent with this project's prior Stitch-design sub-project (Sidebar 4-item IA + Showcase & Overview) — scoped directly during brainstorming and approved in-chat.

## Global Constraints

- Every number shown on the merged page must come from a real, already-integrated data source (Athena, CloudWatch, Cost Explorer) — never fabricated.
- No credential of any kind is added; no code path in this plan is capable of a write/destructive action against real infrastructure. The mockup's "Emergency Control Plane" buttons (Trigger Lambda, Flush Cache, Run Athena Query Test) are NOT implemented in any form — replaced by a "Liên kết nhanh" panel of plain external hyperlinks (AWS Console, GitHub Actions) that this app never calls.
- Two new environment variables are required on Vercel before this plan's route works in production: `RAW_BUCKET` and `CURATED_BUCKET` (the real S3 bucket names — plain strings, not secrets). They are retrieved by running `terraform output raw_bucket_name` / `terraform output curated_bucket_name` from `infra/`. No new IAM permission is required (`cloudwatch:GetMetricData` is already granted with `Resource: "*"`, and CloudWatch metric reads are not ARN-scoped).
- `web/app/ops/page.tsx` and `web/app/api/ops/route.ts` are left completely untouched by every task in this plan — not modified, not deleted. `lib/opsMeta.ts`'s `OpsResponse`-related exports (`PIPELINE_LAMBDAS`, `COST_BREAKDOWN`) are reused (imported), not moved or renamed.
- `/settings`, `/weather`, `/cicd`, `/explorer`, `/insights` and their sidebar entries are untouched by this plan.
- No component-rendering test infrastructure is added. `web/components/Sidebar.tsx` and `web/app/dashboard/page.tsx` changes are verified by `tsc --noEmit` and `next build`, not new `.test.tsx` files. `web/lib/*.ts` and `web/app/api/*/route.ts` changes get Vitest tests as usual.

---

### Task 1: `getBucketStorageStats()` — real S3 size via CloudWatch

**Files:**
- Create: `web/lib/s3Metrics.ts`
- Create: `web/lib/s3Metrics.test.ts`
- Modify: `web/lib/types.ts`

**Interfaces:**
- Consumes: nothing new (only `@aws-sdk/client-cloudwatch`'s `GetMetricDataCommand`, following the exact pattern already in `web/lib/cloudwatchMetrics.ts`).
- Produces: `getBucketStorageStats(client: CloudWatchClient, bucketName: string): Promise<StorageStats>` where `StorageStats = { sizeBytes: number | null; objectCount: number | null }` (added to `lib/types.ts`). Task 3 imports both.

- [ ] **Step 1: Write the failing test**

Create `web/lib/s3Metrics.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { getBucketStorageStats } from "./s3Metrics";

describe("getBucketStorageStats", () => {
  it("returns the latest daily size and object count for a real bucket", async () => {
    const send = vi.fn().mockResolvedValue({
      MetricDataResults: [
        {
          Id: "sizeBytes",
          Values: [104857600, 115343360],
          Timestamps: [new Date("2026-09-21T00:00:00Z"), new Date("2026-09-22T00:00:00Z")],
        },
        {
          Id: "objectCount",
          Values: [412, 430],
          Timestamps: [new Date("2026-09-21T00:00:00Z"), new Date("2026-09-22T00:00:00Z")],
        },
      ],
    });
    const client = { send } as unknown as import("@aws-sdk/client-cloudwatch").CloudWatchClient;

    const stats = await getBucketStorageStats(client, "realtime-data-pipeline-dev-raw-123456789012");

    expect(stats).toEqual({ sizeBytes: 115343360, objectCount: 430 });

    const [command] = send.mock.calls[0];
    expect(command.input.MetricDataQueries).toEqual([
      {
        Id: "sizeBytes",
        MetricStat: {
          Metric: {
            Namespace: "AWS/S3",
            MetricName: "BucketSizeBytes",
            Dimensions: [
              { Name: "BucketName", Value: "realtime-data-pipeline-dev-raw-123456789012" },
              { Name: "StorageType", Value: "StandardStorage" },
            ],
          },
          Period: 86400,
          Stat: "Average",
        },
        ReturnData: true,
      },
      {
        Id: "objectCount",
        MetricStat: {
          Metric: {
            Namespace: "AWS/S3",
            MetricName: "NumberOfObjects",
            Dimensions: [
              { Name: "BucketName", Value: "realtime-data-pipeline-dev-raw-123456789012" },
              { Name: "StorageType", Value: "AllStorageTypes" },
            ],
          },
          Period: 86400,
          Stat: "Average",
        },
        ReturnData: true,
      },
    ]);
  });

  it("returns null for both fields when the bucket has no published storage metrics yet", async () => {
    const send = vi.fn().mockResolvedValue({ MetricDataResults: [{ Id: "sizeBytes", Values: [] }, { Id: "objectCount", Values: [] }] });
    const client = { send } as unknown as import("@aws-sdk/client-cloudwatch").CloudWatchClient;

    const stats = await getBucketStorageStats(client, "some-new-bucket");

    expect(stats).toEqual({ sizeBytes: null, objectCount: null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run lib/s3Metrics.test.ts`
Expected: FAIL — cannot find module `./s3Metrics`.

- [ ] **Step 3: Write minimal implementation**

Add to `web/lib/types.ts` (after the existing `CostBreakdownEntry` type):

```ts
export type StorageStats = { sizeBytes: number | null; objectCount: number | null };
```

Create `web/lib/s3Metrics.ts`:

```ts
import { GetMetricDataCommand, type CloudWatchClient } from "@aws-sdk/client-cloudwatch";
import type { StorageStats } from "./types";

// S3 storage metrics (BucketSizeBytes, NumberOfObjects) publish once per
// day, not in real time -- a 2-day window guarantees at least one real
// datapoint even right after UTC midnight before today's has landed.
const WINDOW_MS = 2 * 24 * 60 * 60 * 1000;
const PERIOD_SECONDS = 86400;

function latestValue(values: number[], timestamps: Date[]): number | null {
  if (values.length === 0) return null;
  let latestIndex = 0;
  for (let i = 1; i < timestamps.length; i++) {
    if (timestamps[i] > timestamps[latestIndex]) latestIndex = i;
  }
  return Math.round(values[latestIndex]);
}

export async function getBucketStorageStats(client: CloudWatchClient, bucketName: string): Promise<StorageStats> {
  const now = new Date();
  const response = await client.send(
    new GetMetricDataCommand({
      StartTime: new Date(now.getTime() - WINDOW_MS),
      EndTime: now,
      MetricDataQueries: [
        {
          Id: "sizeBytes",
          MetricStat: {
            Metric: {
              Namespace: "AWS/S3",
              MetricName: "BucketSizeBytes",
              Dimensions: [
                { Name: "BucketName", Value: bucketName },
                { Name: "StorageType", Value: "StandardStorage" },
              ],
            },
            Period: PERIOD_SECONDS,
            Stat: "Average",
          },
          ReturnData: true,
        },
        {
          Id: "objectCount",
          MetricStat: {
            Metric: {
              Namespace: "AWS/S3",
              MetricName: "NumberOfObjects",
              Dimensions: [
                { Name: "BucketName", Value: bucketName },
                { Name: "StorageType", Value: "AllStorageTypes" },
              ],
            },
            Period: PERIOD_SECONDS,
            Stat: "Average",
          },
          ReturnData: true,
        },
      ],
    })
  );

  const byId = new Map((response.MetricDataResults ?? []).map((r) => [r.Id ?? "", r]));
  const sizeResult = byId.get("sizeBytes");
  const countResult = byId.get("objectCount");

  return {
    sizeBytes: latestValue(sizeResult?.Values ?? [], sizeResult?.Timestamps ?? []),
    objectCount: latestValue(countResult?.Values ?? [], countResult?.Timestamps ?? []),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run lib/s3Metrics.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd web && git add lib/s3Metrics.ts lib/s3Metrics.test.ts lib/types.ts
git commit -m "feat: add getBucketStorageStats for real S3 bucket size via CloudWatch"
```

---

### Task 2: `getAthenaAvgQueryTimeMs()` — real Athena query latency via CloudWatch

**Files:**
- Create: `web/lib/athenaMetrics.ts`
- Create: `web/lib/athenaMetrics.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `getAthenaAvgQueryTimeMs(client: CloudWatchClient, workgroup: string): Promise<number | null>`. Task 3 imports this.

- [ ] **Step 1: Write the failing test**

Create `web/lib/athenaMetrics.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { getAthenaAvgQueryTimeMs } from "./athenaMetrics";

describe("getAthenaAvgQueryTimeMs", () => {
  it("averages TotalExecutionTime across the last 24h for the real workgroup", async () => {
    const send = vi.fn().mockResolvedValue({
      MetricDataResults: [{ Id: "totalExecutionTime", Values: [1200, 1800, 1500] }],
    });
    const client = { send } as unknown as import("@aws-sdk/client-cloudwatch").CloudWatchClient;

    const avgMs = await getAthenaAvgQueryTimeMs(client, "realtime-data-pipeline-dev-analytics");

    expect(avgMs).toBe(1500);

    const [command] = send.mock.calls[0];
    expect(command.input.MetricDataQueries).toEqual([
      {
        Id: "totalExecutionTime",
        MetricStat: {
          Metric: {
            Namespace: "AWS/Athena",
            MetricName: "TotalExecutionTime",
            Dimensions: [{ Name: "WorkGroup", Value: "realtime-data-pipeline-dev-analytics" }],
          },
          Period: 3600,
          Stat: "Average",
        },
        ReturnData: true,
      },
    ]);
  });

  it("returns null when no queries ran in the workgroup in the last 24h", async () => {
    const send = vi.fn().mockResolvedValue({ MetricDataResults: [{ Id: "totalExecutionTime", Values: [] }] });
    const client = { send } as unknown as import("@aws-sdk/client-cloudwatch").CloudWatchClient;

    const avgMs = await getAthenaAvgQueryTimeMs(client, "wg");

    expect(avgMs).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run lib/athenaMetrics.test.ts`
Expected: FAIL — cannot find module `./athenaMetrics`.

- [ ] **Step 3: Write minimal implementation**

Create `web/lib/athenaMetrics.ts`:

```ts
import { GetMetricDataCommand, type CloudWatchClient } from "@aws-sdk/client-cloudwatch";

const WINDOW_MS = 24 * 60 * 60 * 1000;
const PERIOD_SECONDS = 3600;

export async function getAthenaAvgQueryTimeMs(client: CloudWatchClient, workgroup: string): Promise<number | null> {
  const now = new Date();
  const response = await client.send(
    new GetMetricDataCommand({
      StartTime: new Date(now.getTime() - WINDOW_MS),
      EndTime: now,
      MetricDataQueries: [
        {
          Id: "totalExecutionTime",
          MetricStat: {
            Metric: {
              Namespace: "AWS/Athena",
              MetricName: "TotalExecutionTime",
              Dimensions: [{ Name: "WorkGroup", Value: workgroup }],
            },
            Period: PERIOD_SECONDS,
            Stat: "Average",
          },
          ReturnData: true,
        },
      ],
    })
  );

  const values = response.MetricDataResults?.[0]?.Values ?? [];
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, v) => sum + v, 0) / values.length);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run lib/athenaMetrics.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd web && git add lib/athenaMetrics.ts lib/athenaMetrics.test.ts
git commit -m "feat: add getAthenaAvgQueryTimeMs for real Athena query latency via CloudWatch"
```

---

### Task 3: Merge Ops data into `GET /api/dashboard`

**Files:**
- Modify: `web/lib/types.ts`
- Modify: `web/app/api/dashboard/route.ts`
- Modify: `web/app/api/dashboard/route.test.ts`

**Interfaces:**
- Consumes: `getBucketStorageStats` (Task 1), `getAthenaAvgQueryTimeMs` (Task 2), plus already-existing `getAlarmStatus` (`@/lib/cloudwatchAlarms`), `getScheduleStatus` (`@/lib/eventbridge`), `getLambdaHealth` (`@/lib/cloudwatchMetrics`), `queryRecentLogs` (`@/lib/cloudwatchLogs`), `PIPELINE_LAMBDAS`/`COST_BREAKDOWN` (`@/lib/opsMeta`) — all unchanged, already used by `/api/ops`.
- Produces: the extended `DashboardResponse` shape below. Task 4's page consumes every field.

- [ ] **Step 1: Write the failing test**

Replace `web/app/api/dashboard/route.test.ts` entirely with:

```ts
// web/app/api/dashboard/route.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/aws", () => ({
  getAthenaClient: vi.fn(() => ({})),
  getCloudWatchClient: vi.fn(() => ({})),
  getEventBridgeClient: vi.fn(() => ({})),
  getCloudWatchLogsClient: vi.fn(() => ({})),
  requiredEnv: vi.fn((name: string) => {
    if (name === "ALARM_NAME_PREFIX") return "realtime-data-pipeline-dev";
    if (name === "RAW_BUCKET") return "realtime-data-pipeline-dev-raw-123456789012";
    if (name === "CURATED_BUCKET") return "realtime-data-pipeline-dev-curated-123456789012";
    if (name === "ATHENA_WORKGROUP") return "realtime-data-pipeline-dev-analytics";
    throw new Error(`unexpected requiredEnv(${name})`);
  }),
}));
vi.mock("@/lib/athena", async () => {
  const actual = await vi.importActual<typeof import("@/lib/athena")>("@/lib/athena");
  return { ...actual, runAthenaQuery: vi.fn() };
});
vi.mock("@/lib/cloudwatchAlarms", () => ({ getAlarmStatus: vi.fn() }));
vi.mock("@/lib/eventbridge", () => ({ getScheduleStatus: vi.fn() }));
vi.mock("@/lib/cloudwatchMetrics", () => ({ getLambdaHealth: vi.fn() }));
vi.mock("@/lib/cloudwatchLogs", () => ({ queryRecentLogs: vi.fn() }));
vi.mock("@/lib/s3Metrics", () => ({ getBucketStorageStats: vi.fn() }));
vi.mock("@/lib/athenaMetrics", () => ({ getAthenaAvgQueryTimeMs: vi.fn() }));

import { runAthenaQuery } from "@/lib/athena";
import { getAlarmStatus } from "@/lib/cloudwatchAlarms";
import { getScheduleStatus } from "@/lib/eventbridge";
import { getLambdaHealth } from "@/lib/cloudwatchMetrics";
import { queryRecentLogs } from "@/lib/cloudwatchLogs";
import { getBucketStorageStats } from "@/lib/s3Metrics";
import { getAthenaAvgQueryTimeMs } from "@/lib/athenaMetrics";
import { GET } from "./route";

const mockedRun = vi.mocked(runAthenaQuery);
const mockedAlarms = vi.mocked(getAlarmStatus);
const mockedSchedule = vi.mocked(getScheduleStatus);
const mockedHealth = vi.mocked(getLambdaHealth);
const mockedLogs = vi.mocked(queryRecentLogs);
const mockedStorage = vi.mocked(getBucketStorageStats);
const mockedAthenaAvg = vi.mocked(getAthenaAvgQueryTimeMs);

beforeEach(() => {
  mockedRun.mockReset();
  mockedAlarms.mockReset();
  mockedSchedule.mockReset();
  mockedHealth.mockReset();
  mockedLogs.mockReset();
  mockedStorage.mockReset();
  mockedAthenaAvg.mockReset();
});

describe("GET /api/dashboard", () => {
  it("returns the merged Live Metrics & Ops data", async () => {
    mockedRun
      .mockResolvedValueOnce([
        { Data: [{ VarCharValue: "source" }, { VarCharValue: "records" }] },
        { Data: [{ VarCharValue: "hackernews" }, { VarCharValue: "612" }] },
        { Data: [{ VarCharValue: "news" }, { VarCharValue: "0" }] },
      ])
      .mockResolvedValueOnce([
        { Data: [{ VarCharValue: "source" }, { VarCharValue: "label" }, { VarCharValue: "ingested_at" }] },
        { Data: [{ VarCharValue: "hackernews" }, { VarCharValue: "Some title" }, { VarCharValue: "2026-09-19T10:00:00Z" }] },
      ]);
    mockedAlarms.mockResolvedValue({ alarmsBreaching: 1, alarmsTotal: 3 });
    mockedSchedule.mockResolvedValue({ scheduleExpression: "rate(10 minutes)", enabled: true });
    mockedHealth.mockResolvedValue([
      { functionLabel: "hackernews_ingestion", status: "ok", lastInvocationAt: "2026-09-20T10:00:00.000Z", errors24h: 0, avgDurationMs: 620 },
    ]);
    mockedLogs.mockResolvedValue([
      { timestamp: "2026-09-20 10:00:00.000", message: "INFO Wrote 20 records", source: "hackernews-ingestion" },
    ]);
    mockedStorage.mockResolvedValueOnce({ sizeBytes: 115343360, objectCount: 430 }); // raw
    mockedStorage.mockResolvedValueOnce({ sizeBytes: 52428800, objectCount: 210 }); // curated
    mockedAthenaAvg.mockResolvedValue(1500);

    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.recordsToday).toBe(612);
    expect(body.sourcesHealthy).toBe(1);
    expect(body.sourcesTotal).toBe(5);
    expect(body.alarmsBreaching).toBe(1);
    expect(body.alarmsTotal).toBe(3);
    expect(body.recentActivity).toHaveLength(1);
    expect(body.schedule).toEqual({ scheduleExpression: "rate(10 minutes)", enabled: true });
    expect(body.lambdaHealth).toHaveLength(1);
    expect(body.recentLogs).toHaveLength(1);
    expect(body.rawStorage).toEqual({ sizeBytes: 115343360, objectCount: 430 });
    expect(body.curatedStorage).toEqual({ sizeBytes: 52428800, objectCount: 210 });
    expect(body.athenaAvgQueryMs).toBe(1500);
    expect(body.costBreakdown).toEqual([
      { category: "Secrets Manager", monthlyUsd: 0.8 },
      { category: "CloudWatch alarms", monthlyUsd: 0.6 },
      { category: "Lambda + S3", monthlyUsd: 0 },
      { category: "Cost Explorer API", monthlyUsd: 0.3 },
    ]);

    expect(mockedStorage).toHaveBeenNthCalledWith(1, expect.anything(), "realtime-data-pipeline-dev-raw-123456789012");
    expect(mockedStorage).toHaveBeenNthCalledWith(2, expect.anything(), "realtime-data-pipeline-dev-curated-123456789012");
    expect(mockedAthenaAvg).toHaveBeenCalledWith(expect.anything(), "realtime-data-pipeline-dev-analytics");
    expect(mockedHealth).toHaveBeenCalledWith(expect.anything(), [
      { fullName: "realtime-data-pipeline-dev-hackernews-ingestion", label: "hackernews_ingestion" },
      { fullName: "realtime-data-pipeline-dev-news-ingestion", label: "news_ingestion" },
      { fullName: "realtime-data-pipeline-dev-weather-ingestion", label: "weather_ingestion" },
      { fullName: "realtime-data-pipeline-dev-crypto-ingestion", label: "crypto_ingestion" },
      { fullName: "realtime-data-pipeline-dev-github-trending-ingestion", label: "github_trending_ingestion" },
      { fullName: "realtime-data-pipeline-dev-transform", label: "transform" },
    ]);
  });

  it("returns 500 with a safe message when any real call fails", async () => {
    mockedRun.mockRejectedValueOnce(new Error("Athena query failed: table not found"));
    mockedAlarms.mockResolvedValue({ alarmsBreaching: 0, alarmsTotal: 0 });
    mockedSchedule.mockResolvedValue({ scheduleExpression: "rate(10 minutes)", enabled: true });
    mockedHealth.mockResolvedValue([]);
    mockedLogs.mockResolvedValue([]);
    mockedStorage.mockResolvedValue({ sizeBytes: null, objectCount: null });
    mockedAthenaAvg.mockResolvedValue(null);

    const response = await GET();
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("Không tải được dữ liệu dashboard, thử lại sau.");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run app/api/dashboard/route.test.ts`
Expected: FAIL — `body.schedule`/`body.lambdaHealth`/etc. are `undefined`, and `getAlarmStatus`/`getScheduleStatus`/etc. mocks report zero calls.

- [ ] **Step 3: Write minimal implementation**

Add to `web/lib/types.ts`, extend the existing `DashboardResponse` type (do not create a second type):

```ts
export type DashboardResponse = {
  recordsToday: number;
  sourceVolumes: SourceVolume[];
  sourcesHealthy: number;
  sourcesTotal: number;
  alarmsBreaching: number;
  alarmsTotal: number;
  recentActivity: ActivityItem[];
  lambdaHealth: LambdaHealthRow[];
  schedule: { scheduleExpression: string; enabled: boolean };
  recentLogs: LogEntry[];
  costBreakdown: CostBreakdownEntry[];
  rawStorage: StorageStats;
  curatedStorage: StorageStats;
  athenaAvgQueryMs: number | null;
};
```

(`LambdaHealthRow`, `LogEntry`, `CostBreakdownEntry` already exist in this file; `StorageStats` was added by Task 1. TypeScript type aliases don't need to be declared in reference order, so edit the existing `DashboardResponse` type in place at its current location in the file — do not move it, and do not duplicate any of the referenced types.)

Replace `web/app/api/dashboard/route.ts` entirely with:

```ts
import { NextResponse } from "next/server";
import {
  getAthenaClient,
  getCloudWatchClient,
  getEventBridgeClient,
  getCloudWatchLogsClient,
  requiredEnv,
} from "@/lib/aws";
import {
  runAthenaQuery,
  todayUtcParts,
  buildSourceVolumeQuery,
  buildRecentActivityQuery,
  parseAthenaRows,
} from "@/lib/athena";
import { getAlarmStatus } from "@/lib/cloudwatchAlarms";
import { getScheduleStatus } from "@/lib/eventbridge";
import { getLambdaHealth } from "@/lib/cloudwatchMetrics";
import { queryRecentLogs } from "@/lib/cloudwatchLogs";
import { getBucketStorageStats } from "@/lib/s3Metrics";
import { getAthenaAvgQueryTimeMs } from "@/lib/athenaMetrics";
import { DATA_SOURCES } from "@/lib/settingsMeta";
import { PIPELINE_LAMBDAS, COST_BREAKDOWN } from "@/lib/opsMeta";
import type { DashboardResponse, SourceVolume, ActivityItem } from "@/lib/types";

export const maxDuration = 60;

export async function GET() {
  try {
    const parts = todayUtcParts();
    const athena = getAthenaClient();
    const cloudwatch = getCloudWatchClient();
    const prefix = requiredEnv("ALARM_NAME_PREFIX");
    const ruleName = `${prefix}-ingestion-schedule`;
    const functionNames = PIPELINE_LAMBDAS.map((lambda) => ({
      fullName: `${prefix}-${lambda.suffix}`,
      label: lambda.label,
    }));
    const logGroupNames = functionNames.map((fn) => `/aws/lambda/${fn.fullName}`);
    const rawBucket = requiredEnv("RAW_BUCKET");
    const curatedBucket = requiredEnv("CURATED_BUCKET");
    const workgroup = requiredEnv("ATHENA_WORKGROUP");

    const [
      volumeRows,
      activityRows,
      alarmStatus,
      schedule,
      lambdaHealth,
      recentLogs,
      rawStorage,
      curatedStorage,
      athenaAvgQueryMs,
    ] = await Promise.all([
      runAthenaQuery(athena, buildSourceVolumeQuery(parts)),
      runAthenaQuery(athena, buildRecentActivityQuery(parts)),
      getAlarmStatus(cloudwatch, prefix),
      getScheduleStatus(getEventBridgeClient(), ruleName),
      getLambdaHealth(cloudwatch, functionNames),
      queryRecentLogs(getCloudWatchLogsClient(), logGroupNames, 5, `${prefix}-`),
      getBucketStorageStats(cloudwatch, rawBucket),
      getBucketStorageStats(cloudwatch, curatedBucket),
      getAthenaAvgQueryTimeMs(cloudwatch, workgroup),
    ]);

    const sourceVolumes: SourceVolume[] = parseAthenaRows(volumeRows, (cols) => ({
      source: cols[0] ?? "",
      records: Number(cols[1] ?? 0),
    }));
    const recentActivity: ActivityItem[] = parseAthenaRows(activityRows, (cols) => ({
      source: cols[0] ?? "",
      label: cols[1] ?? "",
      ingestedAt: cols[2] ?? "",
    }));

    const recordsToday = sourceVolumes.reduce((sum, s) => sum + s.records, 0);
    const sourcesHealthy = sourceVolumes.filter((s) => s.records > 0).length;

    const response: DashboardResponse = {
      recordsToday,
      sourceVolumes,
      sourcesHealthy,
      sourcesTotal: DATA_SOURCES.length,
      alarmsBreaching: alarmStatus.alarmsBreaching,
      alarmsTotal: alarmStatus.alarmsTotal,
      recentActivity,
      lambdaHealth,
      schedule,
      recentLogs,
      costBreakdown: COST_BREAKDOWN,
      rawStorage,
      curatedStorage,
      athenaAvgQueryMs,
    };
    return NextResponse.json(response, {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" },
    });
  } catch (error) {
    console.error("Dashboard API failed", error);
    return NextResponse.json(
      { error: "Không tải được dữ liệu dashboard, thử lại sau." },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run app/api/dashboard/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd web && git add lib/types.ts app/api/dashboard/route.ts app/api/dashboard/route.test.ts
git commit -m "feat: merge Ops data (lambda health, schedule, logs, cost, storage, Athena latency) into /api/dashboard"
```

---

### Task 4: Rebuild `/dashboard` into "Live Metrics & Ops"

**Files:**
- Modify: `web/app/dashboard/page.tsx`

**Interfaces:**
- Consumes: the extended `DashboardResponse` (Task 3), `CostResponse` from `@/lib/types` (existing, via `/api/cost`, already fetched by this page today), `KpiCard` (`@/components/KpiCard`, existing, unchanged), `SourceVolumeChart` (`@/components/SourceVolumeChart`, existing, unchanged), `ActivityFeed` (`@/components/ActivityFeed`, existing, unchanged).
- Produces: nothing consumed elsewhere — leaf route.

This task has no automated test (see Global Constraints). Its deliverable is verified by `tsc --noEmit`, `next build`, and a live browser check after deploy.

- [ ] **Step 1: Rewrite `web/app/dashboard/page.tsx`**

Replace the entire file with:

```tsx
"use client";

import { useEffect, useState } from "react";
import { KpiCard } from "@/components/KpiCard";
import { SourceVolumeChart } from "@/components/SourceVolumeChart";
import { ActivityFeed } from "@/components/ActivityFeed";
import type { DashboardResponse, CostResponse } from "@/lib/types";

// sourceId matches lib/settingsMeta.ts's DATA_SOURCES ids and
// lib/athena.ts's buildSourceVolumeQuery source values. lambdaLabel
// matches lib/opsMeta.ts's PIPELINE_LAMBDAS labels -- NOT a
// `${sourceId}_ingestion` string pattern, since github's real label is
// "github_trending_ingestion", not "github_ingestion".
const SOURCES: { sourceId: string; label: string; lambdaLabel: string }[] = [
  { sourceId: "hackernews", label: "Hacker News", lambdaLabel: "hackernews_ingestion" },
  { sourceId: "news", label: "News API", lambdaLabel: "news_ingestion" },
  { sourceId: "weather", label: "Weather", lambdaLabel: "weather_ingestion" },
  { sourceId: "crypto", label: "Crypto", lambdaLabel: "crypto_ingestion" },
  { sourceId: "github", label: "GitHub Trending", lambdaLabel: "github_trending_ingestion" },
];

function relativeTime(iso: string | null, now: Date = new Date()): string {
  if (!iso) return "chưa có dữ liệu";
  const diffMs = now.getTime() - new Date(iso).getTime();
  const minutes = Math.max(0, Math.round(diffMs / 60000));
  if (minutes < 1) return "vừa xong";
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.round(minutes / 60);
  return `${hours} giờ trước`;
}

function statusColor(status: string): string {
  if (status === "ok") return "text-success";
  if (status === "error") return "text-error";
  return "text-textMuted";
}

function statusLabel(status: string): string {
  if (status === "ok") return "● OK";
  if (status === "error") return "● Lỗi";
  return "● Chưa chạy";
}

function detectLogLevel(message: string): "ERROR" | "WARN" | "INFO" {
  const match = message.match(/\b(ERROR|WARN(?:ING)?|INFO)\b/);
  if (!match) return "INFO";
  return match[1] === "WARNING" ? "WARN" : (match[1] as "ERROR" | "WARN" | "INFO");
}

function logLevelColor(level: "ERROR" | "WARN" | "INFO"): string {
  if (level === "ERROR") return "text-error";
  if (level === "WARN") return "text-warning";
  return "text-accent";
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cost, setCost] = useState<CostResponse | null>(null);

  async function load() {
    setError(null);
    try {
      const res = await fetch("/api/dashboard");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Không tải được dashboard.");
      setData(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tải được dashboard.");
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    fetch("/api/cost")
      .then((res) => res.json().then((body) => ({ ok: res.ok, body })))
      .then(({ ok, body }) => {
        if (ok && typeof body?.monthToDateCostUsd === "number") setCost(body);
      })
      .catch(() => {
        /* cost is secondary -- never block the page over it */
      });
  }, []);

  if (error) {
    return (
      <div className="p-9 flex flex-col gap-4">
        <p className="text-error text-sm">{error}</p>
        <button onClick={load} className="w-fit rounded-lg border border-border px-4 py-2 text-sm text-textPrimary">
          Thử lại
        </button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-9 grid grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 rounded-lg border border-border bg-surface animate-pulse" />
        ))}
      </div>
    );
  }

  const avgLatencyMs = (() => {
    const withDuration = data.lambdaHealth.filter((r) => r.avgDurationMs !== null);
    if (withDuration.length === 0) return null;
    return Math.round(withDuration.reduce((sum, r) => sum + (r.avgDurationMs ?? 0), 0) / withDuration.length);
  })();

  const healthBySource = new Map(data.lambdaHealth.map((r) => [r.functionLabel, r]));
  const volumeBySource = new Map(data.sourceVolumes.map((s) => [s.source, s.records]));
  const maxCost = Math.max(1, ...data.costBreakdown.map((c) => c.monthlyUsd));

  return (
    <div className="p-9 flex flex-col gap-5">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-textPrimary">Live Metrics & Ops</h1>
        <p className="mt-1.5 text-sm text-textSecondary">
          {data.sourcesHealthy}/{data.sourcesTotal} nguồn OK · EventBridge {data.schedule.scheduleExpression} ·{" "}
          {data.alarmsTotal} CloudWatch alarm
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <KpiCard label="Bản ghi hôm nay" value={String(data.recordsToday)} />
        <KpiCard
          label="Độ trễ trung bình"
          value={avgLatencyMs === null ? "—" : `${avgLatencyMs}ms`}
          hint="6 Lambda, 24h"
        />
        <KpiCard label="Chi phí tháng này" value={cost ? `$${cost.monthToDateCostUsd.toFixed(2)}` : "—"} hint="đến hôm nay" />
      </div>

      <div className="grid grid-cols-[1.4fr_1fr] gap-4">
        <SourceVolumeChart sourceVolumes={data.sourceVolumes} />
        <ActivityFeed items={data.recentActivity} />
      </div>

      <div className="rounded-lg border border-border bg-surface px-5 py-4 flex flex-col gap-3">
        <span className="text-[13px] font-semibold text-textPrimary">Realtime Ingestion Streams (5 nguồn dị chủng)</span>
        <div className="grid grid-cols-5 gap-3">
          {SOURCES.map(({ sourceId, label, lambdaLabel }) => {
            const health = healthBySource.get(lambdaLabel);
            const records = volumeBySource.get(sourceId) ?? 0;
            return (
              <div key={sourceId} className="rounded-lg border border-border bg-bg px-3 py-3 flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-textPrimary">{label}</span>
                <span className={`text-[11px] ${statusColor(health?.status ?? "idle")}`}>
                  {statusLabel(health?.status ?? "idle")}
                </span>
                <span className="font-mono text-[11px] text-textSecondary">{records} bản ghi hôm nay</span>
                <span className="font-mono text-[10.5px] text-textMuted">
                  {health?.avgDurationMs === null || health?.avgDurationMs === undefined ? "—" : `${health.avgDurationMs}ms`} ·{" "}
                  {relativeTime(health?.lastInvocationAt ?? null)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-lg border border-border bg-surface px-5 py-4 flex flex-col gap-3">
          <span className="text-[13px] font-semibold text-textPrimary">Lakehouse Storage</span>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-[11px] text-textSecondary">S3 raw</span>
              <span className="font-mono text-sm text-textPrimary">{formatBytes(data.rawStorage.sizeBytes)}</span>
              <span className="font-mono text-[10.5px] text-textMuted">
                {data.rawStorage.objectCount === null ? "—" : `${data.rawStorage.objectCount} object`}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[11px] text-textSecondary">S3 curated</span>
              <span className="font-mono text-sm text-textPrimary">{formatBytes(data.curatedStorage.sizeBytes)}</span>
              <span className="font-mono text-[10.5px] text-textMuted">
                {data.curatedStorage.objectCount === null ? "—" : `${data.curatedStorage.objectCount} object`}
              </span>
            </div>
          </div>
          <div className="flex flex-col gap-1 pt-1 border-t border-border">
            <span className="text-[11px] text-textSecondary">Athena avg query time (24h)</span>
            <span className="font-mono text-sm text-textPrimary">
              {data.athenaAvgQueryMs === null ? "chưa có query trong 24h" : `${data.athenaAvgQueryMs}ms`}
            </span>
          </div>
          <div className="flex flex-col gap-1 pt-1 border-t border-border">
            <span className="text-[11px] text-textSecondary">Partition projection</span>
            <span className="font-mono text-[10.5px] text-textMuted">
              year/month/day/hour, injected (Glue Catalog, infra/glue.tf)
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-border bg-surface px-5 py-4 flex flex-col gap-2">
            <span className="text-[13px] font-semibold text-textPrimary">CloudWatch Alarms</span>
            <span className="font-mono text-xl text-textPrimary">
              {data.alarmsBreaching} / {data.alarmsTotal} <span className="text-xs text-textMuted">breaching</span>
            </span>
          </div>
          <div className="rounded-lg border border-border bg-surface px-5 py-4 flex flex-col gap-2 min-h-0 overflow-auto">
            <span className="text-xs font-semibold text-textPrimary">Log gần đây</span>
            <div className="font-mono flex flex-col gap-1.5 text-[10.5px] text-textMuted">
              {data.recentLogs.length === 0 && <span>Chưa có log trong 24h qua.</span>}
              {data.recentLogs.map((log, i) => {
                const level = detectLogLevel(log.message);
                return (
                  <span key={i} className="break-all">
                    <span className={logLevelColor(level)}>{level}</span> {log.source}: {log.message}
                  </span>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-lg border border-border bg-surface px-5 py-4 flex flex-col gap-2.5">
          <span className="text-xs font-semibold text-textPrimary">Chi phí theo hạng mục</span>
          <div className="flex flex-col gap-2">
            {data.costBreakdown.map((c) => (
              <div key={c.category} className="flex items-center gap-2">
                <span className="w-[110px] text-[11px] text-textSecondary">{c.category}</span>
                <div className="flex-grow h-1.5 rounded bg-border">
                  <div className="h-full rounded bg-textMuted" style={{ width: `${(c.monthlyUsd / maxCost) * 100}%` }} />
                </div>
                <span className="font-mono text-[10.5px] text-textMuted">${c.monthlyUsd.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-surface px-5 py-4 flex flex-col gap-2.5">
          <span className="text-xs font-semibold text-textPrimary">Liên kết nhanh</span>
          <div className="flex flex-col gap-2">
            <a
              href="https://console.aws.amazon.com/cloudwatch/home#alarmsV2:"
              target="_blank"
              rel="noreferrer"
              className="text-[12px] text-accent"
            >
              CloudWatch Alarms Console →
            </a>
            <a
              href="https://console.aws.amazon.com/athena/home#/query-editor"
              target="_blank"
              rel="noreferrer"
              className="text-[12px] text-accent"
            >
              Athena Query Editor →
            </a>
            <a
              href="https://github.com/coderuit3k/realtime-data-pipeline/actions"
              target="_blank"
              rel="noreferrer"
              className="text-[12px] text-accent"
            >
              GitHub Actions →
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
```

Note what changed structurally: the page keeps its existing real KPI fetch/render logic, `SourceVolumeChart`, and `ActivityFeed` untouched, and adds four new sections below them — a per-source health grid (joining `sourceVolumes` and `lambdaHealth` by the `${sourceId}_ingestion` label convention already established in `lib/opsMeta.ts`'s `PIPELINE_LAMBDAS`), a Lakehouse Storage panel (Task 1/2's new real metrics), a CloudWatch Alarms + recent-logs column (ported from the orphaned `/ops` page's own rendering, not altered there), and a cost-breakdown + quick-links row. No destructive-action buttons of any kind are present.

- [ ] **Step 2: Verify the project typechecks and builds**

Run: `cd web && npx tsc --noEmit && npx next build`
Expected: both succeed with no errors.

- [ ] **Step 3: Run the full Vitest suite**

Run: `cd web && npx vitest run`
Expected: all tests pass (existing suite + Task 1/2/3's new tests), pristine output.

- [ ] **Step 4: Commit**

```bash
cd web && git add app/dashboard/page.tsx
git commit -m "feat: rebuild /dashboard into Live Metrics & Ops with real storage and Athena latency panels"
```

---

### Task 5: Retire `/ops` from navigation; document the new env var prerequisite

**Files:**
- Modify: `web/components/Sidebar.tsx`
- Modify: `infra/README.md`

**Interfaces:** none — this task touches no shared types or functions.

This task has no automated test. Its deliverable is verified by `tsc --noEmit` and a visual check that the sidebar no longer lists "Ops & Monitoring".

- [ ] **Step 1: Remove the Ops & Monitoring entry from `LEGACY_LINKS`**

In `web/components/Sidebar.tsx`, delete this exact object (the first entry in the `LEGACY_LINKS` array) — its content now lives at `/dashboard`:

```tsx
  {
    href: "/ops",
    label: "Ops & Monitoring",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
      </svg>
    ),
  },
```

Leave the other three entries (`/cicd`, `/explorer`, `/insights`), the "TRANG KHÁC" label, and the comment above `LEGACY_LINKS` untouched (the comment's claim that this group covers `/ops` becomes stale — update it to drop the `/ops` mention while keeping the rest of its explanation intact).

- [ ] **Step 2: Document the prerequisite in `infra/README.md`**

Add a blockquote near the top of `infra/README.md` (following the exact pattern of the existing AWS Cost Explorer prerequisite blockquote added for the Real Cost sub-project), and a new IAM/env-var note. Read the file first to place this consistently with its existing prerequisite section, then add:

```markdown
> **Prerequisite for the Live Metrics & Ops dashboard:** the web app reads real S3 bucket storage size via CloudWatch (`AWS/S3` `BucketSizeBytes`/`NumberOfObjects` metrics), which requires two plain (non-secret) environment variables on Vercel: `RAW_BUCKET` and `CURATED_BUCKET`. Get their real values with:
> ```bash
> cd infra
> terraform output raw_bucket_name
> terraform output curated_bucket_name
> ```
> Paste each into Vercel's environment variables UI. No new IAM permission is required — `cloudwatch:GetMetricData` is already granted with `Resource: "*"` in the policy below, and CloudWatch metric reads are not ARN-scoped.
```

- [ ] **Step 3: Verify the project still typechecks**

Run: `cd web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add web/components/Sidebar.tsx infra/README.md
git commit -m "docs: retire /ops from sidebar nav, document RAW_BUCKET/CURATED_BUCKET prerequisite"
```

---

## After all tasks: manual verification (part of this plan's final review, not a separate task)

- `cd web && npx vitest run` — full suite green.
- `cd web && npx tsc --noEmit && npx next build` — clean build.
- Confirm `RAW_BUCKET`, `CURATED_BUCKET` are set in Vercel before/at deploy time (the route throws a clear `Missing required environment variable` error otherwise, same failure mode as every other `requiredEnv` call in this codebase).
- Local dev server or live site, visit `/dashboard`: sidebar's "Live Metrics & Ops" is active; page shows the 3 KPI cards, the existing volume chart + activity feed, the new 5-source health grid, real S3 bucket sizes (not "—", once CloudWatch has published at least one daily datapoint — allow up to 24-48h after bucket creation for a brand-new bucket), Athena avg query time (or its "chưa có query" empty state), CloudWatch alarms count, recent logs, cost breakdown, and the quick-links panel (no Trigger/Flush buttons anywhere).
- Visit `/ops` directly by URL — confirm it still renders (untouched), just no longer linked from the sidebar.
