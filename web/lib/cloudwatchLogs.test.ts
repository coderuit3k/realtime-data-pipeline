import { describe, expect, it, vi } from "vitest";
import { queryRecentLogs } from "./cloudwatchLogs";

function resultRow(timestamp: string, message: string, log: string) {
  return [
    { field: "@timestamp", value: timestamp },
    { field: "@message", value: message },
    { field: "@log", value: log },
  ];
}

describe("queryRecentLogs", () => {
  it("starts a query, polls until Complete, and maps fields with the prefix stripped", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ queryId: "q-1" })
      .mockResolvedValueOnce({ status: "Running" })
      .mockResolvedValueOnce({
        status: "Complete",
        results: [
          resultRow(
            "2026-09-20 10:00:00.000",
            "INFO Wrote 20 records to source=github/...",
            "123456789012:/aws/lambda/proj-github-trending-ingestion"
          ),
        ],
      });
    const client = { send } as unknown as import("@aws-sdk/client-cloudwatch-logs").CloudWatchLogsClient;

    const entries = await queryRecentLogs(client, ["/aws/lambda/proj-github-trending-ingestion"], 5, "proj-");

    expect(entries).toEqual([
      {
        timestamp: "2026-09-20 10:00:00.000",
        message: "INFO Wrote 20 records to source=github/...",
        source: "github-trending-ingestion",
      },
    ]);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("falls back to the raw @log value when the prefix doesn't match", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ queryId: "q-2" })
      .mockResolvedValueOnce({
        status: "Complete",
        results: [resultRow("t", "m", "999:/aws/lambda/unrelated-function")],
      });
    const client = { send } as unknown as import("@aws-sdk/client-cloudwatch-logs").CloudWatchLogsClient;

    const entries = await queryRecentLogs(client, ["/aws/lambda/unrelated-function"], 5, "proj-");

    expect(entries[0].source).toBe("999:/aws/lambda/unrelated-function");
  });

  it("throws with a clear message when the query fails", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ queryId: "q-3" })
      .mockResolvedValueOnce({ status: "Failed" });
    const client = { send } as unknown as import("@aws-sdk/client-cloudwatch-logs").CloudWatchLogsClient;

    await expect(queryRecentLogs(client, ["/aws/lambda/x"], 5, "proj-")).rejects.toThrow(
      "CloudWatch Logs Insights query failed: Failed"
    );
  });

  it("redacts apiKey/api_key/token query params from the message before returning it", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ queryId: "q-4" })
      .mockResolvedValueOnce({
        status: "Complete",
        results: [
          resultRow(
            "t",
            "ERROR HTTPError: 429 Client Error for url: https://newsapi.org/v2/everything?apiKey=sk_live_abc123&q=test",
            "123:/aws/lambda/proj-news-ingestion"
          ),
        ],
      });
    const client = { send } as unknown as import("@aws-sdk/client-cloudwatch-logs").CloudWatchLogsClient;

    const entries = await queryRecentLogs(client, ["/aws/lambda/proj-news-ingestion"], 5, "proj-");

    expect(entries[0].message).toBe(
      "ERROR HTTPError: 429 Client Error for url: https://newsapi.org/v2/everything?apiKey=[REDACTED]&q=test"
    );
    expect(entries[0].message).not.toContain("sk_live_abc123");
  });
});
