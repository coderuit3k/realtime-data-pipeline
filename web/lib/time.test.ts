import { describe, expect, it } from "vitest";
import { relativeTime } from "./time";

const NOW = new Date("2026-10-05T12:00:00Z");

describe("relativeTime", () => {
  it("returns a placeholder for null", () => {
    expect(relativeTime(null, NOW)).toBe("chưa có dữ liệu");
  });

  it("clamps future timestamps to just now", () => {
    expect(relativeTime("2026-10-05T12:05:00Z", NOW)).toBe("vừa xong");
  });

  it("uses minutes, hours and days", () => {
    expect(relativeTime("2026-10-05T11:30:00Z", NOW)).toBe("30 phút trước");
    expect(relativeTime("2026-10-05T09:00:00Z", NOW)).toBe("3 giờ trước");
    expect(relativeTime("2026-10-02T12:00:00Z", NOW)).toBe("3 ngày trước");
  });

  it("stops at hours when maxUnit is hours", () => {
    expect(relativeTime("2026-10-02T12:00:00Z", NOW, { maxUnit: "hours" })).toBe("72 giờ trước");
  });
});
