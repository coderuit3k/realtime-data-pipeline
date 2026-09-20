import { GetMetricDataCommand, type CloudWatchClient } from "@aws-sdk/client-cloudwatch";
import type { LambdaHealthRow } from "./types";

const WINDOW_MS = 24 * 60 * 60 * 1000;
const PERIOD_SECONDS = 300;

function metricQuery(id: string, metricName: string, functionName: string, stat: "Sum" | "Average") {
  return {
    Id: id,
    MetricStat: {
      Metric: {
        Namespace: "AWS/Lambda",
        MetricName: metricName,
        Dimensions: [{ Name: "FunctionName", Value: functionName }],
      },
      Period: PERIOD_SECONDS,
      Stat: stat,
    },
    ReturnData: true,
  };
}

function sum(values: number[]): number {
  return values.reduce((total, v) => total + v, 0);
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(sum(values) / values.length);
}

function latestTimestamp(timestamps: Date[]): string | null {
  if (timestamps.length === 0) return null;
  return timestamps.reduce((latest, t) => (t > latest ? t : latest), timestamps[0]).toISOString();
}

export async function getLambdaHealth(
  client: CloudWatchClient,
  functionNames: { fullName: string; label: string }[]
): Promise<LambdaHealthRow[]> {
  const now = new Date();
  const queries = functionNames.flatMap((fn, i) => [
    metricQuery(`invocations${i}`, "Invocations", fn.fullName, "Sum"),
    metricQuery(`errors${i}`, "Errors", fn.fullName, "Sum"),
    metricQuery(`duration${i}`, "Duration", fn.fullName, "Average"),
  ]);

  const response = await client.send(
    new GetMetricDataCommand({
      StartTime: new Date(now.getTime() - WINDOW_MS),
      EndTime: now,
      MetricDataQueries: queries,
    })
  );

  const byId = new Map((response.MetricDataResults ?? []).map((r) => [r.Id ?? "", r]));

  return functionNames.map((fn, i) => {
    const invocations = byId.get(`invocations${i}`);
    const errors = byId.get(`errors${i}`);
    const duration = byId.get(`duration${i}`);

    const invocationTimestamps = invocations?.Timestamps ?? [];
    const errorsSum = sum(errors?.Values ?? []);
    const totalInvocations = sum(invocations?.Values ?? []);

    const status: LambdaHealthRow["status"] =
      totalInvocations === 0 ? "idle" : errorsSum > 0 ? "error" : "ok";

    return {
      functionLabel: fn.label,
      status,
      lastInvocationAt: latestTimestamp(invocationTimestamps),
      errors24h: errorsSum,
      avgDurationMs: totalInvocations === 0 ? null : average(duration?.Values ?? []),
    };
  });
}
