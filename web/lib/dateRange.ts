import { todayUtcParts, type TodayParts } from "./athena";
import { VIETNAM_UTC_OFFSET_HOURS } from "./weatherMeta";

/** UTC partition values for today and the previous n-1 days, newest first. */
export function lastNDaysUtcParts(n: number, now: Date = new Date()): TodayParts[] {
  const parts: TodayParts[] = [];
  for (let i = 0; i < n; i++) {
    parts.push(todayUtcParts(new Date(now.getTime() - i * 24 * 60 * 60 * 1000)));
  }
  return parts;
}

/**
 * A cutoff `hours` ago, formatted like weather_observations.observed_at:
 * naive Vietnam local time (no offset), so the two compare correctly in SQL.
 */
export function hoursAgoAsObservedAtLocal(hours: number, now: Date = new Date()): string {
  const shiftedMs = now.getTime() + VIETNAM_UTC_OFFSET_HOURS * 60 * 60 * 1000 - hours * 60 * 60 * 1000;
  // Drop milliseconds and "Z" to match observed_at's "YYYY-MM-DDTHH:MM:SS" shape.
  return new Date(shiftedMs).toISOString().slice(0, 19);
}
