# Weather Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real `/weather` page to the `web/` Next.js app showing the
12 real Southern Vietnam locations' current weather on a stylized map,
plus a detail card and 24h sparkline for whichever location is selected.

**Architecture:** Two new API routes (`/api/weather` for all 12 current
readings, `/api/weather/history?location=` for one location's hourly
24h history) backed by real Athena queries over the existing
`weather_observations` table, plus a client page that renders a
projected-from-real-lat/long SVG map, a ranked list, and a detail card.

**Tech Stack:** Next.js 15 App Router, TypeScript, `@aws-sdk/client-athena`
(already a dependency), Vitest.

**Spec:** `docs/superpowers/specs/2026-09-20-weather-page-design.md`

## Global Constraints

- No real Vietnam GeoJSON exists in this project -- the map's landmass
  shape is decorative illustration (mockup's SVG path, reused verbatim),
  never presented as geographically accurate. Only pin **positions** are
  real (computed from real lat/long).
- No pan/zoom, no weather-code/icon display, no live-updating/polling --
  matches the mockup and this app's established no-scope-creep convention.
- No "major city" always-labeled pins -- only the selected location gets
  a highlighted label box; every other location is a plain colored dot.
- `location` is the only client-influenced value that reaches SQL in this
  feature. It MUST be validated against the exact 12-name whitelist in
  `weatherMeta.ts` before being interpolated into any query string -- an
  unrecognized value returns 400 and never reaches Athena. This is the
  same non-negotiable validate-before-interpolate rule as every other
  user-influenced value elsewhere in this app (Explorer's SQL guard is
  the strictest instance of this same rule).
- `observed_at` values in `weather_observations` are naive Vietnam local
  time (UTC+7), NOT UTC -- confirmed via Open-Meteo's own docs (when
  `timezone=` is set, returned timestamps have no UTC offset suffix) plus
  `weather_ingestion.py` requesting `timezone=Asia/Bangkok` for every
  location. NEVER compare `observed_at` against SQL's `current_timestamp`
  (real UTC) -- any "how recent" cutoff must be computed in TypeScript
  using the same +7h shift (`dateRange.ts`'s `hoursAgoAsObservedAtLocal`)
  and passed in as a string parameter.
- Error handling matches the established convention: unexpected failures
  → `console.error` + a safe Vietnamese error message + 500, uncached.
  Client-input-shape issues (unknown `location`) → 400, no
  `console.error` (not a backend failure).
- Cache-Control on both new routes: `public, s-maxage=60,
  stale-while-revalidate=120` (matches Dashboard/Insights/Ops's cadence
  for ~10-minute-refreshed data).

---

### Task 1: Query builders + timezone-safe date helper

**Files:**
- Create: `web/lib/weatherQueries.ts`
- Create: `web/lib/weatherQueries.test.ts`
- Modify: `web/lib/dateRange.ts`
- Create: `web/lib/dateRange.test.ts` (this file doesn't exist yet --
  `lastNDaysUtcParts` currently has no dedicated test file; add one
  covering both the existing function and the new one)

**Interfaces:**
- Consumes: `TodayParts` type and `partitionPredicateAny` from
  `web/lib/athena.ts` (both already exist, unchanged).
- Produces: `buildCurrentReadingsQuery(partsList: TodayParts[]): string`,
  `buildHistoryQuery(location: string, partsList: TodayParts[],
  cutoffLocalIso: string): string` (both in `weatherQueries.ts`);
  `hoursAgoAsObservedAtLocal(hours: number, now?: Date): string` (added
  to `dateRange.ts`). Task 3 (the API routes) calls all three.

- [ ] **Step 1: Write the failing tests for `hoursAgoAsObservedAtLocal`**

Add to `web/lib/dateRange.test.ts` (new file -- also add a test for the
existing `lastNDaysUtcParts` so this file isn't solely about the new
function):

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run lib/dateRange.test.ts`
Expected: FAIL -- `hoursAgoAsObservedAtLocal is not a function` (and the
`lastNDaysUtcParts` test should already pass since that function exists).

- [ ] **Step 3: Implement `hoursAgoAsObservedAtLocal`**

Add to `web/lib/dateRange.ts` (keep the existing `lastNDaysUtcParts`
unchanged, add below it):

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run lib/dateRange.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Write the failing tests for the query builders**

Create `web/lib/weatherQueries.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildCurrentReadingsQuery, buildHistoryQuery } from "./weatherQueries";
import type { TodayParts } from "./athena";

const PARTS: TodayParts[] = [
  { year: "2026", month: "09", day: "20" },
  { year: "2026", month: "09", day: "19" },
];

describe("buildCurrentReadingsQuery", () => {
  it("selects the latest reading per location across the given partitions, sorted hottest first", () => {
    const sql = buildCurrentReadingsQuery(PARTS);
    expect(sql).toContain("ROW_NUMBER() OVER (PARTITION BY location ORDER BY observed_at DESC)");
    expect(sql).toContain("WHERE rn = 1");
    expect(sql).toContain("ORDER BY temperature_c DESC");
    expect(sql).toContain("(year='2026' AND month='09' AND day='20')");
    expect(sql).toContain("(year='2026' AND month='09' AND day='19')");
    expect(sql).toContain("FROM weather_observations");
  });
});

describe("buildHistoryQuery", () => {
  it("filters by the validated location, the partition window, and the local-frame cutoff", () => {
    const sql = buildHistoryQuery("Da Lat", PARTS, "2026-09-19T17:00:00");
    expect(sql).toContain("location = 'Da Lat'");
    expect(sql).toContain("from_iso8601_timestamp(observed_at) >= from_iso8601_timestamp('2026-09-19T17:00:00')");
    expect(sql).toContain("GROUP BY date_trunc('hour', from_iso8601_timestamp(observed_at))");
    expect(sql).toContain("ORDER BY hour_bucket");
    expect(sql).not.toContain("current_timestamp");
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `cd web && npx vitest run lib/weatherQueries.test.ts`
Expected: FAIL -- module `./weatherQueries` not found

- [ ] **Step 7: Implement the query builders**

Create `web/lib/weatherQueries.ts`:

```ts
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
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd web && npx vitest run lib/weatherQueries.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 9: Commit**

```bash
git add web/lib/dateRange.ts web/lib/dateRange.test.ts web/lib/weatherQueries.ts web/lib/weatherQueries.test.ts
git commit -m "Add Weather query builders + Vietnam-local-time date helper"
```

---

### Task 2: Location whitelist, temperature bands, and map projection

**Files:**
- Create: `web/lib/weatherMeta.ts`
- Create: `web/lib/weatherMeta.test.ts`
- Create: `web/lib/mapProjection.ts`
- Create: `web/lib/mapProjection.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `WEATHER_LOCATION_NAMES: string[]`, `isKnownWeatherLocation
  (value: string): boolean`, `TEMP_BAND_THRESHOLDS_C = { cool: 22, hot: 30
  }`, `temperatureBand(tempC: number): "cool" | "moderate" | "hot"` (all
  in `weatherMeta.ts`); `projectLatLng(point: {latitude: number;
  longitude: number}, bounds: {latMin,latMax,lonMin,lonMax}, viewBox:
  {width,height}, padding: number): {x: number; y: number}` and
  `WEATHER_BOUNDS` (in `mapProjection.ts`). Task 3 (routes) uses
  `isKnownWeatherLocation`; Task 4 (page) uses everything here.

- [ ] **Step 1: Write the failing tests for `weatherMeta.ts`**

Create `web/lib/weatherMeta.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { WEATHER_LOCATION_NAMES, isKnownWeatherLocation, temperatureBand } from "./weatherMeta";

describe("WEATHER_LOCATION_NAMES", () => {
  it("has exactly the 12 real locations from common/config.py", () => {
    expect(WEATHER_LOCATION_NAMES).toEqual([
      "Tay Ninh",
      "Ho Chi Minh City",
      "Thu Dau Mot (Binh Duong)",
      "Long Xuyen (An Giang)",
      "Bien Hoa (Dong Nai)",
      "Can Tho",
      "My Tho (Tien Giang)",
      "Soc Trang",
      "Vung Tau",
      "Rach Gia (Kien Giang)",
      "Ca Mau",
      "Da Lat",
    ]);
  });
});

describe("isKnownWeatherLocation", () => {
  it("returns true for every real location name", () => {
    for (const name of WEATHER_LOCATION_NAMES) {
      expect(isKnownWeatherLocation(name)).toBe(true);
    }
  });

  it("returns false for an unrelated string", () => {
    expect(isKnownWeatherLocation("Hanoi")).toBe(false);
  });

  it("returns false for an empty string", () => {
    expect(isKnownWeatherLocation("")).toBe(false);
  });

  it("returns false for a SQL-injection attempt", () => {
    expect(isKnownWeatherLocation("Da Lat' OR '1'='1")).toBe(false);
  });
});

describe("temperatureBand", () => {
  it("bands below 22 as cool", () => {
    expect(temperatureBand(19)).toBe("cool");
    expect(temperatureBand(21.9)).toBe("cool");
  });

  it("bands 22-30 inclusive as moderate", () => {
    expect(temperatureBand(22)).toBe("moderate");
    expect(temperatureBand(30)).toBe("moderate");
  });

  it("bands above 30 as hot", () => {
    expect(temperatureBand(30.1)).toBe("hot");
    expect(temperatureBand(35)).toBe("hot");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run lib/weatherMeta.test.ts`
Expected: FAIL -- module `./weatherMeta` not found

- [ ] **Step 3: Implement `weatherMeta.ts`**

Create `web/lib/weatherMeta.ts`:

```ts
// Verbatim from common/config.py:WEATHER_LOCATIONS (expanded to these 12
// real Southern Vietnam locations during the Insights sub-project). No
// cross-language runtime check -- same convention as opsMeta.ts's
// PIPELINE_LAMBDAS.
export const WEATHER_LOCATION_NAMES: string[] = [
  "Tay Ninh",
  "Ho Chi Minh City",
  "Thu Dau Mot (Binh Duong)",
  "Long Xuyen (An Giang)",
  "Bien Hoa (Dong Nai)",
  "Can Tho",
  "My Tho (Tien Giang)",
  "Soc Trang",
  "Vung Tau",
  "Rach Gia (Kien Giang)",
  "Ca Mau",
  "Da Lat",
];

// The only client-influenced value that reaches SQL in this feature --
// MUST be validated with this before ever being interpolated into a
// query string. Same non-negotiable rule as every other user-influenced
// value elsewhere in this app.
export function isKnownWeatherLocation(value: string): boolean {
  return WEATHER_LOCATION_NAMES.includes(value);
}

// The map legend's real breakpoints: <22 cool, 22-30 moderate, >30 hot.
export const TEMP_BAND_THRESHOLDS_C = { cool: 22, hot: 30 };

export function temperatureBand(tempC: number): "cool" | "moderate" | "hot" {
  if (tempC < TEMP_BAND_THRESHOLDS_C.cool) return "cool";
  if (tempC <= TEMP_BAND_THRESHOLDS_C.hot) return "moderate";
  return "hot";
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run lib/weatherMeta.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Write the failing tests for `mapProjection.ts`**

Create `web/lib/mapProjection.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { projectLatLng, WEATHER_BOUNDS } from "./mapProjection";

const VIEW_BOX = { width: 600, height: 600 };
const PADDING = 40;

describe("projectLatLng", () => {
  it("places the northernmost+easternmost point (Da Lat) near the top-right corner", () => {
    const p = projectLatLng({ latitude: 11.9404, longitude: 108.4583 }, WEATHER_BOUNDS, VIEW_BOX, PADDING);
    expect(p.x).toBeCloseTo(560, 1);
    expect(p.y).toBeCloseTo(40, 1);
  });

  it("places the southernmost point (Ca Mau) near the bottom edge", () => {
    const p = projectLatLng({ latitude: 9.1769, longitude: 105.15 }, WEATHER_BOUNDS, VIEW_BOX, PADDING);
    expect(p.x).toBeCloseTo(50.64, 1);
    expect(p.y).toBeCloseTo(560, 1);
  });

  it("places the westernmost point (Rach Gia) near the left edge", () => {
    const p = projectLatLng({ latitude: 10.0124, longitude: 105.0809 }, WEATHER_BOUNDS, VIEW_BOX, PADDING);
    expect(p.x).toBeCloseTo(40, 1);
    expect(p.y).toBeCloseTo(402.79, 1);
  });

  it("places a midpoint location (Ho Chi Minh City) roughly centered", () => {
    const p = projectLatLng({ latitude: 10.7769, longitude: 106.7009 }, WEATHER_BOUNDS, VIEW_BOX, PADDING);
    expect(p.x).toBeCloseTo(289.45, 1);
    expect(p.y).toBeCloseTo(258.97, 1);
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `cd web && npx vitest run lib/mapProjection.test.ts`
Expected: FAIL -- module `./mapProjection` not found

- [ ] **Step 7: Implement `mapProjection.ts`**

Create `web/lib/mapProjection.ts`:

```ts
export type LatLng = { latitude: number; longitude: number };
export type LatLngBounds = { latMin: number; latMax: number; lonMin: number; lonMax: number };
export type ViewBox = { width: number; height: number };
export type Point = { x: number; y: number };

// Real min/max lat/lon across the 12 locations in
// common/config.py:WEATHER_LOCATIONS. latMin/lonMin: Ca Mau (9.1769) /
// Rach Gia (105.0809). latMax/lonMax: Da Lat (11.9404 / 108.4583) -- Da
// Lat happens to be both the northernmost and easternmost of the 12.
export const WEATHER_BOUNDS: LatLngBounds = {
  latMin: 9.1769,
  latMax: 11.9404,
  lonMin: 105.0809,
  lonMax: 108.4583,
};

// Linear (equirectangular) projection -- fine at this scale (a few
// hundred km across Southern Vietnam). y is inverted (latMax - lat)
// since SVG y grows downward while latitude grows northward.
export function projectLatLng(
  point: LatLng,
  bounds: LatLngBounds,
  viewBox: ViewBox,
  padding: number
): Point {
  const usableWidth = viewBox.width - padding * 2;
  const usableHeight = viewBox.height - padding * 2;
  const lonSpan = bounds.lonMax - bounds.lonMin;
  const latSpan = bounds.latMax - bounds.latMin;
  return {
    x: padding + ((point.longitude - bounds.lonMin) / lonSpan) * usableWidth,
    y: padding + ((bounds.latMax - point.latitude) / latSpan) * usableHeight,
  };
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd web && npx vitest run lib/mapProjection.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 9: Commit**

```bash
git add web/lib/weatherMeta.ts web/lib/weatherMeta.test.ts web/lib/mapProjection.ts web/lib/mapProjection.test.ts
git commit -m "Add Weather location whitelist, temp bands, and map projection"
```

---

### Task 3: API routes

**Files:**
- Modify: `web/lib/types.ts`
- Create: `web/app/api/weather/route.ts`
- Create: `web/app/api/weather/route.test.ts`
- Create: `web/app/api/weather/history/route.ts`
- Create: `web/app/api/weather/history/route.test.ts`

**Interfaces:**
- Consumes: `buildCurrentReadingsQuery`, `buildHistoryQuery` (Task 1);
  `isKnownWeatherLocation` (Task 2); `hoursAgoAsObservedAtLocal` (Task
  1); `getAthenaClient` (existing, `web/lib/aws.ts`); `runAthenaQuery`,
  `parseAthenaRows`, `todayUtcParts` (existing, `web/lib/athena.ts`);
  `lastNDaysUtcParts` (existing, `web/lib/dateRange.ts`).
- Produces: `WeatherLocation`, `WeatherResponse`, `WeatherHistoryPoint`,
  `WeatherHistoryResponse` types (`web/lib/types.ts`) -- Task 4 (the page)
  consumes these exact shapes. `GET /api/weather` returns
  `WeatherResponse`. `GET /api/weather/history?location=<name>` returns
  `WeatherHistoryResponse` or 400 `{ error: string }`.

- [ ] **Step 1: Add the new types**

Add to the end of `web/lib/types.ts`:

```ts
export type WeatherLocation = {
  location: string;
  latitude: number;
  longitude: number;
  temperatureC: number;
  humidityPct: number;
  precipitationMm: number;
  windSpeedKmh: number;
  observedAt: string;
};

export type WeatherResponse = { locations: WeatherLocation[] };

export type WeatherHistoryPoint = { hourBucket: string; avgTemperatureC: number };

export type WeatherHistoryResponse = { location: string; points: WeatherHistoryPoint[] };
```

- [ ] **Step 2: Write the failing tests for `/api/weather`**

Create `web/app/api/weather/route.test.ts`:

```ts
// web/app/api/weather/route.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/aws", () => ({ getAthenaClient: vi.fn(() => ({})) }));
vi.mock("@/lib/athena", async () => {
  const actual = await vi.importActual<typeof import("@/lib/athena")>("@/lib/athena");
  return { ...actual, runAthenaQuery: vi.fn() };
});

import { runAthenaQuery } from "@/lib/athena";
import { GET } from "./route";

const mockedRun = vi.mocked(runAthenaQuery);

function athenaRows(rows: string[][]) {
  return [
    { Data: [] }, // header row, skipped by parseAthenaRows
    ...rows.map((cols) => ({ Data: cols.map((v) => ({ VarCharValue: v })) })),
  ];
}

beforeEach(() => {
  mockedRun.mockReset();
});

describe("GET /api/weather", () => {
  it("returns the mapped, sorted list of current readings", async () => {
    mockedRun.mockResolvedValue(
      athenaRows([
        ["Tay Ninh", "11.31", "106.0989", "32", "60", "0", "10", "2026-09-20T18:00:00"],
        ["Da Lat", "11.9404", "108.4583", "19", "85", "1.2", "8", "2026-09-20T18:00:00"],
      ])
    );

    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.locations).toEqual([
      {
        location: "Tay Ninh",
        latitude: 11.31,
        longitude: 106.0989,
        temperatureC: 32,
        humidityPct: 60,
        precipitationMm: 0,
        windSpeedKmh: 10,
        observedAt: "2026-09-20T18:00:00",
      },
      {
        location: "Da Lat",
        latitude: 11.9404,
        longitude: 108.4583,
        temperatureC: 19,
        humidityPct: 85,
        precipitationMm: 1.2,
        windSpeedKmh: 8,
        observedAt: "2026-09-20T18:00:00",
      },
    ]);
  });

  it("returns 500 with a safe message when the query fails", async () => {
    mockedRun.mockRejectedValue(new Error("Athena query failed: boom"));
    const response = await GET();
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("Không tải được thời tiết, thử lại sau.");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd web && npx vitest run app/api/weather/route.test.ts`
Expected: FAIL -- module `./route` not found

- [ ] **Step 4: Implement `/api/weather`**

Create `web/app/api/weather/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getAthenaClient } from "@/lib/aws";
import { runAthenaQuery, parseAthenaRows } from "@/lib/athena";
import { lastNDaysUtcParts } from "@/lib/dateRange";
import { buildCurrentReadingsQuery } from "@/lib/weatherQueries";
import type { WeatherResponse } from "@/lib/types";

export const maxDuration = 60;

export async function GET() {
  try {
    const partsList = lastNDaysUtcParts(2);
    const rows = await runAthenaQuery(getAthenaClient(), buildCurrentReadingsQuery(partsList));

    const response: WeatherResponse = {
      locations: parseAthenaRows(rows, (cols) => ({
        location: cols[0] ?? "",
        latitude: Number(cols[1] ?? 0),
        longitude: Number(cols[2] ?? 0),
        temperatureC: Number(cols[3] ?? 0),
        humidityPct: Number(cols[4] ?? 0),
        precipitationMm: Number(cols[5] ?? 0),
        windSpeedKmh: Number(cols[6] ?? 0),
        observedAt: cols[7] ?? "",
      })),
    };

    return NextResponse.json(response, {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" },
    });
  } catch (error) {
    console.error("Weather API failed", error);
    return NextResponse.json({ error: "Không tải được thời tiết, thử lại sau." }, { status: 500 });
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd web && npx vitest run app/api/weather/route.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Write the failing tests for `/api/weather/history`**

Create `web/app/api/weather/history/route.test.ts`:

```ts
// web/app/api/weather/history/route.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/aws", () => ({ getAthenaClient: vi.fn(() => ({})) }));
vi.mock("@/lib/athena", async () => {
  const actual = await vi.importActual<typeof import("@/lib/athena")>("@/lib/athena");
  return { ...actual, runAthenaQuery: vi.fn() };
});

import { runAthenaQuery } from "@/lib/athena";
import { GET } from "./route";

const mockedRun = vi.mocked(runAthenaQuery);

function athenaRows(rows: string[][]) {
  return [{ Data: [] }, ...rows.map((cols) => ({ Data: cols.map((v) => ({ VarCharValue: v })) }))];
}

function requestFor(location: string | null) {
  const url = location === null ? "http://localhost/api/weather/history" : `http://localhost/api/weather/history?location=${encodeURIComponent(location)}`;
  return new NextRequest(url);
}

beforeEach(() => {
  mockedRun.mockReset();
});

describe("GET /api/weather/history", () => {
  it("returns the hourly-bucketed history for a known location", async () => {
    mockedRun.mockResolvedValue(
      athenaRows([
        ["2026-09-20 10:00:00.000", "18.5"],
        ["2026-09-20 11:00:00.000", "19.2"],
      ])
    );

    const response = await GET(requestFor("Da Lat"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      location: "Da Lat",
      points: [
        { hourBucket: "2026-09-20 10:00:00.000", avgTemperatureC: 18.5 },
        { hourBucket: "2026-09-20 11:00:00.000", avgTemperatureC: 19.2 },
      ],
    });
  });

  it("returns 400 without querying Athena for an unknown location", async () => {
    const response = await GET(requestFor("Hanoi"));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Không tìm thấy địa điểm.");
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("returns 400 without querying Athena when location is missing", async () => {
    const response = await GET(requestFor(null));
    expect(response.status).toBe(400);
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("returns 500 with a safe message when the query fails for a known location", async () => {
    mockedRun.mockRejectedValue(new Error("Athena query failed: boom"));
    const response = await GET(requestFor("Da Lat"));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("Không tải được thời tiết, thử lại sau.");
  });
});
```

- [ ] **Step 7: Run tests to verify they fail**

Run: `cd web && npx vitest run app/api/weather/history/route.test.ts`
Expected: FAIL -- module `./route` not found

- [ ] **Step 8: Implement `/api/weather/history`**

Create `web/app/api/weather/history/route.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";
import { getAthenaClient } from "@/lib/aws";
import { runAthenaQuery, parseAthenaRows } from "@/lib/athena";
import { lastNDaysUtcParts, hoursAgoAsObservedAtLocal } from "@/lib/dateRange";
import { buildHistoryQuery } from "@/lib/weatherQueries";
import { isKnownWeatherLocation } from "@/lib/weatherMeta";
import type { WeatherHistoryResponse } from "@/lib/types";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const location = request.nextUrl.searchParams.get("location");
  if (!location || !isKnownWeatherLocation(location)) {
    return NextResponse.json({ error: "Không tìm thấy địa điểm." }, { status: 400 });
  }

  try {
    const partsList = lastNDaysUtcParts(2);
    const cutoffLocalIso = hoursAgoAsObservedAtLocal(24);
    const rows = await runAthenaQuery(
      getAthenaClient(),
      buildHistoryQuery(location, partsList, cutoffLocalIso)
    );

    const response: WeatherHistoryResponse = {
      location,
      points: parseAthenaRows(rows, (cols) => ({
        hourBucket: cols[0] ?? "",
        avgTemperatureC: Number(cols[1] ?? 0),
      })),
    };

    return NextResponse.json(response, {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" },
    });
  } catch (error) {
    console.error("Weather history API failed", error);
    return NextResponse.json({ error: "Không tải được thời tiết, thử lại sau." }, { status: 500 });
  }
}
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `cd web && npx vitest run app/api/weather/history/route.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 10: Run the full suite to confirm nothing else broke**

Run: `cd web && npx vitest run`
Expected: PASS, all files including the new ones

- [ ] **Step 11: Commit**

```bash
git add web/lib/types.ts web/app/api/weather/route.ts web/app/api/weather/route.test.ts web/app/api/weather/history/route.ts web/app/api/weather/history/route.test.ts
git commit -m "Add GET /api/weather and /api/weather/history routes"
```

---

### Task 4: Weather page

**Files:**
- Create: `web/app/weather/page.tsx`
- Modify: `web/components/NavBar.tsx`

**Interfaces:**
- Consumes: `WeatherResponse`, `WeatherLocation`, `WeatherHistoryResponse`
  (Task 3); `projectLatLng`, `WEATHER_BOUNDS` (Task 2);
  `temperatureBand`, `TEMP_BAND_THRESHOLDS_C` (Task 2). Fetches
  `/api/weather` and `/api/weather/history?location=` (Task 3) at
  runtime.
- Produces: nothing (final page, no other task depends on it).

This task has no dedicated automated test (project convention: page
components aren't unit-tested, verified manually after deploy in Task 5).

- [ ] **Step 1: Implement the page**

Create `web/app/weather/page.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import type { WeatherLocation, WeatherResponse, WeatherHistoryResponse } from "@/lib/types";
import { projectLatLng, WEATHER_BOUNDS } from "@/lib/mapProjection";
import { temperatureBand } from "@/lib/weatherMeta";

const VIEW_BOX = { width: 600, height: 600 };
const PADDING = 40;
const DEFAULT_LOCATION = "Da Lat";

const BAND_COLOR: Record<"cool" | "moderate" | "hot", string> = {
  cool: "#38BDF8",
  moderate: "#FBBF24",
  hot: "#FB7185",
};

// Decorative land-shape background, reused verbatim from the mockup --
// not a geographically accurate coastline (no real Vietnam GeoJSON in
// this project). Only pin positions (via projectLatLng) are real.
const LAND_PATH =
  "M -20,-20 L 620,-20 L 620,220 C 540,250 490,300 460,360 C 430,420 460,460 420,520 C 380,580 300,610 200,615 L -20,615 Z";

function formatMinutesAgo(observedAt: string): string {
  // observedAt is naive Vietnam local time (UTC+7, no offset suffix) --
  // parsing it with a "Z" suffix gives an instant 7h ahead of its real
  // UTC instant, so shift that back out before diffing against the real
  // current time. Same convention as dateRange.ts's hoursAgoAsObservedAtLocal.
  const observedUtcMs = new Date(`${observedAt}Z`).getTime() - 7 * 60 * 60 * 1000;
  const minutes = Math.max(0, Math.round((Date.now() - observedUtcMs) / 60000));
  return `Cập nhật ${minutes} phút trước`;
}

export default function WeatherPage() {
  const [data, setData] = useState<WeatherResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>(DEFAULT_LOCATION);
  const [history, setHistory] = useState<WeatherHistoryResponse | null>(null);
  const latestSelectedRef = useRef<string>(DEFAULT_LOCATION);

  useEffect(() => {
    fetch("/api/weather")
      .then((res) => res.json().then((body) => ({ ok: res.ok, body })))
      .then(({ ok, body }) => {
        if (!ok) throw new Error(body.error ?? "Không tải được thời tiết.");
        setData(body);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Không tải được thời tiết."));
  }, []);

  useEffect(() => {
    latestSelectedRef.current = selected;
    fetch(`/api/weather/history?location=${encodeURIComponent(selected)}`)
      .then((res) => res.json().then((body) => ({ ok: res.ok, body })))
      .then(({ ok, body }) => {
        if (latestSelectedRef.current !== selected) return; // superseded by a newer selection
        if (!ok) return; // history is secondary -- don't blow up the whole page over it
        setHistory(body);
      })
      .catch(() => {
        /* history is secondary -- silently keep the last-good sparkline */
      });
  }, [selected]);

  if (error) {
    return (
      <div className="p-9 flex flex-col gap-4">
        <p className="text-error text-sm">{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-9 flex flex-col gap-4">
        <div className="h-[600px] rounded-2xl border border-border bg-surface animate-pulse" />
      </div>
    );
  }

  const selectedReading = data.locations.find((l) => l.location === selected) ?? data.locations[0];
  const ranked = [...data.locations].sort((a, b) => b.temperatureC - a.temperatureC);
  const mostRecentObservedAt = data.locations.reduce(
    (latest, l) => (l.observedAt > latest ? l.observedAt : latest),
    data.locations[0]?.observedAt ?? ""
  );

  const sparkPoints = history?.points ?? [];
  const temps = sparkPoints.map((p) => p.avgTemperatureC);
  const minTemp = temps.length ? Math.min(...temps) : 0;
  const maxTemp = temps.length ? Math.max(...temps) : 1;
  const tempRange = maxTemp - minTemp || 1;
  const sparkPolyline = sparkPoints
    .map((p, i) => {
      const x = sparkPoints.length > 1 ? (i / (sparkPoints.length - 1)) * 216 + 4 : 110;
      const y = 42 - ((p.avgTemperatureC - minTemp) / tempRange) * 36 + 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <div className="p-9 flex flex-col gap-4">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-textPrimary">Thời tiết miền Nam</h1>
          <p className="mt-1.5 text-sm text-textSecondary">
            12 tỉnh/thành · Open-Meteo, không cần API key · làm mới mỗi 10 phút
          </p>
        </div>
        {mostRecentObservedAt && (
          <span className="font-mono text-[11px] px-3 py-1.5 rounded-full bg-accent/10 text-accent">
            {formatMinutesAgo(mostRecentObservedAt)}
          </span>
        )}
      </div>

      <div className="flex gap-4 flex-grow min-h-0">
        <div className="flex-[1.55] rounded-2xl border border-border bg-surface p-5 flex flex-col gap-3 min-h-0">
          <div className="relative flex-grow rounded-xl bg-bg overflow-hidden">
            <svg viewBox={`0 0 ${VIEW_BOX.width} ${VIEW_BOX.height}`} className="w-full h-full block">
              <rect x="0" y="0" width={VIEW_BOX.width} height={VIEW_BOX.height} fill="#0A1730" />
              <path d={LAND_PATH} fill="#152238" />
              {ranked.map((loc) => {
                const p = projectLatLng(loc, WEATHER_BOUNDS, VIEW_BOX, PADDING);
                const band = temperatureBand(loc.temperatureC);
                const isSelected = loc.location === selected;
                return (
                  <g key={loc.location} onClick={() => setSelected(loc.location)} style={{ cursor: "pointer" }}>
                    {isSelected && <circle cx={p.x} cy={p.y} r={15} fill={BAND_COLOR[band]} fillOpacity={0.14} />}
                    <circle cx={p.x} cy={p.y} r={isSelected ? 7 : 5} fill={BAND_COLOR[band]} stroke="#0A1730" strokeWidth={1} />
                    {isSelected && (
                      <text x={p.x} y={p.y - 14} textAnchor="middle" fill="#F2F5FB" fontSize="12.5">
                        {loc.location} · {loc.temperatureC.toFixed(0)}°C
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
            {/* Decorative chrome only, matching the mockup -- no pan/zoom logic (see plan's Global Constraints) */}
            <div className="absolute top-3.5 right-3.5 w-[30px] h-[30px] rounded-lg bg-surface border border-border flex items-center justify-center">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#93A0C2" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </div>
            <div className="absolute bottom-3.5 right-3.5 flex flex-col rounded-lg overflow-hidden border border-border">
              <span className="w-[30px] h-[28px] bg-surface text-textSecondary flex items-center justify-center text-base border-b border-border">+</span>
              <span className="w-[30px] h-[28px] bg-surface text-textSecondary flex items-center justify-center text-base">−</span>
            </div>
            <div className="absolute left-4 bottom-3.5 flex items-center gap-2">
              <div className="w-[34px] h-[2px] bg-textMuted" />
              <span className="font-mono text-[10px] text-textMuted">~80 km</span>
            </div>
          </div>
          <div className="flex items-center gap-4 px-0.5">
            <span className="flex items-center gap-1.5 text-[11.5px] text-textSecondary">
              <span className="w-2 h-2 rounded-full inline-block" style={{ background: BAND_COLOR.cool }} />
              Mát (&lt;22°C)
            </span>
            <span className="flex items-center gap-1.5 text-[11.5px] text-textSecondary">
              <span className="w-2 h-2 rounded-full inline-block" style={{ background: BAND_COLOR.moderate }} />
              Vừa (22–30°C)
            </span>
            <span className="flex items-center gap-1.5 text-[11.5px] text-textSecondary">
              <span className="w-2 h-2 rounded-full inline-block" style={{ background: BAND_COLOR.hot }} />
              Nóng (&gt;30°C)
            </span>
          </div>
        </div>

        <div className="flex-1 flex flex-col gap-4 min-h-0">
          {selectedReading && (
            <div className="rounded-2xl border border-border bg-surface px-5 py-5 flex flex-col gap-3.5">
              <div className="flex justify-between items-baseline">
                <span className="text-sm font-semibold text-textPrimary">{selectedReading.location}</span>
                <span className="font-mono text-2xl text-accent">{selectedReading.temperatureC.toFixed(0)}°C</span>
              </div>
              <div className="grid grid-cols-3 gap-2.5">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10.5px] text-textMuted">Độ ẩm</span>
                  <span className="font-mono text-[13px] text-textSecondary">{selectedReading.humidityPct.toFixed(0)}%</span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10.5px] text-textMuted">Mưa</span>
                  <span className="font-mono text-[13px] text-textSecondary">{selectedReading.precipitationMm.toFixed(1)} mm</span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10.5px] text-textMuted">Gió</span>
                  <span className="font-mono text-[13px] text-textSecondary">{selectedReading.windSpeedKmh.toFixed(0)} km/h</span>
                </div>
              </div>
              <div>
                <span className="text-[10.5px] text-textMuted">24 giờ qua</span>
                {sparkPoints.length >= 2 ? (
                  <svg viewBox="0 0 220 46" className="w-full h-[46px] block mt-1">
                    <polyline points={sparkPolyline} fill="none" stroke="#38BDF8" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  <p className="text-[11px] text-textMuted mt-1">Chưa đủ dữ liệu</p>
                )}
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-border bg-surface px-5 py-4 flex flex-col gap-1 flex-grow min-h-0 overflow-auto">
            <span className="text-xs font-semibold text-textPrimary mb-1.5">12 tỉnh/thành · xếp theo nhiệt độ</span>
            {ranked.map((loc) => {
              const isSelected = loc.location === selected;
              return (
                <button
                  key={loc.location}
                  onClick={() => setSelected(loc.location)}
                  className={`flex items-center gap-2.5 px-1.5 py-1.5 rounded-lg text-left ${
                    isSelected ? "bg-accent/10 border border-accent/40" : ""
                  }`}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                    style={{ background: BAND_COLOR[temperatureBand(loc.temperatureC)] }}
                  />
                  <span className={`flex-grow text-xs ${isSelected ? "text-textPrimary font-semibold" : "text-textSecondary"}`}>
                    {loc.location}
                  </span>
                  <span className={`font-mono text-xs ${isSelected ? "text-accent" : "text-textPrimary"}`}>
                    {loc.temperatureC.toFixed(0)}°C
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add the NavBar entry**

In `web/components/NavBar.tsx`, add after the `/cicd` entry:

```ts
  { href: "/weather", label: "Thời tiết" },
```

- [ ] **Step 3: Run the full test suite and typecheck**

Run: `cd web && npx vitest run && npx tsc --noEmit`
Expected: all tests PASS, tsc clean (no output)

- [ ] **Step 4: Commit**

```bash
git add web/app/weather/page.tsx web/components/NavBar.tsx
git commit -m "Add /weather page: real map, ranked list, detail + sparkline"
```

---

### Task 5: Deploy and live-verify

**Files:** none (no code changes -- this task pushes and verifies).

**Interfaces:**
- Consumes: nothing new (no new credential -- this feature reuses the
  existing web-app IAM user's Athena/Glue access, already sufficient for
  `weather_observations` per `infra/README.md`'s existing
  `GlueReadCuratedDatabase`/`AthenaQuery` statements -- no IAM change
  needed).
- Produces: nothing (final task).

- [ ] **Step 1: Push and wait for the deploy gate**

```bash
git push origin main
```

Wait for the GitHub Actions "Deploy" workflow. This push is web-app-code
only (no `.tf` changes), so `Terraform Plan` should show no
infrastructure changes; `apply` will still wait on the `environment:
production` approval gate as usual. Report the run URL and wait for
approval before proceeding.

- [ ] **Step 2: Live-verify**

```bash
curl -s https://realtime-data-pipeline.vercel.app/api/weather | python3 -m json.tool
curl -s -o /dev/null -w "%{http_code}\n" https://realtime-data-pipeline.vercel.app/weather
```

Confirm: `/api/weather` returns all 12 real locations with plausible
temperatures (Da Lat noticeably cooler than the other 11); pick one
non-default location's real name from that response and confirm:

```bash
curl -s "https://realtime-data-pipeline.vercel.app/api/weather/history?location=<name>" | python3 -m json.tool
curl -s -o /dev/null -w "%{http_code}\n" "https://realtime-data-pipeline.vercel.app/api/weather/history?location=Hanoi"
```

The last command (an unrecognized location) must return `400`. Confirm
`/weather` itself returns `200`.
