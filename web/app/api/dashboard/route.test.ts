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
