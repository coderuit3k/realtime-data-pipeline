import { describe, expect, it } from "vitest";
import { buildCurrentReadingsQuery, buildHistoryQuery } from "./weatherQueries";
import type { TodayParts } from "./athena";

const PARTS: TodayParts[] = [
  { year: "2026", month: "09", day: "20" },
  { year: "2026", month: "09", day: "19" },
];

describe("buildCurrentReadingsQuery", () => {
  it("selects the latest reading per location across the given partitions, sorted hottest first", () => {
    const sql = buildCurrentReadingsQuery(PARTS);
    expect(sql).toContain("ROW_NUMBER() OVER (PARTITION BY location ORDER BY observed_at DESC)");
    expect(sql).toContain("WHERE rn = 1");
    expect(sql).toContain("ORDER BY temperature_c DESC");
    expect(sql).toContain("(year='2026' AND month='09' AND day='20')");
    expect(sql).toContain("(year='2026' AND month='09' AND day='19')");
    expect(sql).toContain("FROM weather_observations");
  });
});

describe("buildHistoryQuery", () => {
  it("filters by the validated location, the partition window, and the local-frame cutoff", () => {
    const sql = buildHistoryQuery("Da Lat", PARTS, "2026-09-19T17:00:00");
    expect(sql).toContain("location = 'Da Lat'");
    expect(sql).toContain("from_iso8601_timestamp(observed_at) >= from_iso8601_timestamp('2026-09-19T17:00:00')");
    expect(sql).toContain("GROUP BY date_trunc('hour', from_iso8601_timestamp(observed_at))");
    expect(sql).toContain("ORDER BY hour_bucket");
    expect(sql).not.toContain("current_timestamp");
  });
});
