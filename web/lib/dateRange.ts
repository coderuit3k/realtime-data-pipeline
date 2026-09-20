import { todayUtcParts, type TodayParts } from "./athena";

export function lastNDaysUtcParts(n: number, now: Date = new Date()): TodayParts[] {
  const parts: TodayParts[] = [];
  for (let i = 0; i < n; i++) {
    parts.push(todayUtcParts(new Date(now.getTime() - i * 24 * 60 * 60 * 1000)));
  }
  return parts;
}

// weather_ingestion.py requests Open-Meteo with timezone=Asia/Bangkok for
// every one of the 12 real locations (all within Vietnam, UTC+7, no DST).
// Open-Meteo's docs: when timezone= is set, returned timestamps are naive
// local time with NO UTC offset suffix. observed_at is stored exactly as
// returned, so every value in weather_observations is Vietnam local time,
// not UTC -- this must never be compared against SQL's current_timestamp
// (real UTC). This shifts a real Date by the same +7h before subtracting
// the window, producing a naive-local ISO string in the same frame
// observed_at values are already in.
const VIETNAM_UTC_OFFSET_HOURS = 7;

export function hoursAgoAsObservedAtLocal(hours: number, now: Date = new Date()): string {
  const shiftedMs = now.getTime() + VIETNAM_UTC_OFFSET_HOURS * 60 * 60 * 1000 - hours * 60 * 60 * 1000;
  // Slice off milliseconds and the "Z" -- Open-Meteo's own current.time
  // has no fractional seconds, and this keeps the cutoff string in the
  // same precision/shape as real observed_at values.
  return new Date(shiftedMs).toISOString().slice(0, 19);
}
