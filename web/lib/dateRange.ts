import { todayUtcParts, type TodayParts } from "./athena";
import { VIETNAM_UTC_OFFSET_HOURS } from "./weatherMeta";

export function lastNDaysUtcParts(n: number, now: Date = new Date()): TodayParts[] {
  const parts: TodayParts[] = [];
  for (let i = 0; i < n; i++) {
    parts.push(todayUtcParts(new Date(now.getTime() - i * 24 * 60 * 60 * 1000)));
  }
  return parts;
}

export function hoursAgoAsObservedAtLocal(hours: number, now: Date = new Date()): string {
  const shiftedMs = now.getTime() + VIETNAM_UTC_OFFSET_HOURS * 60 * 60 * 1000 - hours * 60 * 60 * 1000;
  // Slice off milliseconds and the "Z" -- Open-Meteo's own current.time
  // has no fractional seconds, and this keeps the cutoff string in the
  // same precision/shape as real observed_at values.
  return new Date(shiftedMs).toISOString().slice(0, 19);
}
