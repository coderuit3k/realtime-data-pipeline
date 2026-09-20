import { partitionPredicateAny, type TodayParts } from "./athena";

export function buildCurrentReadingsQuery(partsList: TodayParts[]): string {
  const where = partitionPredicateAny(partsList);
  return `SELECT location, latitude, longitude, temperature_c, humidity_pct, precipitation_mm, wind_speed_kmh, observed_at
FROM (
  SELECT location, latitude, longitude, temperature_c, humidity_pct, precipitation_mm, wind_speed_kmh, observed_at,
         ROW_NUMBER() OVER (PARTITION BY location ORDER BY observed_at DESC) AS rn
  FROM weather_observations
  WHERE ${where}
) ranked
WHERE rn = 1
ORDER BY temperature_c DESC`;
}

// `location` must already be validated against WEATHER_LOCATION_NAMES by
// the caller (web/lib/weatherMeta.ts's isKnownWeatherLocation) before this
// is called -- this function trusts its input and does not re-validate.
export function buildHistoryQuery(location: string, partsList: TodayParts[], cutoffLocalIso: string): string {
  const where = partitionPredicateAny(partsList);
  return `SELECT date_trunc('hour', from_iso8601_timestamp(observed_at)) AS hour_bucket,
       AVG(temperature_c) AS avg_temperature_c
FROM weather_observations
WHERE location = '${location}'
  AND (${where})
  AND from_iso8601_timestamp(observed_at) >= from_iso8601_timestamp('${cutoffLocalIso}')
GROUP BY date_trunc('hour', from_iso8601_timestamp(observed_at))
ORDER BY hour_bucket`;
}
