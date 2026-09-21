import { describe, expect, it } from "vitest";
import { lastNDaysUtcParts, hoursAgoAsObservedAtLocal } from "./dateRange";

describe("lastNDaysUtcParts", () => {
  it("returns n consecutive UTC day-parts ending today, most recent first", () => {
    const now = new Date("2026-09-20T10:00:00Z");
    expect(lastNDaysUtcParts(3, now)).toEqual([
      { year: "2026", month: "09", day: "20" },
      { year: "2026", month: "09", day: "19" },
      { year: "2026", month: "09", day: "18" },
    ]);
  });

  it("returns exactly today when n=1", () => {
    const now = new Date("2026-09-20T12:00:00Z");
    expect(lastNDaysUtcParts(1, now)).toEqual([{ year: "2026", month: "09", day: "20" }]);
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

describe("hoursAgoAsObservedAtLocal", () => {
  it("shifts real UTC now by +7h (Vietnam offset) before subtracting the window", () => {
    // Real UTC now: 2026-09-20T10:00:00Z. Vietnam local: 2026-09-20T17:00:00.
    // 24h before that local instant: 2026-09-19T17:00:00 -- with NO "Z" suffix,
    // since observed_at values are naive local strings, never UTC-tagged.
    const now = new Date("2026-09-20T10:00:00Z");
    expect(hoursAgoAsObservedAtLocal(24, now)).toBe("2026-09-19T17:00:00");
  });

  it("handles a small window (1 hour)", () => {
    const now = new Date("2026-09-20T10:00:00Z");
    expect(hoursAgoAsObservedAtLocal(1, now)).toBe("2026-09-20T16:00:00");
  });

  it("defaults `now` to the real current time when omitted", () => {
    const before = Date.now();
    const result = hoursAgoAsObservedAtLocal(24);
    // Just confirms it ran without a `now` argument and returned a
    // plausible ISO-shaped string -- exact value depends on when this
    // test runs, so only the shape is checked here. No fractional
    // seconds -- matches Open-Meteo's own current.time precision
    // (no milliseconds), and avoids relying on Athena's ISO8601 parser
    // accepting a precision it's never been exercised against in this
    // codebase.
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    expect(Date.now()).toBeGreaterThanOrEqual(before);
  });
});
