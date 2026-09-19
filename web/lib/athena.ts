import {
  AthenaClient,
  StartQueryExecutionCommand,
  GetQueryExecutionCommand,
  GetQueryResultsCommand,
} from "@aws-sdk/client-athena";

export type TodayParts = { year: string; month: string; day: string };

export function todayUtcParts(now: Date = new Date()): TodayParts {
  return {
    year: String(now.getUTCFullYear()),
    month: String(now.getUTCMonth() + 1).padStart(2, "0"),
    day: String(now.getUTCDate()).padStart(2, "0"),
  };
}

function partitionWhere({ year, month, day }: TodayParts): string {
  return `WHERE year='${year}' AND month='${month}' AND day='${day}'`;
}

export function buildSourceVolumeQuery(parts: TodayParts): string {
  const where = partitionWhere(parts);
  return [
    `SELECT 'hackernews' AS source, COUNT(*) AS records FROM hackernews_stories ${where}`,
    `SELECT 'news' AS source, COUNT(*) AS records FROM news_articles ${where}`,
    `SELECT 'weather' AS source, COUNT(*) AS records FROM weather_observations ${where}`,
    `SELECT 'crypto' AS source, COUNT(*) AS records FROM crypto_prices ${where}`,
    `SELECT 'github' AS source, COUNT(*) AS records FROM github_repos ${where}`,
  ].join("\nUNION ALL\n");
}

export function buildRecentActivityQuery(parts: TodayParts): string {
  const where = partitionWhere(parts);
  const union = [
    `SELECT 'hackernews' AS source, title AS label, ingested_at FROM hackernews_stories ${where}`,
    `SELECT 'news' AS source, title AS label, ingested_at FROM news_articles ${where}`,
    `SELECT 'weather' AS source, location AS label, ingested_at FROM weather_observations ${where}`,
    `SELECT 'crypto' AS source, coin_id AS label, ingested_at FROM crypto_prices ${where}`,
    `SELECT 'github' AS source, full_name AS label, ingested_at FROM github_repos ${where}`,
  ].join("\nUNION ALL\n");
  return `SELECT * FROM (\n${union}\n) ORDER BY ingested_at DESC LIMIT 5`;
}

export type AthenaResultRow = { Data?: Array<{ VarCharValue?: string }> };

export function parseAthenaRows<T>(
  rows: AthenaResultRow[],
  mapRow: (cols: (string | null)[]) => T
): T[] {
  return rows.slice(1).map((row) => mapRow((row.Data ?? []).map((cell) => cell.VarCharValue ?? null)));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runAthenaQuery(client: AthenaClient, sql: string): Promise<AthenaResultRow[]> {
  const workgroup = process.env.ATHENA_WORKGROUP;
  const database = process.env.ATHENA_DATABASE;
  if (!workgroup || !database) {
    throw new Error("Missing ATHENA_WORKGROUP or ATHENA_DATABASE environment variable");
  }

  const start = await client.send(
    new StartQueryExecutionCommand({
      QueryString: sql,
      QueryExecutionContext: { Database: database },
      WorkGroup: workgroup,
    })
  );
  const queryExecutionId = start.QueryExecutionId;
  if (!queryExecutionId) throw new Error("Athena did not return a QueryExecutionId");

  for (let attempt = 0; attempt < 20; attempt++) {
    const status = await client.send(new GetQueryExecutionCommand({ QueryExecutionId: queryExecutionId }));
    const state = status.QueryExecution?.Status?.State;
    if (state === "SUCCEEDED") break;
    if (state === "FAILED" || state === "CANCELLED") {
      const reason = status.QueryExecution?.Status?.StateChangeReason ?? "unknown reason";
      throw new Error(`Athena query ${state.toLowerCase()}: ${reason}`);
    }
    await sleep(300);
  }

  const results = await client.send(new GetQueryResultsCommand({ QueryExecutionId: queryExecutionId }));
  return (results.ResultSet?.Rows ?? []) as AthenaResultRow[];
}
