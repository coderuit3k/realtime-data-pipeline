import { describe, expect, it } from "vitest";
import { buildTrendEventsQuery } from "./trendsQueries";

const PARTS_TODAY = [{ year: "2026", month: "09", day: "27" }];
const PARTS_MULTI = [
  { year: "2026", month: "09", day: "27" },
  { year: "2026", month: "09", day: "26" },
];

describe("buildTrendEventsQuery", () => {
  it("references the trend_events table, is partition-bounded, and orders newest first", () => {
    const sql = buildTrendEventsQuery(PARTS_TODAY);
    expect(sql).toContain("FROM trend_events");
    expect(sql).toContain("WHERE");
    expect(sql).toContain("day='27'");
    expect(sql).toContain("ORDER BY event_date DESC");
  });

  it("references every day in a multi-day range", () => {
    const sql = buildTrendEventsQuery(PARTS_MULTI);
    expect(sql).toContain("day='27'");
    expect(sql).toContain("day='26'");
  });

  it("dedupes by event_id, keeping the most recently detected row", () => {
    const sql = buildTrendEventsQuery(PARTS_TODAY);
    expect(sql).toContain("ROW_NUMBER() OVER (PARTITION BY event_id ORDER BY detected_at DESC)");
    expect(sql).toContain("WHERE rn = 1");
  });
});
