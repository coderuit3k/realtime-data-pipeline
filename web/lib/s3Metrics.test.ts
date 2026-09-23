import { describe, expect, it, vi } from "vitest";
import { getBucketStorageStats } from "./s3Metrics";

describe("getBucketStorageStats", () => {
  it("returns the latest daily size and object count for a real bucket", async () => {
    const send = vi.fn().mockResolvedValue({
      MetricDataResults: [
        {
          Id: "sizeBytes",
          Values: [115343360, 104857600],
          Timestamps: [new Date("2026-09-22T00:00:00Z"), new Date("2026-09-21T00:00:00Z")],
        },
        {
          Id: "objectCount",
          Values: [430, 412],
          Timestamps: [new Date("2026-09-22T00:00:00Z"), new Date("2026-09-21T00:00:00Z")],
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
