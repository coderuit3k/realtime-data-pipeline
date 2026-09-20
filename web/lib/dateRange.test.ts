import { describe, expect, it } from "vitest";
import { lastNDaysUtcParts } from "./dateRange";

describe("lastNDaysUtcParts", () => {
  it("returns exactly today when n=1", () => {
    const now = new Date("2026-09-20T12:00:00Z");
    expect(lastNDaysUtcParts(1, now)).toEqual([{ year: "2026", month: "09", day: "20" }]);
  });

  it("returns 7 consecutive days ending today, most recent first", () => {
    const now = new Date("2026-09-20T12:00:00Z");
    expect(lastNDaysUtcParts(7, now)).toEqual([
      { year: "2026", month: "09", day: "20" },
      { year: "2026", month: "09", day: "19" },
      { year: "2026", month: "09", day: "18" },
      { year: "2026", month: "09", day: "17" },
      { year: "2026", month: "09", day: "16" },
      { year: "2026", month: "09", day: "15" },
      { year: "2026", month: "09", day: "14" },
    ]);
  });

  it("rolls over a month/year boundary correctly", () => {
    const now = new Date("2026-01-03T12:00:00Z");
    expect(lastNDaysUtcParts(7, now)).toEqual([
      { year: "2026", month: "01", day: "03" },
      { year: "2026", month: "01", day: "02" },
      { year: "2026", month: "01", day: "01" },
      { year: "2025", month: "12", day: "31" },
      { year: "2025", month: "12", day: "30" },
      { year: "2025", month: "12", day: "29" },
      { year: "2025", month: "12", day: "28" },
    ]);
  });
});
