# Insights Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real `/insights` page to `web/` — a 2x2 grid of trending-correlation cards (top keywords, crypto mentions↔price, GitHub↔HN overlap, weather snapshot) with a Hôm nay/7 ngày toggle — and expand real weather ingestion from 4 to 12 Southern Vietnam locations first, so real data has time to accumulate.

**Architecture:** Task 1 is a standalone real infra change (Lambda config) pushed and deployed immediately, ahead of the rest, so ingestion cycles accrue real data for the new locations while Tasks 2-6 (pure web app code) are built and reviewed. All 4 Insights queries are fixed and server-run (no user SQL, no new security surface) — same trust model as the existing Dashboard page.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Python 3.12 (ingestion), Vitest, pytest, Terraform.

**Spec:** `docs/superpowers/specs/2026-09-20-insights-page-design.md`

## Global Constraints

- TypeScript strict mode must not be weakened.
- No new environment variables.
- No new IAM grants — existing Athena/Glue/S3 read statements already cover arbitrary read-only `SELECT`s (including window functions, `UNNEST`, `POSITION`) against the 5 curated tables, verified in the Explorer sub-project's final review.
- Design tokens from `web/tailwind.config.ts` only — never raw hex.
- Vietnamese UI copy exactly as specified in each task.
- No component tests (project convention) — `lib`/`route` unit tests plus a manual live-verification checklist in the final task.
- `common/config.py`'s `WEATHER_LOCATIONS` coordinates must be exactly the 12 values in the spec's table — do not invent different ones.
- Never fabricate a query result field — every card's data comes from a real Athena query against real columns (cross-check every table/column name in `infra/glue.tf` during review, same standard as Catalog/Explorer).

---

### Task 1: Expand real weather coverage to 12 Southern Vietnam locations (deploy first, standalone)

**Files:**
- Modify: `common/config.py`

**Interfaces:**
- Consumes: nothing.
- Produces: 12-entry `WEATHER_LOCATIONS` list consumed by `ingestion/weather_ingestion.py` (unmodified) — real ingested rows consumed by Task 6's live verification and by `buildWeatherSnapshotQuery` (Task 4).

This task is pushed and deployed **immediately after this single step**, separately from every other task in this plan, so ingestion cycles (every 10 minutes) accumulate real data for the 8 new locations while Tasks 2-6 are built. Do not batch this with later commits.

- [ ] **Step 1: Edit `WEATHER_LOCATIONS` in `common/config.py`**

Replace the existing 4-entry list with exactly these 12 (keep the existing comment above it):

```python
WEATHER_LOCATIONS = [
    {"name": "Tay Ninh", "latitude": 11.3100, "longitude": 106.0989},
    {"name": "Ho Chi Minh City", "latitude": 10.7769, "longitude": 106.7009},
    {"name": "Thu Dau Mot (Binh Duong)", "latitude": 10.9804, "longitude": 106.6519},
    {"name": "Long Xuyen (An Giang)", "latitude": 10.3860, "longitude": 105.4351},
    {"name": "Bien Hoa (Dong Nai)", "latitude": 10.9574, "longitude": 106.8426},
    {"name": "Can Tho", "latitude": 10.0452, "longitude": 105.7469},
    {"name": "My Tho (Tien Giang)", "latitude": 10.3600, "longitude": 106.3600},
    {"name": "Soc Trang", "latitude": 9.6003, "longitude": 105.9800},
    {"name": "Vung Tau", "latitude": 10.4114, "longitude": 107.1362},
    {"name": "Rach Gia (Kien Giang)", "latitude": 10.0124, "longitude": 105.0809},
    {"name": "Ca Mau", "latitude": 9.1769, "longitude": 105.1500},
    {"name": "Da Lat", "latitude": 11.9404, "longitude": 108.4583},
]
```

- [ ] **Step 2: Run the Python test suite**

Run: `cd /home/thanh/project/1 && pytest -q`
Expected: all tests pass unchanged — `tests/test_weather_ingestion.py` builds its own per-location dicts inline and never reads `WEATHER_LOCATIONS`, so nothing here should break. If anything fails, stop and report rather than guessing why.

- [ ] **Step 3: Commit**

```bash
git add common/config.py
git commit -m "$(cat <<'EOF'
Expand weather ingestion from 4 to 12 Southern Vietnam locations

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Push and wait for the deploy gate**

```bash
git push
```

CI's `deploy.yml` runs `./scripts/build_lambdas.sh` itself before `terraform plan`/`apply` — the changed `common/config.py` source hash triggers a redeploy of just the weather ingestion Lambda, no manual local build step needed. Tell the user the Deploy run is waiting on the production approval gate (same as every prior deploy this session) and wait for their approval before proceeding to Task 2. Poll GitHub Actions until the run shows `completed success`.

- [ ] **Step 5: Note the time**

Record (in your own working notes, not a file) the approximate UTC time this deploy completed — Task 6's live-verification checklist expects several 10-minute ingestion cycles to have elapsed by the time it runs, and Tasks 2-5's build-and-review work naturally provides that gap.

---

### Task 2: `web/lib/dateRange.ts` — multi-day partition helper

**Files:**
- Create: `web/lib/dateRange.ts`
- Test: `web/lib/dateRange.test.ts`

**Interfaces:**
- Consumes: `todayUtcParts`, `TodayParts` from `web/lib/athena.ts` (both already exported, unchanged).
- Produces: `lastNDaysUtcParts(n: number, now?: Date): TodayParts[]` — consumed by Task 5's route handler.

- [ ] **Step 1: Write the failing test**

```typescript
// web/lib/dateRange.test.ts
import { describe, expect, it } from "vitest";
import { lastNDaysUtcParts } from "./dateRange";

describe("lastNDaysUtcParts", () => {
  it("returns exactly today when n=1", () => {
    const now = new Date("2026-09-20T12:00:00Z");
    expect(lastNDaysUtcParts(1, now)).toEqual([{ year: "2026", month: "09", day: "20" }]);
  });

  it("returns 7 consecutive days ending today, most recent first", () => {
    const now = new Date("2026-09-20T12:00:00Z");
    expect(lastNDaysUtcParts(7, now)).toEqual([
      { year: "2026", month: "09", day: "20" },
      { year: "2026", month: "09", day: "19" },
      { year: "2026", month: "09", day: "18" },
      { year: "2026", month: "09", day: "17" },
      { year: "2026", month: "09", day: "16" },
      { year: "2026", month: "09", day: "15" },
      { year: "2026", month: "09", day: "14" },
    ]);
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run lib/dateRange.test.ts`
Expected: FAIL with "Cannot find module './dateRange'"

- [ ] **Step 3: Write `web/lib/dateRange.ts`**

```typescript
import { todayUtcParts, type TodayParts } from "./athena";

export function lastNDaysUtcParts(n: number, now: Date = new Date()): TodayParts[] {
  const parts: TodayParts[] = [];
  for (let i = 0; i < n; i++) {
    parts.push(todayUtcParts(new Date(now.getTime() - i * 24 * 60 * 60 * 1000)));
  }
  return parts;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run lib/dateRange.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Run full type check**

Run: `cd web && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add web/lib/dateRange.ts web/lib/dateRange.test.ts
git commit -m "$(cat <<'EOF'
Add lastNDaysUtcParts() for the Insights 7-day range toggle

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `partitionPredicateAny` in `web/lib/athena.ts`

**Files:**
- Modify: `web/lib/athena.ts`
- Modify: `web/lib/athena.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `export function partitionPredicateAny(partsList: TodayParts[], alias?: string): string` — consumed by Task 4's `insightsQueries.ts`.

- [ ] **Step 1: Write the failing tests (append to the existing file)**

Add to `web/lib/athena.test.ts` (keep every existing `describe` block unchanged), and add `partitionPredicateAny` to the file's existing `import { ... } from "./athena"` line:

```typescript
describe("partitionPredicateAny", () => {
  it("builds a single-day predicate with no alias", () => {
    expect(partitionPredicateAny([{ year: "2026", month: "09", day: "20" }])).toBe(
      "(year='2026' AND month='09' AND day='20')"
    );
  });

  it("joins multiple days with OR", () => {
    const result = partitionPredicateAny([
      { year: "2026", month: "09", day: "20" },
      { year: "2026", month: "09", day: "19" },
    ]);
    expect(result).toBe("(year='2026' AND month='09' AND day='20') OR (year='2026' AND month='09' AND day='19')");
  });

  it("prefixes each column with the given alias", () => {
    const result = partitionPredicateAny([{ year: "2026", month: "09", day: "20" }], "c");
    expect(result).toBe("(c.year='2026' AND c.month='09' AND c.day='20')");
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `cd web && npx vitest run lib/athena.test.ts`
Expected: existing tests still PASS; the 3 new tests FAIL (`partitionPredicateAny` not exported yet)

- [ ] **Step 3: Add `partitionPredicateAny` to `web/lib/athena.ts`**

Add this new exported function anywhere below the existing (already-exported) `partitionWhere` function — do not modify `partitionWhere` itself, do not touch any other existing code in the file:

```typescript
export function partitionPredicateAny(partsList: TodayParts[], alias?: string): string {
  const prefix = alias ? `${alias}.` : "";
  return partsList
    .map(
      ({ year, month, day }) =>
        `(${prefix}year='${year}' AND ${prefix}month='${month}' AND ${prefix}day='${day}')`
    )
    .join(" OR ");
}
```

- [ ] **Step 4: Run tests to verify everything passes**

Run: `cd web && npx vitest run lib/athena.test.ts`
Expected: PASS — all pre-existing tests plus the 3 new ones.

- [ ] **Step 5: Run the dashboard and explorer routes' tests too (they depend on this file)**

Run: `cd web && npx vitest run app/api/dashboard/route.test.ts app/api/explorer/query/route.test.ts app/api/explorer/samples/route.test.ts`
Expected: PASS, unchanged — proves this addition didn't alter any existing exported behavior.

- [ ] **Step 6: Run full type check**

Run: `cd web && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add web/lib/athena.ts web/lib/athena.test.ts
git commit -m "$(cat <<'EOF'
Add partitionPredicateAny() for multi-day partition-pruned queries

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `web/lib/insightsQueries.ts` — the 4 real card queries

**Files:**
- Create: `web/lib/insightsQueries.ts`
- Modify: `web/lib/types.ts`
- Test: `web/lib/insightsQueries.test.ts`

**Interfaces:**
- Consumes: `partitionPredicateAny`, `TodayParts` from `web/lib/athena.ts` (Task 3).
- Produces: `TopKeyword`, `CryptoMention`, `GithubHnOverlap`, `WeatherSnapshot`, `InsightsResponse` types in `web/lib/types.ts`; `buildTopKeywordsQuery(partsList)`, `buildCryptoMentionsQuery(partsList)`, `buildGithubHnOverlapQuery(partsList)`, `buildWeatherSnapshotQuery(parts)` — all consumed by Task 5's route handler.

- [ ] **Step 1: Write the failing test**

```typescript
// web/lib/insightsQueries.test.ts
import { describe, expect, it } from "vitest";
import {
  buildTopKeywordsQuery,
  buildCryptoMentionsQuery,
  buildGithubHnOverlapQuery,
  buildWeatherSnapshotQuery,
} from "./insightsQueries";

const PARTS_TODAY = [{ year: "2026", month: "09", day: "20" }];
const PARTS_7D = [
  { year: "2026", month: "09", day: "20" },
  { year: "2026", month: "09", day: "19" },
];

describe("buildTopKeywordsQuery", () => {
  it("references both hackernews_stories and news_articles, capped at 6", () => {
    const sql = buildTopKeywordsQuery(PARTS_TODAY);
    expect(sql).toContain("hackernews_stories");
    expect(sql).toContain("news_articles");
    expect(sql).toContain("LIMIT 6");
  });

  it("references every day in a multi-day range", () => {
    const sql = buildTopKeywordsQuery(PARTS_7D);
    expect(sql).toContain("day='20'");
    expect(sql).toContain("day='19'");
  });
});

describe("buildCryptoMentionsQuery", () => {
  it("uses a window function to pick the latest row per coin, not a fictional mentions table", () => {
    const sql = buildCryptoMentionsQuery(PARTS_TODAY);
    expect(sql).toContain("ROW_NUMBER() OVER (PARTITION BY c.coin_id ORDER BY c.observed_at DESC)");
    expect(sql).toContain("POSITION(c.coin_id IN m.keywords)");
    expect(sql.toLowerCase()).not.toContain("join mentions");
  });
});

describe("buildGithubHnOverlapQuery", () => {
  it("groups by keyword with a distinct-repo count", () => {
    const sql = buildGithubHnOverlapQuery(PARTS_TODAY);
    expect(sql).toContain("COUNT(DISTINCT g.full_name) AS overlap_count");
    expect(sql).toContain("GROUP BY gk");
  });
});

describe("buildWeatherSnapshotQuery", () => {
  it("takes a single TodayParts and ranks by latest observed_at per location", () => {
    const sql = buildWeatherSnapshotQuery(PARTS_TODAY[0]);
    expect(sql).toContain("ROW_NUMBER() OVER (PARTITION BY location ORDER BY observed_at DESC)");
    expect(sql).toContain("day='20'");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run lib/insightsQueries.test.ts`
Expected: FAIL with "Cannot find module './insightsQueries'"

- [ ] **Step 3: Add types to `web/lib/types.ts`**

Append (do not modify existing types):

```typescript
export type TopKeyword = { keyword: string; mentions: number };
export type CryptoMention = { coinId: string; priceUsd: number; change24hPct: number; mentionCount: number };
export type GithubHnOverlap = { keyword: string; overlapCount: number };
export type WeatherSnapshot = { location: string; temperatureC: number; humidityPct: number };

export type InsightsResponse = {
  range: "today" | "7d";
  topKeywords: TopKeyword[];
  cryptoMentions: CryptoMention[];
  githubHnOverlap: GithubHnOverlap[];
  weatherSnapshot: WeatherSnapshot[];
};
```

- [ ] **Step 4: Write `web/lib/insightsQueries.ts`**

```typescript
import { partitionPredicateAny, type TodayParts } from "./athena";

export function buildTopKeywordsQuery(partsList: TodayParts[]): string {
  const hnWhere = partitionPredicateAny(partsList);
  const newsWhere = partitionPredicateAny(partsList);
  return `SELECT k AS keyword, COUNT(*) AS mentions
FROM (
  SELECT keywords FROM hackernews_stories WHERE ${hnWhere}
  UNION ALL
  SELECT keywords FROM news_articles WHERE ${newsWhere}
) combined
CROSS JOIN UNNEST(split(keywords, ',')) AS t(k)
WHERE k <> ''
GROUP BY k
ORDER BY mentions DESC
LIMIT 6`;
}

export function buildCryptoMentionsQuery(partsList: TodayParts[]): string {
  const cryptoWhere = partitionPredicateAny(partsList, "c");
  const hnWhere = partitionPredicateAny(partsList);
  const newsWhere = partitionPredicateAny(partsList);
  return `SELECT coin_id, price_usd, change_24h_pct, mention_count
FROM (
  SELECT
    c.coin_id, c.price_usd, c.change_24h_pct,
    ROW_NUMBER() OVER (PARTITION BY c.coin_id ORDER BY c.observed_at DESC) AS rn,
    (SELECT COUNT(*) FROM (
       SELECT keywords FROM hackernews_stories WHERE ${hnWhere}
       UNION ALL
       SELECT keywords FROM news_articles WHERE ${newsWhere}
     ) m WHERE POSITION(c.coin_id IN m.keywords) > 0) AS mention_count
  FROM crypto_prices c
  WHERE ${cryptoWhere}
) ranked
WHERE rn = 1
ORDER BY coin_id`;
}

export function buildGithubHnOverlapQuery(partsList: TodayParts[]): string {
  const githubWhere = partitionPredicateAny(partsList, "g");
  const hnWhere = partitionPredicateAny(partsList, "h");
  return `SELECT gk AS keyword, COUNT(DISTINCT g.full_name) AS overlap_count
FROM github_repos g
CROSS JOIN UNNEST(split(g.keywords, ',')) AS t(gk)
JOIN hackernews_stories h
  ON gk <> '' AND POSITION(gk IN h.keywords) > 0
WHERE (${githubWhere})
  AND (${hnWhere})
GROUP BY gk
ORDER BY overlap_count DESC
LIMIT 6`;
}

export function buildWeatherSnapshotQuery(parts: TodayParts): string {
  const where = partitionPredicateAny([parts]);
  return `SELECT location, temperature_c, humidity_pct
FROM (
  SELECT location, temperature_c, humidity_pct,
         ROW_NUMBER() OVER (PARTITION BY location ORDER BY observed_at DESC) AS rn
  FROM weather_observations
  WHERE ${where}
) ranked
WHERE rn = 1
ORDER BY location`;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd web && npx vitest run lib/insightsQueries.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 6: Run full type check**

Run: `cd web && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add web/lib/insightsQueries.ts web/lib/insightsQueries.test.ts web/lib/types.ts
git commit -m "$(cat <<'EOF'
Add 4 real Insights card queries (keywords, crypto, overlap, weather)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `GET /api/insights` route

**Files:**
- Create: `web/app/api/insights/route.ts`
- Test: `web/app/api/insights/route.test.ts`

**Interfaces:**
- Consumes: `lastNDaysUtcParts` (Task 2), the 4 query builders (Task 4), `getAthenaClient` from `web/lib/aws.ts`, `runAthenaQuery`/`parseAthenaRows`/`todayUtcParts` from `web/lib/athena.ts`.
- Produces: `GET(request): Promise<NextResponse>` returning `InsightsResponse` — consumed by Task 6's `page.tsx`.

- [ ] **Step 1: Write the failing test**

```typescript
// web/app/api/insights/route.test.ts
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

function makeRequest(url: string): NextRequest {
  return new NextRequest(url);
}

function rows(header: string[], data: string[][]) {
  return [
    { Data: header.map((h) => ({ VarCharValue: h })) },
    ...data.map((row) => ({ Data: row.map((v) => ({ VarCharValue: v })) })),
  ];
}

beforeEach(() => {
  mockedRun.mockReset();
});

describe("GET /api/insights", () => {
  it("defaults to range=today and returns all 4 sections", async () => {
    mockedRun
      .mockResolvedValueOnce(rows(["keyword", "mentions"], [["agent", "41"]]))
      .mockResolvedValueOnce(
        rows(["coin_id", "price_usd", "change_24h_pct", "mention_count"], [["bitcoin", "81314.2", "2.4", "18"]])
      )
      .mockResolvedValueOnce(rows(["keyword", "overlap_count"], [["agent", "7"]]))
      .mockResolvedValueOnce(rows(["location", "temperature_c", "humidity_pct"], [["Ho Chi Minh City", "31", "68"]]));

    const response = await GET(makeRequest("http://localhost/api/insights"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.range).toBe("today");
    expect(body.topKeywords).toEqual([{ keyword: "agent", mentions: 41 }]);
    expect(body.cryptoMentions).toEqual([
      { coinId: "bitcoin", priceUsd: 81314.2, change24hPct: 2.4, mentionCount: 18 },
    ]);
    expect(body.githubHnOverlap).toEqual([{ keyword: "agent", overlapCount: 7 }]);
    expect(body.weatherSnapshot).toEqual([{ location: "Ho Chi Minh City", temperatureC: 31, humidityPct: 68 }]);
  });

  it("accepts range=7d", async () => {
    mockedRun
      .mockResolvedValueOnce(rows(["keyword", "mentions"], []))
      .mockResolvedValueOnce(rows(["coin_id", "price_usd", "change_24h_pct", "mention_count"], []))
      .mockResolvedValueOnce(rows(["keyword", "overlap_count"], []))
      .mockResolvedValueOnce(rows(["location", "temperature_c", "humidity_pct"], []));

    const response = await GET(makeRequest("http://localhost/api/insights?range=7d"));
    const body = await response.json();
    expect(body.range).toBe("7d");
  });

  it("falls back to today for an invalid range value", async () => {
    mockedRun
      .mockResolvedValueOnce(rows(["keyword", "mentions"], []))
      .mockResolvedValueOnce(rows(["coin_id", "price_usd", "change_24h_pct", "mention_count"], []))
      .mockResolvedValueOnce(rows(["keyword", "overlap_count"], []))
      .mockResolvedValueOnce(rows(["location", "temperature_c", "humidity_pct"], []));

    const response = await GET(makeRequest("http://localhost/api/insights?range=bogus"));
    const body = await response.json();
    expect(body.range).toBe("today");
  });

  it("returns 500 with a safe message when Athena fails", async () => {
    mockedRun.mockRejectedValueOnce(new Error("Athena query failed: table not found"));
    const response = await GET(makeRequest("http://localhost/api/insights"));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("Không tải được Insights, thử lại sau.");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run app/api/insights/route.test.ts`
Expected: FAIL with "Cannot find module './route'"

- [ ] **Step 3: Write `web/app/api/insights/route.ts`**

```typescript
import { NextResponse, type NextRequest } from "next/server";
import { getAthenaClient } from "@/lib/aws";
import { runAthenaQuery, parseAthenaRows, todayUtcParts } from "@/lib/athena";
import { lastNDaysUtcParts } from "@/lib/dateRange";
import {
  buildTopKeywordsQuery,
  buildCryptoMentionsQuery,
  buildGithubHnOverlapQuery,
  buildWeatherSnapshotQuery,
} from "@/lib/insightsQueries";
import type { InsightsResponse } from "@/lib/types";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  try {
    const rangeParam = request.nextUrl.searchParams.get("range");
    const range = rangeParam === "7d" ? "7d" : "today";
    const partsList = lastNDaysUtcParts(range === "7d" ? 7 : 1);
    const athena = getAthenaClient();

    const [keywordRows, cryptoRows, overlapRows, weatherRows] = await Promise.all([
      runAthenaQuery(athena, buildTopKeywordsQuery(partsList)),
      runAthenaQuery(athena, buildCryptoMentionsQuery(partsList)),
      runAthenaQuery(athena, buildGithubHnOverlapQuery(partsList)),
      runAthenaQuery(athena, buildWeatherSnapshotQuery(todayUtcParts())),
    ]);

    const response: InsightsResponse = {
      range,
      topKeywords: parseAthenaRows(keywordRows, (cols) => ({
        keyword: cols[0] ?? "",
        mentions: Number(cols[1] ?? 0),
      })),
      cryptoMentions: parseAthenaRows(cryptoRows, (cols) => ({
        coinId: cols[0] ?? "",
        priceUsd: Number(cols[1] ?? 0),
        change24hPct: Number(cols[2] ?? 0),
        mentionCount: Number(cols[3] ?? 0),
      })),
      githubHnOverlap: parseAthenaRows(overlapRows, (cols) => ({
        keyword: cols[0] ?? "",
        overlapCount: Number(cols[1] ?? 0),
      })),
      weatherSnapshot: parseAthenaRows(weatherRows, (cols) => ({
        location: cols[0] ?? "",
        temperatureC: Number(cols[1] ?? 0),
        humidityPct: Number(cols[2] ?? 0),
      })),
    };

    return NextResponse.json(response, {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" },
    });
  } catch (error) {
    console.error("Insights API failed", error);
    return NextResponse.json({ error: "Không tải được Insights, thử lại sau." }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run app/api/insights/route.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Run full type check**

Run: `cd web && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add web/app/api/insights/route.ts web/app/api/insights/route.test.ts
git commit -m "$(cat <<'EOF'
Add GET /api/insights running the 4 card queries in parallel

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `/insights` page UI + deploy + live verification

**Files:**
- Create: `web/app/insights/page.tsx`
- Modify: `web/components/NavBar.tsx`

**Interfaces:**
- Consumes: `InsightsResponse` type from `web/lib/types.ts`; `GET /api/insights` response shape from Task 5.
- Produces: nothing (final task).

- [ ] **Step 1: Add the nav link**

In `web/components/NavBar.tsx`, extend `LINKS` (currently 4 entries after the Explorer sub-project) to add a 5th:

```typescript
const LINKS = [
  { href: "/", label: "Tổng quan" },
  { href: "/assistant", label: "RAG Assistant" },
  { href: "/catalog", label: "Data Catalog" },
  { href: "/explorer", label: "Data Explorer" },
  { href: "/insights", label: "Insights" },
];
```

- [ ] **Step 2: Write `web/app/insights/page.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import type { InsightsResponse } from "@/lib/types";

type Range = "today" | "7d";

export default function InsightsPage() {
  const [range, setRange] = useState<Range>("today");
  const [data, setData] = useState<InsightsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load(r: Range) {
    setError(null);
    try {
      const res = await fetch(`/api/insights?range=${r}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Không tải được Insights.");
      setData(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tải được Insights.");
    }
  }

  useEffect(() => {
    load(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  if (error) {
    return (
      <div className="p-9 flex flex-col gap-4">
        <p className="text-error text-sm">{error}</p>
        <button
          onClick={() => load(range)}
          className="w-fit rounded-lg border border-border px-4 py-2 text-sm text-textPrimary"
        >
          Thử lại
        </button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-9 grid grid-cols-2 grid-rows-2 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-64 rounded-2xl border border-border bg-surface animate-pulse" />
        ))}
      </div>
    );
  }

  const maxMentions = Math.max(1, ...data.topKeywords.map((k) => k.mentions));
  const maxOverlap = Math.max(1, ...data.githubHnOverlap.map((o) => o.overlapCount));

  return (
    <div className="p-9 flex flex-col gap-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-textPrimary">Trending Insights</h1>
          <p className="mt-1.5 text-sm text-textSecondary">Tương quan chéo giữa 5 nguồn · cập nhật mỗi 10 phút</p>
        </div>
        <div className="flex gap-1.5">
          <button
            onClick={() => setRange("today")}
            className={`font-mono text-xs px-3 py-1.5 rounded-full border ${
              range === "today" ? "bg-accent/10 border-accent text-accent" : "border-transparent text-textMuted"
            }`}
          >
            Hôm nay
          </button>
          <button
            onClick={() => setRange("7d")}
            className={`font-mono text-xs px-3 py-1.5 rounded-full border ${
              range === "7d" ? "bg-accent/10 border-accent text-accent" : "border-transparent text-textMuted"
            }`}
          >
            7 ngày
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 grid-rows-2 gap-4 flex-grow min-h-0">
        <div className="rounded-2xl border border-border bg-surface px-5 py-5 flex flex-col gap-3 min-h-0">
          <span className="text-[13px] font-semibold text-textPrimary">Từ khoá nổi bật (HN + News)</span>
          <div className="flex flex-col gap-2.5">
            {data.topKeywords.map((k, i) => (
              <div key={k.keyword} className="flex items-center gap-2.5">
                <span className="w-16 text-[11.5px] text-textSecondary">{k.keyword}</span>
                <div className="flex-grow h-2 rounded bg-border">
                  <div
                    className={`h-full rounded ${i === 0 ? "bg-accent" : "bg-textMuted"}`}
                    style={{ width: `${(k.mentions / maxMentions) * 100}%` }}
                  />
                </div>
                <span className="font-mono text-[11px] text-textMuted">{k.mentions}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-surface px-5 py-5 flex flex-col gap-3 min-h-0">
          <span className="text-[13px] font-semibold text-textPrimary">Crypto: mentions ↔ biến động giá</span>
          <div className="flex flex-col gap-3">
            {data.cryptoMentions.map((c) => (
              <div key={c.coinId} className="flex items-center justify-between">
                <span className="text-xs text-textSecondary">{c.coinId}</span>
                <span className="font-mono text-[11px] text-textMuted">{c.mentionCount} mentions</span>
                <span className={`font-mono text-xs ${c.change24hPct >= 0 ? "text-success" : "text-error"}`}>
                  {c.change24hPct >= 0 ? "+" : ""}
                  {c.change24hPct.toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-surface px-5 py-5 flex flex-col gap-3 min-h-0">
          <span className="text-[13px] font-semibold text-textPrimary">GitHub Trending ↔ HN overlap</span>
          <div className="flex flex-col gap-2.5">
            {data.githubHnOverlap.map((o) => (
              <div key={o.keyword} className="flex items-center gap-2">
                <span className="font-mono w-5 text-[11px] text-textMuted text-right">{o.overlapCount}</span>
                <div className="flex-grow h-1.5 rounded bg-border">
                  <div
                    className="h-full rounded bg-accent"
                    style={{ width: `${(o.overlapCount / maxOverlap) * 100}%` }}
                  />
                </div>
                <span className="w-[70px] text-[11px] text-textSecondary">{o.keyword}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-surface px-5 py-5 flex flex-col gap-3 min-h-0 overflow-hidden">
          <span className="text-[13px] font-semibold text-textPrimary">
            Thời tiết · {data.weatherSnapshot.length} khu vực
          </span>
          <div className="grid grid-cols-2 gap-2.5 overflow-auto">
            {data.weatherSnapshot.map((w) => (
              <div key={w.location} className="rounded-lg border border-border bg-bg px-3 py-2.5">
                <span className="text-[11px] text-textSecondary">{w.location}</span>
                <div className="font-mono text-base text-textPrimary">{w.temperatureC.toFixed(0)}°C</div>
                <span className="text-[10.5px] text-textMuted">độ ẩm {w.humidityPct.toFixed(0)}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Run the full test suite**

Run: `cd web && npx vitest run`
Expected: all tests pass (existing + all new from Tasks 2-5)

- [ ] **Step 4: Run full type check**

Run: `cd web && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Run the production build**

Run: `cd web && npm run build`
Expected: build succeeds; `/insights` and `/api/insights` listed in the route output

- [ ] **Step 6: Commit**

```bash
git add web/app/insights/page.tsx web/components/NavBar.tsx
git commit -m "$(cat <<'EOF'
Add /insights page: 4-card trending grid with Hôm nay/7 ngày toggle

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 7: Push and wait for the deploy gate**

```bash
git push
```

No `.tf` changes in this push (Task 1's infra change already shipped and was already approved separately) — Terraform plan should show no changes. Tell the user the Deploy run is waiting on the production approval gate as usual and wait for their approval.

- [ ] **Step 8: Live verification**

Once Deploy shows `completed success`:

```bash
curl -sS https://realtime-data-pipeline.vercel.app/api/insights | python3 -m json.tool
```

Expected: all 4 sections present and non-empty (weather may have fewer than 12 entries if fewer than one ingestion cycle has passed for a given location since Task 1's deploy — acceptable).

```bash
curl -sS "https://realtime-data-pipeline.vercel.app/api/insights?range=7d" | python3 -m json.tool
```

Expected: `range: "7d"`, and `topKeywords`/`cryptoMentions`/`githubHnOverlap` counts are equal to or larger than the `today` response's (more days of data, monotonically non-decreasing mention/overlap counts) — `weatherSnapshot` should be identical between the two responses (it always reflects only today, per the spec's non-goal).

```bash
curl -sS -o /dev/null -w "HTTP %{http_code}\n" https://realtime-data-pipeline.vercel.app/insights
```

Expected: `HTTP 200`.

Report all results to the user before declaring the task complete.
