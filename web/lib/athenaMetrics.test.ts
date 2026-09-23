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
