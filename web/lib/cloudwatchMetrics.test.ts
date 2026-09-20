import { describe, expect, it, vi } from "vitest";
import { getLambdaHealth } from "./cloudwatchMetrics";

describe("getLambdaHealth", () => {
  it("reduces a multi-series GetMetricData response into per-function rows", async () => {
    const send = vi.fn().mockResolvedValue({
      MetricDataResults: [
        {
          Id: "invocations0",
          Timestamps: [new Date("2026-09-20T10:00:00Z"), new Date("2026-09-20T09:50:00Z")],
          Values: [1, 1],
        },
        { Id: "errors0", Timestamps: [], Values: [] },
        {
          Id: "duration0",
          Timestamps: [new Date("2026-09-20T10:00:00Z"), new Date("2026-09-20T09:50:00Z")],
          Values: [620, 580],
        },
        { Id: "invocations1", Timestamps: [], Values: [] },
        { Id: "errors1", Timestamps: [], Values: [] },
        { Id: "duration1", Timestamps: [], Values: [] },
        {
          Id: "invocations2",
          Timestamps: [new Date("2026-09-20T09:55:00Z")],
          Values: [1],
        },
        {
          Id: "errors2",
          Timestamps: [new Date("2026-09-20T09:55:00Z")],
          Values: [1],
        },
        {
          Id: "duration2",
          Timestamps: [new Date("2026-09-20T09:55:00Z")],
          Values: [3200],
        },
      ],
    });
    const client = { send } as unknown as import("@aws-sdk/client-cloudwatch").CloudWatchClient;

    const rows = await getLambdaHealth(client, [
      { fullName: "proj-hackernews-ingestion", label: "hackernews_ingestion" },
      { fullName: "proj-news-ingestion", label: "news_ingestion" },
      { fullName: "proj-transform", label: "transform" },
    ]);

    expect(rows).toEqual([
      {
        functionLabel: "hackernews_ingestion",
        status: "ok",
        lastInvocationAt: "2026-09-20T10:00:00.000Z",
        errors24h: 0,
        avgDurationMs: 600,
      },
      {
        functionLabel: "news_ingestion",
        status: "idle",
        lastInvocationAt: null,
        errors24h: 0,
        avgDurationMs: null,
      },
      {
        functionLabel: "transform",
        status: "error",
        lastInvocationAt: "2026-09-20T09:55:00.000Z",
        errors24h: 1,
        avgDurationMs: 3200,
      },
    ]);
  });

  it("passes 18 MetricDataQueries (3 per function) for 6 functions", async () => {
    const send = vi.fn().mockResolvedValue({ MetricDataResults: [] });
    const client = { send } as unknown as import("@aws-sdk/client-cloudwatch").CloudWatchClient;

    const names = Array.from({ length: 6 }, (_, i) => ({ fullName: `fn-${i}`, label: `fn_${i}` }));
    await getLambdaHealth(client, names);

    const queries = send.mock.calls[0][0].input.MetricDataQueries;
    expect(queries).toHaveLength(18);
    expect(queries[0].MetricStat.Metric.Namespace).toBe("AWS/Lambda");
    expect(queries[0].MetricStat.Metric.Dimensions).toEqual([{ Name: "FunctionName", Value: "fn-0" }]);
  });
});
