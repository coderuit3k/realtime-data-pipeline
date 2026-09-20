import { todayUtcParts, type TodayParts } from "./athena";

export function lastNDaysUtcParts(n: number, now: Date = new Date()): TodayParts[] {
  const parts: TodayParts[] = [];
  for (let i = 0; i < n; i++) {
    parts.push(todayUtcParts(new Date(now.getTime() - i * 24 * 60 * 60 * 1000)));
  }
  return parts;
}
