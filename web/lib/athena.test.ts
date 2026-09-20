import { describe, expect, it, vi } from "vitest";
import {
  todayUtcParts,
  buildSourceVolumeQuery,
  buildRecentActivityQuery,
  parseAthenaRows,
  runAthenaQuery,
  partitionWhere,
  runAthenaQueryWithStats,
} from "./athena";

describe("todayUtcParts", () => {
  it("zero-pads month and day", () => {
    const parts = todayUtcParts(new Date("2026-01-05T23:59:00Z"));
    expect(parts).toEqual({ year: "2026", month: "01", day: "05" });
  });
});

describe("buildSourceVolumeQuery", () => {
  it("filters all 5 tables on the given partition", () => {
    const sql = buildSourceVolumeQuery({ year: "2026", month: "09", day: "19" });
    expect(sql).toContain("hackernews_stories");
    expect(sql).toContain("crypto_prices");
    expect(sql).toContain("github_repos");
    expect(sql).toContain("year='2026' AND month='09' AND day='19'");
  });
});

describe("buildRecentActivityQuery", () => {
  it("orders by ingested_at and limits to 5", () => {
    const sql = buildRecentActivityQuery({ year: "2026", month: "09", day: "19" });
    expect(sql).toContain("ORDER BY ingested_at DESC LIMIT 5");
    expect(sql).toContain("weather_observations");
  });
});

describe("parseAthenaRows", () => {
  it("skips the header row and maps the rest", () => {
    const rows = [
      { Data: [{ VarCharValue: "source" }, { VarCharValue: "records" }] },
      { Data: [{ VarCharValue: "hackernews" }, { VarCharValue: "612" }] },
      { Data: [{ VarCharValue: "news" }, { VarCharValue: "540" }] },
    ];
    const parsed = parseAthenaRows(rows, (cols) => ({ source: cols[0], records: Number(cols[1]) }));
    expect(parsed).toEqual([
      { source: "hackernews", records: 612 },
      { source: "news", records: 540 },
    ]);
  });
});

describe("runAthenaQuery", () => {
  it("starts, polls until SUCCEEDED, then returns result rows", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ QueryExecutionId: "q-1" })
      .mockResolvedValueOnce({ QueryExecution: { Status: { State: "SUCCEEDED" } } })
      .mockResolvedValueOnce({ ResultSet: { Rows: [{ Data: [{ VarCharValue: "x" }] }] } });
    const client = { send } as unknown as import("@aws-sdk/client-athena").AthenaClient;

    process.env.ATHENA_WORKGROUP = "wg";
    process.env.ATHENA_DATABASE = "db";
    const rows = await runAthenaQuery(client, "SELECT 1");

    expect(rows).toEqual([{ Data: [{ VarCharValue: "x" }] }]);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("throws with the failure reason when the query fails", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ QueryExecutionId: "q-2" })
      .mockResolvedValueOnce({
        QueryExecution: { Status: { State: "FAILED", StateChangeReason: "table not found" } },
      });
    const client = { send } as unknown as import("@aws-sdk/client-athena").AthenaClient;

    process.env.ATHENA_WORKGROUP = "wg";
    process.env.ATHENA_DATABASE = "db";
    await expect(runAthenaQuery(client, "SELECT 1")).rejects.toThrow("table not found");
  });

  it("throws a timeout error when the query never reaches SUCCEEDED", async () => {
    vi.useFakeTimers();
    try {
      const send = vi
        .fn()
        .mockResolvedValueOnce({ QueryExecutionId: "q-3" })
        .mockResolvedValue({ QueryExecution: { Status: { State: "RUNNING" } } });
      const client = { send } as unknown as import("@aws-sdk/client-athena").AthenaClient;

      process.env.ATHENA_WORKGROUP = "wg";
      process.env.ATHENA_DATABASE = "db";

      const promise = runAthenaQuery(client, "SELECT 1");
      const assertion = expect(promise).rejects.toThrow(
        "Athena query timed out waiting for SUCCEEDED state"
      );
      await vi.advanceTimersByTimeAsync(50 * 500 + 1000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("partitionWhere (exported)", () => {
  it("is the same clause runAthenaQuery's internal queries already produce", () => {
    const parts = { year: "2026", month: "09", day: "20" };
    expect(partitionWhere(parts)).toBe("WHERE year='2026' AND month='09' AND day='20'");
  });
});

describe("runAthenaQueryWithStats", () => {
  it("returns columns, rows, stats, and hasMoreRows:false when there's no NextToken", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ QueryExecutionId: "q-10" })
      .mockResolvedValueOnce({
        QueryExecution: {
          Status: { State: "SUCCEEDED" },
          Statistics: { DataScannedInBytes: 4200000, EngineExecutionTimeInMillis: 310 },
        },
      })
      .mockResolvedValueOnce({
        ResultSet: {
          ResultSetMetadata: { ColumnInfo: [{ Name: "coin_id" }, { Name: "price_usd" }] },
          Rows: [
            { Data: [{ VarCharValue: "coin_id" }, { VarCharValue: "price_usd" }] },
            { Data: [{ VarCharValue: "bitcoin" }, { VarCharValue: "81314.2" }] },
          ],
        },
      });
    const client = { send } as unknown as import("@aws-sdk/client-athena").AthenaClient;

    process.env.ATHENA_WORKGROUP = "wg";
    process.env.ATHENA_DATABASE = "db";
    const result = await runAthenaQueryWithStats(client, "SELECT 1", 100);

    expect(result.columns).toEqual(["coin_id", "price_usd"]);
    expect(result.rows).toHaveLength(2);
    expect(result.stats).toEqual({ dataScannedInBytes: 4200000, engineExecutionTimeMs: 310 });
    expect(result.hasMoreRows).toBe(false);
  });

  it("passes maxResults through to GetQueryResultsCommand and reports hasMoreRows:true when NextToken is present", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ QueryExecutionId: "q-11" })
      .mockResolvedValueOnce({
        QueryExecution: { Status: { State: "SUCCEEDED" }, Statistics: {} },
      })
      .mockResolvedValueOnce({
        ResultSet: { ResultSetMetadata: { ColumnInfo: [] }, Rows: [] },
        NextToken: "more-pages",
      });
    const client = { send } as unknown as import("@aws-sdk/client-athena").AthenaClient;

    process.env.ATHENA_WORKGROUP = "wg";
    process.env.ATHENA_DATABASE = "db";
    const result = await runAthenaQueryWithStats(client, "SELECT 1", 5);

    const resultsCall = send.mock.calls[2][0];
    expect(resultsCall.input.MaxResults).toBe(5);
    expect(result.hasMoreRows).toBe(true);
    expect(result.stats).toEqual({ dataScannedInBytes: 0, engineExecutionTimeMs: 0 });
  });

  it("throws with the failure reason when the query fails, same as runAthenaQuery", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ QueryExecutionId: "q-12" })
      .mockResolvedValueOnce({
        QueryExecution: { Status: { State: "FAILED", StateChangeReason: "table not found" } },
      });
    const client = { send } as unknown as import("@aws-sdk/client-athena").AthenaClient;

    process.env.ATHENA_WORKGROUP = "wg";
    process.env.ATHENA_DATABASE = "db";
    await expect(runAthenaQueryWithStats(client, "SELECT 1")).rejects.toThrow("table not found");
  });
});
