import { partitionPredicateAny, type TodayParts } from "./athena";

export function buildTrendEventsQuery(partsList: TodayParts[]): string {
  const where = partitionPredicateAny(partsList);
  return `SELECT event_id, keyword, event_date, github_count, hn_count, news_count
FROM (
  SELECT *,
         ROW_NUMBER() OVER (PARTITION BY event_id ORDER BY detected_at DESC) AS rn
  FROM trend_events
  WHERE ${where}
) ranked
WHERE rn = 1
ORDER BY event_date DESC, (hn_count + news_count) DESC`;
}
