import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/aws", () => ({
  getCloudWatchClient: vi.fn(() => ({})),
  getEventBridgeClient: vi.fn(() => ({})),
  getCloudWatchLogsClient: vi.fn(() => ({})),
  requiredEnv: vi.fn((name: string) => {
    if (name === "ALARM_NAME_PREFIX") return "realtime-data-pipeline-dev";
    throw new Error(`unexpected requiredEnv(${name})`);
  }),
}));
vi.mock("@/lib/eventbridge", () => ({ getScheduleStatus: vi.fn() }));
vi.mock("@/lib/cloudwatchMetrics", () => ({ getLambdaHealth: vi.fn() }));
vi.mock("@/lib/cloudwatchLogs", () => ({ queryRecentLogs: vi.fn() }));
vi.mock("@/lib/cloudwatchAlarms", () => ({ getAlarmStatus: vi.fn() }));

import { getScheduleStatus } from "@/lib/eventbridge";
import { getLambdaHealth } from "@/lib/cloudwatchMetrics";
import { queryRecentLogs } from "@/lib/cloudwatchLogs";
import { getAlarmStatus } from "@/lib/cloudwatchAlarms";
import { GET } from "./route";

const mockedSchedule = vi.mocked(getScheduleStatus);
const mockedHealth = vi.mocked(getLambdaHealth);
const mockedLogs = vi.mocked(queryRecentLogs);
const mockedAlarms = vi.mocked(getAlarmStatus);

beforeEach(() => {
  mockedSchedule.mockReset();
  mockedHealth.mockReset();
  mockedLogs.mockReset();
  mockedAlarms.mockReset();
});

describe("GET /api/ops", () => {
  it("assembles the full OpsResponse, including alarms and cost facts", async () => {
    mockedSchedule.mockResolvedValue({ scheduleExpression: "rate(10 minutes)", enabled: true });
    mockedHealth.mockResolvedValue([
      { functionLabel: "hackernews_ingestion", status: "ok", lastInvocationAt: "2026-09-20T10:00:00.000Z", errors24h: 0, avgDurationMs: 620 },
    ]);
    mockedLogs.mockResolvedValue([
      { timestamp: "2026-09-20 10:00:00.000", message: "INFO Wrote 20 records", source: "github-trending-ingestion" },
    ]);
    mockedAlarms.mockResolvedValue({ alarmsBreaching: 1, alarmsTotal: 3 });

    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.schedule).toEqual({ scheduleExpression: "rate(10 minutes)", enabled: true });
    expect(body.lambdaHealth).toHaveLength(1);
    expect(body.recentLogs).toHaveLength(1);
    expect(body.alarmsBreaching).toBe(1);
    expect(body.alarmsTotal).toBe(3);
    expect(body.costEstimateUsd).toBe(1.02);
    expect(body.costBreakdown).toEqual([
      { category: "Secrets Manager", monthlyUsd: 0.8 },
      { category: "CloudWatch alarms", monthlyUsd: 0.6 },
      { category: "Lambda + S3", monthlyUsd: 0 },
    ]);

    expect(mockedSchedule).toHaveBeenCalledWith(
      expect.anything(),
      "realtime-data-pipeline-dev-ingestion-schedule"
    );

    expect(mockedHealth).toHaveBeenCalledWith(
      expect.anything(),
      [
        { fullName: "realtime-data-pipeline-dev-hackernews-ingestion", label: "hackernews_ingestion" },
        { fullName: "realtime-data-pipeline-dev-news-ingestion", label: "news_ingestion" },
        { fullName: "realtime-data-pipeline-dev-weather-ingestion", label: "weather_ingestion" },
        { fullName: "realtime-data-pipeline-dev-crypto-ingestion", label: "crypto_ingestion" },
        { fullName: "realtime-data-pipeline-dev-github-trending-ingestion", label: "github_trending_ingestion" },
        { fullName: "realtime-data-pipeline-dev-transform", label: "transform" },
      ]
    );

    expect(mockedLogs).toHaveBeenCalledWith(
      expect.anything(),
      [
        "/aws/lambda/realtime-data-pipeline-dev-hackernews-ingestion",
        "/aws/lambda/realtime-data-pipeline-dev-news-ingestion",
        "/aws/lambda/realtime-data-pipeline-dev-weather-ingestion",
        "/aws/lambda/realtime-data-pipeline-dev-crypto-ingestion",
        "/aws/lambda/realtime-data-pipeline-dev-github-trending-ingestion",
        "/aws/lambda/realtime-data-pipeline-dev-transform",
      ],
      5,
      "realtime-data-pipeline-dev-"
    );

    expect(mockedAlarms).toHaveBeenCalledWith(expect.anything(), "realtime-data-pipeline-dev");
  });

  it("returns 500 with a safe message when any AWS call fails", async () => {
    mockedSchedule.mockRejectedValue(new Error("boom"));
    const response = await GET();
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("Không tải được Ops, thử lại sau.");
  });
});
