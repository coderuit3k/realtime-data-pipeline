import {
  AthenaClient,
  StartQueryExecutionCommand,
  GetQueryExecutionCommand,
  GetQueryResultsCommand,
  type GetQueryExecutionCommandOutput,
} from "@aws-sdk/client-athena";

/** Zero-padded year/month/day strings matching the curated tables' Hive partition values. */
export type TodayParts = { year: string; month: string; day: string };

/** Partition values for `now`'s UTC date (partitions are written in UTC, not Vietnam time). */
export function todayUtcParts(now: Date = new Date()): TodayParts {
  return {
    year: String(now.getUTCFullYear()),
    month: String(now.getUTCMonth() + 1).padStart(2, "0"),
    day: String(now.getUTCDate()).padStart(2, "0"),
  };
}

/**
 * Full `WHERE` clause pinning a query to one day's partition, so Athena prunes
 * instead of scanning (and billing for) the whole table.
 */
export function partitionWhere({ year, month, day }: TodayParts): string {
  return `WHERE year='${year}' AND month='${month}' AND day='${day}'`;
}

/**
 * Bare `(...) OR (...)` predicate covering several day partitions, with no
 * `WHERE` and no outer parens: wrap it yourself before combining with AND,
 * e.g. `WHERE (${partitionPredicateAny(...)}) AND other_condition`.
 */
export function partitionPredicateAny(partsList: TodayParts[], alias?: string): string {
  const prefix = alias ? `${alias}.` : "";
  return partsList
    .map(
      ({ year, month, day }) =>
        `(${prefix}year='${year}' AND ${prefix}month='${month}' AND ${prefix}day='${day}')`
    )
    .join(" OR ");
}

/** Row count per ingestion source for one day; one UNION ALL branch per curated table. */
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

/** The 5 most recently ingested records across all sources for one day. */
export function buildRecentActivityQuery(parts: TodayParts): string {
  const where = partitionWhere(parts);
  // Only news/github have an image column; the others select a typed NULL
  // because every UNION ALL branch must have the same column types.
  const union = [
    `SELECT 'hackernews' AS source, title AS label, ingested_at, CAST(NULL AS varchar) AS image_url FROM hackernews_stories ${where}`,
    `SELECT 'news' AS source, title AS label, ingested_at, image_url FROM news_articles ${where}`,
    `SELECT 'weather' AS source, location AS label, ingested_at, CAST(NULL AS varchar) AS image_url FROM weather_observations ${where}`,
    `SELECT 'crypto' AS source, coin_id AS label, ingested_at, CAST(NULL AS varchar) AS image_url FROM crypto_prices ${where}`,
    `SELECT 'github' AS source, full_name AS label, ingested_at, avatar_url AS image_url FROM github_repos ${where}`,
  ].join("\nUNION ALL\n");
  return `SELECT * FROM (\n${union}\n) ORDER BY ingested_at DESC LIMIT 5`;
}

export type AthenaResultRow = { Data?: Array<{ VarCharValue?: string }> };

/**
 * Drops Athena's header row (the first row of the first results page holds the
 * column names) and maps each data row's cells, with missing values as null.
 */
export function parseAthenaRows<T>(
  rows: AthenaResultRow[],
  mapRow: (cols: (string | null)[]) => T
): T[] {
  return rows.slice(1).map((row) => mapRow((row.Data ?? []).map((cell) => cell.VarCharValue ?? null)));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type PollOutcome = {
  queryExecutionId: string;
  statistics: { dataScannedInBytes: number; engineExecutionTimeMs: number };
};

/**
 * Starts a query and polls every 500ms for up to ~25s, which keeps it inside
 * the routes' 60s maxDuration. Throws on FAILED/CANCELLED or on timeout.
 */
async function startAndPollQuery(client: AthenaClient, sql: string): Promise<PollOutcome> {
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

  let finalStatus: GetQueryExecutionCommandOutput | undefined;
  for (let attempt = 0; attempt < 50; attempt++) {
    const status = await client.send(new GetQueryExecutionCommand({ QueryExecutionId: queryExecutionId }));
    const state = status.QueryExecution?.Status?.State;
    if (state === "SUCCEEDED") {
      finalStatus = status;
      break;
    }
    if (state === "FAILED" || state === "CANCELLED") {
      const reason = status.QueryExecution?.Status?.StateChangeReason ?? "unknown reason";
      throw new Error(`Athena query ${state.toLowerCase()}: ${reason}`);
    }
    await sleep(500);
  }

  if (!finalStatus) {
    throw new Error("Athena query timed out waiting for SUCCEEDED state");
  }

  return {
    queryExecutionId,
    statistics: {
      dataScannedInBytes: finalStatus.QueryExecution?.Statistics?.DataScannedInBytes ?? 0,
      engineExecutionTimeMs: finalStatus.QueryExecution?.Statistics?.EngineExecutionTimeInMillis ?? 0,
    },
  };
}

/** Runs `sql` and returns only the first results page (header row included); later pages are ignored. */
export async function runAthenaQuery(client: AthenaClient, sql: string): Promise<AthenaResultRow[]> {
  const { queryExecutionId } = await startAndPollQuery(client, sql);
  const results = await client.send(new GetQueryResultsCommand({ QueryExecutionId: queryExecutionId }));
  return (results.ResultSet?.Rows ?? []) as AthenaResultRow[];
}

export type QueryStats = { dataScannedInBytes: number; engineExecutionTimeMs: number };

/**
 * Like runAthenaQuery but also returns column names, scan/engine stats and
 * whether rows were cut off. `maxResults` counts the header row too.
 */
export async function runAthenaQueryWithStats(
  client: AthenaClient,
  sql: string,
  maxResults = 100
): Promise<{ columns: string[]; rows: AthenaResultRow[]; stats: QueryStats; hasMoreRows: boolean }> {
  const { queryExecutionId, statistics } = await startAndPollQuery(client, sql);
  const results = await client.send(
    new GetQueryResultsCommand({ QueryExecutionId: queryExecutionId, MaxResults: maxResults })
  );
  return {
    columns: (results.ResultSet?.ResultSetMetadata?.ColumnInfo ?? []).map((c) => c.Name ?? ""),
    rows: (results.ResultSet?.Rows ?? []) as AthenaResultRow[],
    stats: statistics,
    hasMoreRows: Boolean(results.NextToken),
  };
}
