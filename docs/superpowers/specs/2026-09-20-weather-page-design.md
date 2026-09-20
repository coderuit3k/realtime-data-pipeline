# Weather page — design spec

## Overview

Add an eighth real screen to the `web/` Next.js app: `/weather`, showing
the real current conditions across the pipeline's 12 real Southern
Vietnam weather locations on a stylized map, plus a detail card and 24h
history sparkline for whichever location is selected. This is the sixth
of 8 sub-projects extending the mockup to real, AWS-backed pages.

Reference mockup: Design canvas
`https://claude.ai/artifact/Ccbcs7E8ZSsf4fUG5opm4W`, `project/Weather.dc.html`.

## Real data sources

`common/config.py`'s `WEATHER_LOCATIONS` (expanded from 4 to these exact
12 real Southern Vietnam provinces during the Insights sub-project): Tay
Ninh, Ho Chi Minh City, Thu Dau Mot (Binh Duong), Long Xuyen (An Giang),
Bien Hoa (Dong Nai), Can Tho, My Tho (Tien Giang), Soc Trang, Vung Tau,
Rach Gia (Kien Giang), Ca Mau, Da Lat. `ingestion/weather_ingestion.py`
fetches each location's current conditions from Open-Meteo (no API key)
roughly every 10 minutes, writing real `temperature_c`, `humidity_pct`,
`precipitation_mm`, `wind_speed_kmh`, `latitude`, `longitude`, and
`observed_at` into the curated `weather_observations` Athena/Glue table
(schema: `infra/glue.tf`'s `weather_columns`). All 12 locations already
have real accumulated data, confirmed live during the Insights
sub-project's verification.

## Non-goals

- **No real geographic map data.** There's no Vietnam GeoJSON in this
  project. The map's landmass shape is decorative illustration (the same
  stylized "sea/land" SVG background from the mockup, reused as-is) — not
  a geographically accurate coastline. Only the **pins** are real: each
  one's position is computed by linearly projecting that location's real
  latitude/longitude onto the SVG viewBox, not hand-placed.
- **No pan/zoom.** The mockup's zoom buttons and "~80 km" scale bar stay
  as non-functional decorative chrome, matching this app's established
  no-scope-creep convention (Dashboard, Ops, etc. don't add interactivity
  the data doesn't need).
- **No "major city" always-labeled pins.** The mockup always-labels
  TP.HCM and Cần Thơ regardless of selection — a hardcoded, not
  data-backed distinction. Simplified: only the *currently selected*
  location gets the highlighted label box (matching how Đà Lạt is shown
  in the mockup); every other location is a plain color-coded dot.
  Selecting a different location moves the highlight.
- **No weather-code/icon display.** Open-Meteo's `weather_code` field is
  ingested but never shown by the mockup (no rain/sun icons) — not
  surfaced on this page either, consistent with the mockup.
- **No live-updating/polling.** Fetches once per load, same as every
  other real page in this app.

## Architecture

```
GET /api/weather
  → web/lib/weatherQueries.ts: buildCurrentReadingsQuery(partsList)
      SELECT location, latitude, longitude, temperature_c, humidity_pct,
             precipitation_mm, wind_speed_kmh, observed_at
      FROM (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY location
               ORDER BY observed_at DESC) AS rn
        FROM weather_observations WHERE <partition predicate>
      ) ranked WHERE rn = 1
      ORDER BY temperature_c DESC
  → same "latest reading per group" pattern already proven in Insights'
    buildWeatherSnapshotQuery -- spans today + yesterday's partitions
    (partitionPredicateAny over 2 TodayParts) since a location's most
    recent reading could be just before UTC midnight
  → web/lib/types.ts: WeatherResponse { locations: WeatherLocation[] }
  → Cache-Control: s-maxage=60, stale-while-revalidate=120 (matches
    Dashboard/Insights/Ops's cadence for ~10-minute-refreshed data)

GET /api/weather/history?location=<name>
  → web/lib/weatherMeta.ts: WEATHER_LOCATION_NAMES whitelist check --
    400 with a safe error if `location` isn't one of the 12 real names
  → web/lib/weatherQueries.ts: buildHistoryQuery(location, partsList,
    cutoffLocalIso) -- cutoffLocalIso from dateRange.ts's
    hoursAgoAsObservedAtLocal(24), NOT SQL's current_timestamp (see
    "Timezone correctness" below)
      SELECT date_trunc('hour', from_iso8601_timestamp(observed_at))
             AS hour_bucket, AVG(temperature_c) AS avg_temperature_c
      FROM weather_observations
      WHERE location = '<validated location>' AND <partition predicate>
        AND from_iso8601_timestamp(observed_at)
            >= from_iso8601_timestamp('<cutoffLocalIso>')
      GROUP BY date_trunc('hour', from_iso8601_timestamp(observed_at))
      ORDER BY hour_bucket
  → web/lib/types.ts: WeatherHistoryResponse { location: string; points:
    { hourBucket: string; avgTemperatureC: number }[] }
  → Cache-Control: s-maxage=60, stale-while-revalidate=120
```

- **`web/lib/weatherMeta.ts` (new).** `WEATHER_LOCATION_NAMES: string[]`
  -- the 12 real names, verbatim from `common/config.py:WEATHER_LOCATIONS`
  (cited in a comment; no cross-language runtime check, same convention
  as `opsMeta.ts`'s `PIPELINE_LAMBDAS`). Exported `isKnownWeatherLocation
  (value: string): boolean` used by the history route to validate the
  `location` query param before it reaches SQL -- the only client-
  influenced value in this feature that touches a query, so it gets the
  same non-negotiable validate-before-interpolate treatment as every
  other user-influenced value elsewhere in this app (Explorer's SQL
  guard is the strictest instance of this same rule, not a special case).
  Also exports `TEMP_BAND_THRESHOLDS_C = { cool: 22, hot: 30 }` (the
  legend's real breakpoints, `<22` / `22-30` / `>30`) as a single source
  used by both the map pins and the ranked list's color dots.
- **`web/lib/weatherQueries.ts` (new).** The two query builders above,
  reusing `partitionPredicateAny`/`TodayParts` from `athena.ts` (same
  import pattern as `insightsQueries.ts`).
- **`web/lib/mapProjection.ts` (new).** Pure function `projectLatLng(lat,
  lon, bounds: {latMin,latMax,lonMin,lonMax}, viewBox: {width,height},
  padding: number): {x: number; y: number}` -- linear projection, y
  inverted (`latMax - lat` over the lat range) since SVG y grows
  downward while latitude grows northward. `WEATHER_BOUNDS` (the real
  min/max lat/lon across the 12 locations, computed once as a constant
  with a comment showing the source values) lives here too.
- **`web/lib/types.ts` (modified).** Adds `WeatherLocation = { location:
  string; latitude: number; longitude: number; temperatureC: number;
  humidityPct: number; precipitationMm: number; windSpeedKmh: number;
  observedAt: string }`, `WeatherResponse = { locations: WeatherLocation[]
  }`, `WeatherHistoryPoint = { hourBucket: string; avgTemperatureC:
  number }`, `WeatherHistoryResponse = { location: string; points:
  WeatherHistoryPoint[] }`.
- **`web/app/api/weather/route.ts` (new, GET).** Runs
  `buildCurrentReadingsQuery`, maps rows to `WeatherLocation[]`.
- **`web/app/api/weather/history/route.ts` (new, GET).** Reads `location`
  from `request.nextUrl.searchParams`, validates via
  `isKnownWeatherLocation`, 400 if invalid; otherwise runs
  `buildHistoryQuery`, maps rows to `WeatherHistoryResponse`.
- **`web/app/weather/page.tsx` (new).** Client component:
  - Fetches `/api/weather` on mount; on success, sets `selected` state to
    `"Da Lat"` (the real coolest location among the 12 -- genuinely an
    outlier due to ~1500m elevation, matching the mockup's default, not
    an arbitrary pick) and triggers the history fetch for it.
  - A `useEffect` keyed on `selected` fetches
    `/api/weather/history?location=${encodeURIComponent(selected)}`
    whenever the selection changes (including the initial Da Lat fetch).
  - Renders the SVG map: decorative land-shape path from the mockup,
    reused verbatim; pins positioned via `projectLatLng` using each
    location's real lat/long from the `/api/weather` response; pin color
    from `TEMP_BAND_THRESHOLDS_C`; the selected pin gets the halo +
    label-box treatment, others are plain dots; clicking any pin sets
    `selected`.
  - Renders the ranked list (all 12, sorted by `temperatureC` desc --
    already sorted server-side by the query's `ORDER BY`), each row
    clickable to set `selected`, selected row highlighted.
  - Renders the detail card: selected location's name, big temperature,
    humidity/precipitation/wind grid, and the sparkline built from
    `WeatherHistoryResponse.points` (an SVG `polyline`, min/max-scaled
    to the fetched points -- if there are 0-1 points, shows "Chưa đủ dữ
    liệu" instead of a degenerate line).
  - "Cập nhật N phút trước" badge computed from the real
    `max(observedAt)` across the 12 locations in the `/api/weather`
    response, formatted client-side.
- **`web/components/NavBar.tsx`** gains an 8th entry: `{ href: "/weather",
  label: "Thời tiết" }`.

## Error handling

Matches the established convention: `/api/weather` failure → `console.error`
+ `{ error: "Không tải được thời tiết, thử lại sau." }` at 500, uncached.
`/api/weather/history` with an unrecognized `location` → `{ error:
"Không tìm thấy địa điểm." }` at 400 (no `console.error` -- this is a
client-input-shape issue, not a backend failure); any other failure
(missing env var, Athena error) → same 500 pattern as every other route.

## Testing

- `web/lib/mapProjection.test.ts` -- known lat/lon → expected (x, y) for
  the 4 extreme points (northernmost/southernmost/easternmost/westernmost
  of the real 12 locations should land near the viewBox's edges, adjusted
  for padding) plus a midpoint sanity check.
- `web/lib/weatherMeta.test.ts` -- `isKnownWeatherLocation` true for all
  12 real names, false for an unrelated string and for an empty string.
- `web/lib/weatherQueries.test.ts` -- both builders produce the expected
  SQL shape for known inputs (partition predicate present, `location`
  value correctly single-quoted, `GROUP BY`/`ORDER BY` clauses present).
- `web/app/api/weather/route.test.ts` -- happy path (mocked Athena rows →
  correctly mapped/sorted `WeatherLocation[]`), 500 error path.
- `web/app/api/weather/history/route.test.ts` -- happy path, 400 for an
  unrecognized `location` param (and confirms the mocked Athena client
  was never called in that case -- proves the whitelist check runs
  before any query is built), 500 error path for a recognized location.
- No component tests (project convention) -- manual live-verification
  checklist after deploy: load `/weather`, confirm all 12 real locations
  render with plausible real temperatures, confirm Đà Lạt is selected by
  default and is the coolest, click through 2-3 other locations and
  confirm the detail card + sparkline update, confirm the "Cập nhật N
  phút trước" badge reflects a real recent time.

## Timezone correctness (verified during planning, not an assumption)

`weather_ingestion.py` requests Open-Meteo with `timezone=Asia/Bangkok`
for every one of the 12 locations. Open-Meteo's own docs state that when
`timezone` is set, every timestamp it returns (including `current.time`)
is **naive local time with no UTC offset suffix** (e.g. `2026-09-20T21:00`,
not `...+07:00` or `...Z`). `normalize_current` stores this value verbatim
as `observed_at` -- so every row in `weather_observations` is Vietnam
local time (UTC+7, no DST), not UTC, even though it looks like a plain
ISO-8601 string. (`ingested_at`, by contrast, IS real UTC --
`datetime.now(timezone.utc).isoformat()` -- but that field reflects when
the Lambda ran, not when the reading was taken, so it's the wrong field
for "how recent is this weather.")

This must never be compared against SQL's `current_timestamp` (real UTC)
-- doing so would silently skew any "last 24h" cutoff by 7 hours. Instead:
`web/lib/dateRange.ts` gains `hoursAgoAsObservedAtLocal(hours, now?):
string`, which shifts the real `now` by the same +7h Vietnam offset before
subtracting the window, producing a naive-local ISO string in the exact
frame `observed_at` values are already in. The route computes this once
and passes it into `buildHistoryQuery` as a plain string parameter --
`from_iso8601_timestamp` is still used inside SQL (for `date_trunc('hour',
...)` bucketing and for parsing both sides of the `>=` comparison so
minute/second-precision differences don't break string comparison), but
never compared against `current_timestamp`. As a side benefit, hourly
buckets land on real Vietnam local hours, which is the more meaningful
framing for a Vietnam weather page anyway.

## Open assumptions

- A location's most recent reading could fall in yesterday's UTC
  partition (just before midnight) relative to "now" -- the current-
  readings query spans today + yesterday's partitions (2 `TodayParts`)
  to avoid ever showing 11 of 12 locations plus one stale/missing one.
  The 24h-history query needs the same 2-day span for the same reason
  (partitions are written by UTC transform time, per `transform.py`'s
  `write_parquet`, so this is independent of the `observed_at` timezone
  issue above).
