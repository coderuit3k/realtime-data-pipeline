import {
  StartQueryCommand,
  GetQueryResultsCommand,
  type CloudWatchLogsClient,
} from "@aws-sdk/client-cloudwatch-logs";
import type { LogEntry } from "./types";

const QUERY_STRING =
  "fields @timestamp, @message, @log | filter @message like /INFO|WARN|ERROR/ | sort @timestamp desc | limit ";
const WINDOW_SECONDS = 24 * 60 * 60;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function field(row: { field?: string; value?: string }[], name: string): string {
  return row.find((f) => f.field === name)?.value ?? "";
}

// @log comes back as "<account-id>:/aws/lambda/<prefix><name>"; keep just
// <name> so the account id never reaches the UI. Unknown shapes pass through.
function stripLogGroupPrefix(log: string, prefixToStrip: string): string {
  const marker = `/aws/lambda/${prefixToStrip}`;
  const index = log.indexOf(marker);
  if (index === -1) return log;
  return log.slice(index + marker.length);
}

// Security: these logs are served on a public page, and logged request URLs
// can carry API keys as query params.
function redactSecrets(message: string): string {
  return message.replace(/(apiKey|api_key|token)=[^&\s]+/gi, "$1=[REDACTED]");
}

/**
 * Latest INFO/WARN/ERROR lines from the last 24h via Logs Insights, polled every
 * 500ms for up to ~20s. Messages are secret-redacted before they leave the server.
 */
export async function queryRecentLogs(
  client: CloudWatchLogsClient,
  logGroupNames: string[],
  limit: number,
  prefixToStrip: string
): Promise<LogEntry[]> {
  const now = Math.floor(Date.now() / 1000);
  const start = await client.send(
    new StartQueryCommand({
      logGroupNames,
      startTime: now - WINDOW_SECONDS,
      endTime: now,
      queryString: `${QUERY_STRING}${limit}`,
    })
  );
  const queryId = start.queryId;
  if (!queryId) throw new Error("CloudWatch Logs Insights did not return a queryId");

  let finalStatus: string | undefined;
  let results: { field?: string; value?: string }[][] = [];
  for (let attempt = 0; attempt < 40; attempt++) {
    const response = await client.send(new GetQueryResultsCommand({ queryId }));
    if (response.status === "Complete") {
      finalStatus = response.status;
      results = response.results ?? [];
      break;
    }
    if (response.status === "Failed" || response.status === "Cancelled" || response.status === "Timeout") {
      throw new Error(`CloudWatch Logs Insights query failed: ${response.status}`);
    }
    await sleep(500);
  }
  if (!finalStatus) throw new Error("CloudWatch Logs Insights query timed out waiting for Complete state");

  return results.map((row) => ({
    timestamp: field(row, "@timestamp"),
    message: redactSecrets(field(row, "@message")),
    source: stripLogGroupPrefix(field(row, "@log"), prefixToStrip),
  }));
}
