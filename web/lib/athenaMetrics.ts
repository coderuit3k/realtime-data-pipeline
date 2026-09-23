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
