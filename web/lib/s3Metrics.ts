import { GetMetricDataCommand, type CloudWatchClient } from "@aws-sdk/client-cloudwatch";
import type { StorageStats } from "./types";

// S3 storage metrics are published only once a day, so a 2-day window
// guarantees at least one datapoint even before today's has landed.
const WINDOW_MS = 2 * 24 * 60 * 60 * 1000;
const PERIOD_SECONDS = 86400;

// GetMetricData doesn't guarantee chronological order, so pick by timestamp.
function latestValue(values: number[], timestamps: Date[]): number | null {
  if (values.length === 0) return null;
  let latestIndex = 0;
  for (let i = 1; i < timestamps.length; i++) {
    if (timestamps[i] > timestamps[latestIndex]) latestIndex = i;
  }
  return Math.round(values[latestIndex]);
}

/**
 * Latest bucket size and object count from CloudWatch, without listing objects.
 * Size counts STANDARD storage only; S3 requires a StorageType dimension and
 * reports object counts under AllStorageTypes. Null means no datapoint yet.
 */
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
