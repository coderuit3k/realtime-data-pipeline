# Explorer Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real `/explorer` page to `web/` — a free-form Athena SQL runner with 7 real curated starter queries — protected by an AWS-enforced per-query cost cap, a read-only SQL validator, a tighter rate limit, and the existing least-privilege IAM (unchanged).

**Architecture:** Extract shared/reusable pieces first (`clientIp`, Athena poll loop), then build the pure-logic pieces (`sqlGuard`, `explorerQueries`), then the two API routes, then the page UI, then the one real infra change (`bytes_scanned_cutoff_per_query`) and deploy.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, `@aws-sdk/client-athena` (already a dependency), Vitest, Terraform.

**Spec:** `docs/superpowers/specs/2026-09-20-explorer-page-design.md`

## Global Constraints

- TypeScript strict mode must not be weakened.
- No new environment variables — reuse `ATHENA_WORKGROUP`, `ATHENA_DATABASE`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` (all already required elsewhere).
- No IAM changes — the existing web-app IAM user's `AthenaQuery`, `GlueReadCuratedDatabase`, `S3ReadCuratedData`, `S3AthenaResults` statements already cover everything a read-only `SELECT` against the curated database needs.
- Design tokens from `web/tailwind.config.ts` only (`bg`, `surface`, `border`, `accent`, `textPrimary`, `textSecondary`, `textMuted`, `error`, `success`) — never raw hex.
- Vietnamese UI copy exactly as specified in each task — do not invent alternate wording.
- No component tests (project convention) — `lib`/`route` unit tests plus a manual live-verification checklist in the final task.
- `runAthenaQuery`'s existing signature and behavior must not change — its existing tests in `web/lib/athena.test.ts` must keep passing unmodified.
- The read-only SQL validator and the Athena workgroup's `bytes_scanned_cutoff_per_query` are both required — neither replaces the other (see spec's "Threat model").

---

### Task 1: Extract `clientIp()` into a shared module

**Files:**
- Create: `web/lib/clientIp.ts`
- Modify: `web/app/api/assistant/route.ts`
- Test: `web/lib/clientIp.test.ts`

**Interfaces:**
- Consumes: nothing new (uses `NextRequest` from `next/server`, already a project dependency).
- Produces: `clientIp(request: NextRequest): string` — consumed by Task 6's `POST /api/explorer/query` route, and by the already-existing `web/app/api/assistant/route.ts` (updated in this task to import instead of defining its own copy).

- [ ] **Step 1: Write the failing test**

```typescript
// web/lib/clientIp.test.ts
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { clientIp } from "./clientIp";

function requestWithHeaders(headers: Record<string, string>): NextRequest {
  return new NextRequest("http://localhost/api/test", { headers });
}

describe("clientIp", () => {
  it("prefers x-vercel-forwarded-for when present", () => {
    const request = requestWithHeaders({
      "x-vercel-forwarded-for": "1.1.1.1",
      "x-real-ip": "2.2.2.2",
      "x-forwarded-for": "3.3.3.3, 4.4.4.4",
    });
    expect(clientIp(request)).toBe("1.1.1.1");
  });

  it("falls back to x-real-ip when x-vercel-forwarded-for is absent", () => {
    const request = requestWithHeaders({
      "x-real-ip": "2.2.2.2",
      "x-forwarded-for": "3.3.3.3, 4.4.4.4",
    });
    expect(clientIp(request)).toBe("2.2.2.2");
  });

  it("falls back to the rightmost X-Forwarded-For hop (client-spoofable leftmost hop is ignored)", () => {
    const request = requestWithHeaders({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" });
    expect(clientIp(request)).toBe("5.6.7.8");
  });

  it("returns 'unknown' when no IP header is present", () => {
    const request = requestWithHeaders({});
    expect(clientIp(request)).toBe("unknown");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run lib/clientIp.test.ts`
Expected: FAIL with "Cannot find module './clientIp'"

- [ ] **Step 3: Write `web/lib/clientIp.ts`**

Move the function verbatim from `web/app/api/assistant/route.ts` (do not change its logic):

```typescript
import type { NextRequest } from "next/server";

export function clientIp(request: NextRequest): string {
  const h = request.headers;
  const xff = h.get("x-forwarded-for")?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
  return (
    h.get("x-vercel-forwarded-for")?.trim() ||
    h.get("x-real-ip")?.trim() ||
    xff[xff.length - 1] ||
    "unknown"
  );
}
```

- [ ] **Step 4: Update `web/app/api/assistant/route.ts`**

Remove the inline `function clientIp(request: NextRequest): string { ... }` definition entirely, and add an import at the top of the file:

```typescript
import { clientIp } from "@/lib/clientIp";
```

The rest of the file (its call site `clientIp(request)`) is unchanged.

- [ ] **Step 5: Run tests to verify everything passes**

Run: `cd web && npx vitest run lib/clientIp.test.ts app/api/assistant/route.test.ts`
Expected: PASS (4 new tests + all existing assistant route tests, including "uses the rightmost X-Forwarded-For hop as the rate limit identifier")

- [ ] **Step 6: Run full type check**

Run: `cd web && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add web/lib/clientIp.ts web/lib/clientIp.test.ts web/app/api/assistant/route.ts
git commit -m "$(cat <<'EOF'
Extract clientIp() into a shared module

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `web/lib/sqlGuard.ts` — read-only SQL validator

**Files:**
- Create: `web/lib/sqlGuard.ts`
- Test: `web/lib/sqlGuard.test.ts`

**Interfaces:**
- Consumes: nothing (pure function, no dependencies).
- Produces: `validateReadOnlySelect(sql: string): { ok: true } | { ok: false; reason: string }` — consumed by Task 6's `POST /api/explorer/query` route.

- [ ] **Step 1: Write the failing test**

```typescript
// web/lib/sqlGuard.test.ts
import { describe, expect, it } from "vitest";
import { validateReadOnlySelect } from "./sqlGuard";

describe("validateReadOnlySelect", () => {
  it("accepts a plain SELECT", () => {
    expect(validateReadOnlySelect("SELECT * FROM crypto_prices")).toEqual({ ok: true });
  });

  it("accepts a WITH ... SELECT (CTE)", () => {
    expect(validateReadOnlySelect("WITH x AS (SELECT 1) SELECT * FROM x")).toEqual({ ok: true });
  });

  it("accepts leading whitespace and lowercase select", () => {
    expect(validateReadOnlySelect("  select 1")).toEqual({ ok: true });
  });

  it("rejects an empty string", () => {
    const result = validateReadOnlySelect("   ");
    expect(result.ok).toBe(false);
  });

  it("rejects a statement that doesn't start with SELECT or WITH", () => {
    const result = validateReadOnlySelect("EXPLAIN SELECT * FROM crypto_prices");
    expect(result).toEqual({ ok: false, reason: "Chỉ cho phép câu lệnh SELECT (có thể bắt đầu bằng WITH)." });
  });

  it.each([
    "INSERT INTO crypto_prices VALUES (1)",
    "UPDATE crypto_prices SET price_usd=1",
    "DELETE FROM crypto_prices",
    "DROP TABLE crypto_prices",
    "ALTER TABLE crypto_prices ADD COLUMN x int",
    "CREATE TABLE x AS SELECT * FROM crypto_prices",
    "GRANT SELECT ON crypto_prices TO someone",
    "REVOKE SELECT ON crypto_prices FROM someone",
    "TRUNCATE TABLE crypto_prices",
    "MERGE INTO crypto_prices USING x ON true WHEN MATCHED THEN DELETE",
    "UNLOAD (SELECT 1) TO 's3://bucket/' WITH (format='JSON')",
    "VACUUM crypto_prices",
    "CALL some_procedure()",
  ])("rejects a forbidden statement: %s", (sql) => {
    const result = validateReadOnlySelect(sql);
    expect(result.ok).toBe(false);
  });

  it("rejects a SELECT followed by a second statement", () => {
    const result = validateReadOnlySelect("SELECT 1; DROP TABLE crypto_prices");
    expect(result).toEqual({ ok: false, reason: "Không được nối nhiều câu lệnh bằng dấu ';'." });
  });

  it("allows a single trailing semicolon", () => {
    expect(validateReadOnlySelect("SELECT 1;")).toEqual({ ok: true });
  });

  it("does not false-positive on a forbidden word appearing inside a string literal's substring of a column name", () => {
    // 'created_at' contains no forbidden keyword as a whole word; this guards
    // against a naive substring match (not a word-boundary match) rejecting
    // legitimate queries.
    expect(validateReadOnlySelect("SELECT created_at FROM hackernews_stories")).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run lib/sqlGuard.test.ts`
Expected: FAIL with "Cannot find module './sqlGuard'"

- [ ] **Step 3: Write `web/lib/sqlGuard.ts`**

```typescript
export type SqlGuardResult = { ok: true } | { ok: false; reason: string };

const FORBIDDEN_KEYWORDS =
  /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|GRANT|REVOKE|TRUNCATE|MERGE|UNLOAD|VACUUM|CALL)\b/i;

export function validateReadOnlySelect(sql: string): SqlGuardResult {
  const trimmed = sql.trim();

  if (!trimmed) {
    return { ok: false, reason: "Câu lệnh SQL đang trống." };
  }
  if (!/^(SELECT|WITH)\b/i.test(trimmed)) {
    return { ok: false, reason: "Chỉ cho phép câu lệnh SELECT (có thể bắt đầu bằng WITH)." };
  }
  if (FORBIDDEN_KEYWORDS.test(trimmed)) {
    return { ok: false, reason: "Câu lệnh chứa từ khoá không được phép (chỉ đọc dữ liệu)." };
  }

  const withoutTrailingSemicolon = trimmed.replace(/;\s*$/, "");
  if (withoutTrailingSemicolon.includes(";")) {
    return { ok: false, reason: "Không được nối nhiều câu lệnh bằng dấu ';'." };
  }

  return { ok: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run lib/sqlGuard.test.ts`
Expected: PASS (17 tests, counting the `it.each` expansion)

- [ ] **Step 5: Run full type check**

Run: `cd web && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add web/lib/sqlGuard.ts web/lib/sqlGuard.test.ts
git commit -m "$(cat <<'EOF'
Add read-only SQL validator for the Explorer query endpoint

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `web/lib/athena.ts` — extract shared poll loop, add `runAthenaQueryWithStats`

**Files:**
- Modify: `web/lib/athena.ts`
- Modify: `web/lib/athena.test.ts` (add new tests; existing tests must not change their expectations)

**Interfaces:**
- Consumes: nothing new.
- Produces: `export function partitionWhere(parts: TodayParts): string` (was private, now exported); `export type QueryStats = { dataScannedInBytes: number; engineExecutionTimeMs: number }`; `export async function runAthenaQueryWithStats(client: AthenaClient, sql: string, maxResults?: number): Promise<{ columns: string[]; rows: AthenaResultRow[]; stats: QueryStats; hasMoreRows: boolean }>` — consumed by Task 6's `POST /api/explorer/query` route. `partitionWhere` is consumed by Task 4's `explorerQueries.ts`.

- [ ] **Step 1: Write the failing tests (append to the existing file)**

Add to `web/lib/athena.test.ts` (keep every existing `describe` block unchanged):

```typescript
describe("partitionWhere (exported)", () => {
  it("is the same clause runAthenaQuery's internal queries already produce", () => {
    const parts = { year: "2026", month: "09", day: "20" };
    expect(partitionWhere(parts)).toBe("WHERE year='2026' AND month='09' AND day='20'");
  });
});

describe("runAthenaQueryWithStats", () => {
  it("returns columns, rows, stats, and hasMoreRows:false when there's no NextToken", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ QueryExecutionId: "q-10" })
      .mockResolvedValueOnce({
        QueryExecution: {
          Status: { State: "SUCCEEDED" },
          Statistics: { DataScannedInBytes: 4200000, EngineExecutionTimeInMillis: 310 },
        },
      })
      .mockResolvedValueOnce({
        ResultSet: {
          ResultSetMetadata: { ColumnInfo: [{ Name: "coin_id" }, { Name: "price_usd" }] },
          Rows: [
            { Data: [{ VarCharValue: "coin_id" }, { VarCharValue: "price_usd" }] },
            { Data: [{ VarCharValue: "bitcoin" }, { VarCharValue: "81314.2" }] },
          ],
        },
      });
    const client = { send } as unknown as import("@aws-sdk/client-athena").AthenaClient;

    process.env.ATHENA_WORKGROUP = "wg";
    process.env.ATHENA_DATABASE = "db";
    const result = await runAthenaQueryWithStats(client, "SELECT 1", 100);

    expect(result.columns).toEqual(["coin_id", "price_usd"]);
    expect(result.rows).toHaveLength(2);
    expect(result.stats).toEqual({ dataScannedInBytes: 4200000, engineExecutionTimeMs: 310 });
    expect(result.hasMoreRows).toBe(false);
  });

  it("passes maxResults through to GetQueryResultsCommand and reports hasMoreRows:true when NextToken is present", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ QueryExecutionId: "q-11" })
      .mockResolvedValueOnce({
        QueryExecution: { Status: { State: "SUCCEEDED" }, Statistics: {} },
      })
      .mockResolvedValueOnce({
        ResultSet: { ResultSetMetadata: { ColumnInfo: [] }, Rows: [] },
        NextToken: "more-pages",
      });
    const client = { send } as unknown as import("@aws-sdk/client-athena").AthenaClient;

    process.env.ATHENA_WORKGROUP = "wg";
    process.env.ATHENA_DATABASE = "db";
    const result = await runAthenaQueryWithStats(client, "SELECT 1", 5);

    const resultsCall = send.mock.calls[2][0];
    expect(resultsCall.input.MaxResults).toBe(5);
    expect(result.hasMoreRows).toBe(true);
    expect(result.stats).toEqual({ dataScannedInBytes: 0, engineExecutionTimeMs: 0 });
  });

  it("throws with the failure reason when the query fails, same as runAthenaQuery", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ QueryExecutionId: "q-12" })
      .mockResolvedValueOnce({
        QueryExecution: { Status: { State: "FAILED", StateChangeReason: "table not found" } },
      });
    const client = { send } as unknown as import("@aws-sdk/client-athena").AthenaClient;

    process.env.ATHENA_WORKGROUP = "wg";
    process.env.ATHENA_DATABASE = "db";
    await expect(runAthenaQueryWithStats(client, "SELECT 1")).rejects.toThrow("table not found");
  });
});
```

Add `partitionWhere` and `runAthenaQueryWithStats` to the existing `import { ... } from "./athena"` line at the top of the test file.

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `cd web && npx vitest run lib/athena.test.ts`
Expected: existing tests still PASS; the 4 new tests FAIL (`partitionWhere`/`runAthenaQueryWithStats` not exported yet)

- [ ] **Step 3: Refactor `web/lib/athena.ts`**

First, update the top-of-file import to also bring in the output type used by the new helper's local variable:

```typescript
import {
  AthenaClient,
  StartQueryExecutionCommand,
  GetQueryExecutionCommand,
  GetQueryResultsCommand,
  type GetQueryExecutionCommandOutput,
} from "@aws-sdk/client-athena";
```

Then replace the file's content from `function partitionWhere` through the end of `runAthenaQuery` with:

```typescript
export function partitionWhere({ year, month, day }: TodayParts): string {
  return `WHERE year='${year}' AND month='${month}' AND day='${day}'`;
}

// ... buildSourceVolumeQuery, buildRecentActivityQuery, AthenaResultRow, parseAthenaRows, sleep unchanged ...

type PollOutcome = {
  queryExecutionId: string;
  statistics: { dataScannedInBytes: number; engineExecutionTimeMs: number };
};

async function startAndPollQuery(client: AthenaClient, sql: string): Promise<PollOutcome> {
  const workgroup = process.env.ATHENA_WORKGROUP;
  const database = process.env.ATHENA_DATABASE;
  if (!workgroup || !database) {
    throw new Error("Missing ATHENA_WORKGROUP or ATHENA_DATABASE environment variable");
  }

  const start = await client.send(
    new StartQueryExecutionCommand({
      QueryString: sql,
      QueryExecutionContext: { Database: database },
      WorkGroup: workgroup,
    })
  );
  const queryExecutionId = start.QueryExecutionId;
  if (!queryExecutionId) throw new Error("Athena did not return a QueryExecutionId");

  let finalStatus: GetQueryExecutionCommandOutput | undefined;
  for (let attempt = 0; attempt < 50; attempt++) {
    const status = await client.send(new GetQueryExecutionCommand({ QueryExecutionId: queryExecutionId }));
    const state = status.QueryExecution?.Status?.State;
    if (state === "SUCCEEDED") {
      finalStatus = status;
      break;
    }
    if (state === "FAILED" || state === "CANCELLED") {
      const reason = status.QueryExecution?.Status?.StateChangeReason ?? "unknown reason";
      throw new Error(`Athena query ${state.toLowerCase()}: ${reason}`);
    }
    await sleep(500);
  }

  if (!finalStatus) {
    throw new Error("Athena query timed out waiting for SUCCEEDED state");
  }

  return {
    queryExecutionId,
    statistics: {
      dataScannedInBytes: finalStatus.QueryExecution?.Statistics?.DataScannedInBytes ?? 0,
      engineExecutionTimeMs: finalStatus.QueryExecution?.Statistics?.EngineExecutionTimeInMillis ?? 0,
    },
  };
}

export async function runAthenaQuery(client: AthenaClient, sql: string): Promise<AthenaResultRow[]> {
  const { queryExecutionId } = await startAndPollQuery(client, sql);
  const results = await client.send(new GetQueryResultsCommand({ QueryExecutionId: queryExecutionId }));
  return (results.ResultSet?.Rows ?? []) as AthenaResultRow[];
}

export type QueryStats = { dataScannedInBytes: number; engineExecutionTimeMs: number };

export async function runAthenaQueryWithStats(
  client: AthenaClient,
  sql: string,
  maxResults = 100
): Promise<{ columns: string[]; rows: AthenaResultRow[]; stats: QueryStats; hasMoreRows: boolean }> {
  const { queryExecutionId, statistics } = await startAndPollQuery(client, sql);
  const results = await client.send(
    new GetQueryResultsCommand({ QueryExecutionId: queryExecutionId, MaxResults: maxResults })
  );
  return {
    columns: (results.ResultSet?.ResultSetMetadata?.ColumnInfo ?? []).map((c) => c.Name ?? ""),
    rows: (results.ResultSet?.Rows ?? []) as AthenaResultRow[],
    stats: statistics,
    hasMoreRows: Boolean(results.NextToken),
  };
}
```

Everything above `partitionWhere` (the imports, `TodayParts`, `todayUtcParts`, `buildSourceVolumeQuery`, `buildRecentActivityQuery`, `AthenaResultRow`, `parseAthenaRows`, `sleep`) stays exactly as it is today — only add the `export` keyword to `partitionWhere`'s existing declaration and replace everything from the old inline `runAthenaQuery` onward with the block above.

- [ ] **Step 4: Run tests to verify everything passes**

Run: `cd web && npx vitest run lib/athena.test.ts`
Expected: PASS — all pre-existing tests (`todayUtcParts`, `buildSourceVolumeQuery`, `buildRecentActivityQuery`, `parseAthenaRows`, `runAthenaQuery` ×3) plus the 4 new ones, unchanged behavior for `runAthenaQuery`.

- [ ] **Step 5: Run the dashboard route's tests too (it depends on this file)**

Run: `cd web && npx vitest run app/api/dashboard/route.test.ts`
Expected: PASS, unchanged — proves the refactor didn't alter `runAthenaQuery`'s externally-visible behavior.

- [ ] **Step 6: Run full type check**

Run: `cd web && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add web/lib/athena.ts web/lib/athena.test.ts
git commit -m "$(cat <<'EOF'
Extract shared Athena poll loop; add runAthenaQueryWithStats for Explorer

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `web/lib/explorerQueries.ts` — the 7 real sample queries

**Files:**
- Create: `web/lib/explorerQueries.ts`
- Modify: `web/lib/types.ts`
- Test: `web/lib/explorerQueries.test.ts`

**Interfaces:**
- Consumes: `TodayParts`, `partitionWhere`, `buildSourceVolumeQuery` from `web/lib/athena.ts` (Task 3).
- Produces: `SampleQuery`, `SampleQueryGroup` types in `web/lib/types.ts`; `buildSampleQueryGroups(parts: TodayParts): SampleQueryGroup[]` — consumed by Task 5's `GET /api/explorer/samples` route.

- [ ] **Step 1: Write the failing test**

```typescript
// web/lib/explorerQueries.test.ts
import { describe, expect, it } from "vitest";
import { buildSampleQueryGroups } from "./explorerQueries";
import { buildSourceVolumeQuery } from "./athena";

const PARTS = { year: "2026", month: "09", day: "20" };

describe("buildSampleQueryGroups", () => {
  const groups = buildSampleQueryGroups(PARTS);

  it("has exactly the 3 groups from the mockup, in order", () => {
    expect(groups.map((g) => g.label)).toEqual(["Tương quan", "Xu hướng từ khoá", "Khối lượng & mới nhất"]);
  });

  it("has exactly 7 sample queries total across all groups", () => {
    const total = groups.reduce((sum, g) => sum + g.queries.length, 0);
    expect(total).toBe(7);
  });

  it("every query's SQL references the given partition date", () => {
    for (const group of groups) {
      for (const query of group.queries) {
        expect(query.sql).toContain("year='2026'");
        expect(query.sql).toContain("month='09'");
        expect(query.sql).toContain("day='20'");
      }
    }
  });

  it("the volume-by-source query reuses buildSourceVolumeQuery verbatim, not a duplicate copy", () => {
    const volumeQuery = groups
      .flatMap((g) => g.queries)
      .find((q) => q.id === "volume-by-source");
    expect(volumeQuery?.sql).toBe(buildSourceVolumeQuery(PARTS));
  });

  it("the crypto-mentions query correlates via a keyword substring match, not a mentions table", () => {
    const query = groups.flatMap((g) => g.queries).find((q) => q.id === "crypto-mentions");
    expect(query?.sql).toContain("POSITION(c.coin_id IN mentions.keywords)");
    expect(query?.sql.toLowerCase()).not.toContain("join mentions");
  });

  it("every query id is unique", () => {
    const ids = groups.flatMap((g) => g.queries).map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run lib/explorerQueries.test.ts`
Expected: FAIL with "Cannot find module './explorerQueries'"

- [ ] **Step 3: Add types to `web/lib/types.ts`**

Append (do not modify existing types):

```typescript
export type SampleQuery = { id: string; label: string; sql: string };
export type SampleQueryGroup = { label: string; queries: SampleQuery[] };
```

- [ ] **Step 4: Write `web/lib/explorerQueries.ts`**

```typescript
import { buildSourceVolumeQuery, partitionWhere, type TodayParts } from "./athena";
import type { SampleQueryGroup } from "./types";

export function buildSampleQueryGroups(parts: TodayParts): SampleQueryGroup[] {
  const { year, month, day } = parts;
  const where = partitionWhere(parts);

  return [
    {
      label: "Tương quan",
      queries: [
        {
          id: "crypto-mentions",
          label: "Crypto mentions ↔ giá",
          sql: `SELECT c.coin_id, c.price_usd, c.change_24h_pct,
       (SELECT COUNT(*) FROM (
          SELECT keywords FROM news_articles WHERE year='${year}' AND month='${month}' AND day='${day}'
          UNION ALL
          SELECT keywords FROM hackernews_stories WHERE year='${year}' AND month='${month}' AND day='${day}'
        ) mentions WHERE POSITION(c.coin_id IN mentions.keywords) > 0) AS mention_count
FROM crypto_prices c
WHERE c.year='${year}' AND c.month='${month}' AND c.day='${day}'
ORDER BY c.observed_at DESC`,
        },
        {
          id: "github-hn-overlap",
          label: "GitHub ↔ HN keyword overlap",
          sql: `SELECT DISTINCT g.full_name, g.language, h.title, h.score
FROM github_repos g
CROSS JOIN UNNEST(split(g.keywords, ',')) AS t(gk)
JOIN hackernews_stories h
  ON gk <> '' AND POSITION(gk IN h.keywords) > 0
WHERE g.year='${year}' AND g.month='${month}' AND g.day='${day}'
  AND h.year='${year}' AND h.month='${month}' AND h.day='${day}'
LIMIT 20`,
        },
      ],
    },
    {
      label: "Xu hướng từ khoá",
      queries: [
        {
          id: "top-keywords-hn",
          label: "Top từ khoá HN hôm nay",
          sql: `SELECT k AS keyword, COUNT(*) AS mentions
FROM hackernews_stories
CROSS JOIN UNNEST(split(keywords, ',')) AS t(k)
${where} AND k <> ''
GROUP BY k
ORDER BY mentions DESC
LIMIT 10`,
        },
        {
          id: "top-keywords-news",
          label: "Top từ khoá News hôm nay",
          sql: `SELECT k AS keyword, COUNT(*) AS mentions
FROM news_articles
CROSS JOIN UNNEST(split(keywords, ',')) AS t(k)
${where} AND k <> ''
GROUP BY k
ORDER BY mentions DESC
LIMIT 10`,
        },
      ],
    },
    {
      label: "Khối lượng & mới nhất",
      queries: [
        {
          id: "volume-by-source",
          label: "Volume theo nguồn/ngày",
          sql: buildSourceVolumeQuery(parts),
        },
        {
          id: "latest-weather",
          label: "Weather mới nhất theo khu vực",
          sql: `SELECT location, temperature_c, humidity_pct, wind_speed_kmh, observed_at
FROM weather_observations
${where}
ORDER BY observed_at DESC
LIMIT 20`,
        },
        {
          id: "trending-repos",
          label: "Trending repos hôm nay",
          sql: `SELECT full_name, language, stars, forks, pushed_at
FROM github_repos
${where}
ORDER BY stars DESC
LIMIT 20`,
        },
      ],
    },
  ];
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd web && npx vitest run lib/explorerQueries.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 6: Run full type check**

Run: `cd web && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add web/lib/explorerQueries.ts web/lib/explorerQueries.test.ts web/lib/types.ts
git commit -m "$(cat <<'EOF'
Add 7 real sample queries for the Explorer page

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `GET /api/explorer/samples` route + Explorer rate limiter

**Files:**
- Modify: `web/lib/ratelimit.ts`
- Create: `web/app/api/explorer/samples/route.ts`
- Test: `web/app/api/explorer/samples/route.test.ts`

**Interfaces:**
- Consumes: `buildSampleQueryGroups` from Task 4, `requiredEnv` from `web/lib/aws.ts`.
- Produces: `getExplorerLimiter(): Ratelimit` in `web/lib/ratelimit.ts` — consumed by Task 6's query route. `GET` handler returning `{ workgroup: string; database: string; groups: SampleQueryGroup[] }`.

- [ ] **Step 1: Add `getExplorerLimiter()` to `web/lib/ratelimit.ts`**

Add alongside the existing `getDefaultLimiter()` (do not modify it):

```typescript
let explorerLimiter: Ratelimit | undefined;
export function getExplorerLimiter(): Ratelimit {
  if (!explorerLimiter) {
    const redis = new Redis({
      url: requiredEnv("UPSTASH_REDIS_REST_URL"),
      token: requiredEnv("UPSTASH_REDIS_REST_TOKEN"),
    });
    explorerLimiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(3, "1 m"),
      prefix: "explorer-ratelimit",
    });
  }
  return explorerLimiter;
}
```

- [ ] **Step 2: Write the failing test**

```typescript
// web/app/api/explorer/samples/route.test.ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/aws", () => ({
  requiredEnv: vi.fn((name: string) => {
    if (name === "ATHENA_WORKGROUP") return "realtime-data-pipeline-dev-analytics";
    if (name === "ATHENA_DATABASE") return "realtime_data_pipeline_dev_curated";
    throw new Error(`unexpected requiredEnv(${name})`);
  }),
}));

import { GET } from "./route";

describe("GET /api/explorer/samples", () => {
  it("returns the workgroup, database, and 3 sample query groups", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.workgroup).toBe("realtime-data-pipeline-dev-analytics");
    expect(body.database).toBe("realtime_data_pipeline_dev_curated");
    expect(body.groups).toHaveLength(3);
    expect(body.groups.flatMap((g: { queries: unknown[] }) => g.queries)).toHaveLength(7);
  });

  it("returns 500 with a safe message when a required env var is missing", async () => {
    const { requiredEnv } = await import("@/lib/aws");
    vi.mocked(requiredEnv).mockImplementationOnce(() => {
      throw new Error("Missing required environment variable: ATHENA_WORKGROUP");
    });

    const response = await GET();
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("Không tải được danh sách truy vấn mẫu, thử lại sau.");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd web && npx vitest run app/api/explorer/samples/route.test.ts`
Expected: FAIL with "Cannot find module './route'"

- [ ] **Step 4: Write `web/app/api/explorer/samples/route.ts`**

```typescript
import { NextResponse } from "next/server";
import { requiredEnv } from "@/lib/aws";
import { todayUtcParts } from "@/lib/athena";
import { buildSampleQueryGroups } from "@/lib/explorerQueries";

export async function GET() {
  try {
    const workgroup = requiredEnv("ATHENA_WORKGROUP");
    const database = requiredEnv("ATHENA_DATABASE");
    const groups = buildSampleQueryGroups(todayUtcParts());

    return NextResponse.json(
      { workgroup, database, groups },
      { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" } }
    );
  } catch (error) {
    console.error("Explorer samples API failed", error);
    return NextResponse.json(
      { error: "Không tải được danh sách truy vấn mẫu, thử lại sau." },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd web && npx vitest run app/api/explorer/samples/route.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Run full type check**

Run: `cd web && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add web/lib/ratelimit.ts web/app/api/explorer/samples/route.ts web/app/api/explorer/samples/route.test.ts
git commit -m "$(cat <<'EOF'
Add GET /api/explorer/samples and a dedicated Explorer rate limiter

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `POST /api/explorer/query` route

**Files:**
- Create: `web/app/api/explorer/query/route.ts`
- Test: `web/app/api/explorer/query/route.test.ts`

**Interfaces:**
- Consumes: `validateReadOnlySelect` (Task 2), `runAthenaQueryWithStats` (Task 3), `clientIp` (Task 1), `getExplorerLimiter` (Task 5), `checkRateLimit`/`getAthenaClient` (existing).
- Produces: `POST(request: NextRequest): Promise<NextResponse>` returning `{ columns: string[]; rows: (string|null)[][]; scannedBytes: number; elapsedMs: number; hasMoreRows: boolean }` on success — consumed by Task 7's `page.tsx`.

- [ ] **Step 1: Write the failing test**

```typescript
// web/app/api/explorer/query/route.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/aws", () => ({ getAthenaClient: vi.fn(() => ({})) }));
vi.mock("@/lib/ratelimit", () => ({ checkRateLimit: vi.fn(), getExplorerLimiter: vi.fn(() => "explorer-limiter-marker") }));
vi.mock("@/lib/athena", async () => {
  // Keep the real parseAthenaRows (route.ts uses it on runAthenaQueryWithStats's
  // output) while mocking only the network-calling function.
  const actual = await vi.importActual<typeof import("@/lib/athena")>("@/lib/athena");
  return { ...actual, runAthenaQueryWithStats: vi.fn() };
});

import { checkRateLimit } from "@/lib/ratelimit";
import { runAthenaQueryWithStats } from "@/lib/athena";
import { POST } from "./route";

const mockedCheckRateLimit = vi.mocked(checkRateLimit);
const mockedRun = vi.mocked(runAthenaQueryWithStats);

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/explorer/query", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", "x-forwarded-for": "9.9.9.9" },
  });
}

beforeEach(() => {
  mockedCheckRateLimit.mockReset();
  mockedRun.mockReset();
});

describe("POST /api/explorer/query", () => {
  it("returns 400 and never calls Athena or the rate limiter for a rejected statement", async () => {
    const response = await POST(makeRequest({ sql: "DROP TABLE crypto_prices" }));
    expect(response.status).toBe(400);
    expect(mockedCheckRateLimit).not.toHaveBeenCalled();
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("returns 429 when rate limited, using the explorer limiter", async () => {
    mockedCheckRateLimit.mockResolvedValue({ allowed: false, remaining: 0 });
    const response = await POST(makeRequest({ sql: "SELECT 1" }));
    expect(response.status).toBe(429);
    expect(mockedCheckRateLimit).toHaveBeenCalledWith("9.9.9.9", "explorer-limiter-marker");
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("returns the query result on success", async () => {
    mockedCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 2 });
    mockedRun.mockResolvedValue({
      columns: ["coin_id", "price_usd"],
      rows: [
        { Data: [{ VarCharValue: "coin_id" }, { VarCharValue: "price_usd" }] },
        { Data: [{ VarCharValue: "bitcoin" }, { VarCharValue: "81314.2" }] },
      ],
      stats: { dataScannedInBytes: 4200000, engineExecutionTimeMs: 310 },
      hasMoreRows: false,
    });

    const response = await POST(makeRequest({ sql: "SELECT coin_id, price_usd FROM crypto_prices" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.columns).toEqual(["coin_id", "price_usd"]);
    expect(body.rows).toEqual([["bitcoin", "81314.2"]]);
    expect(body.scannedBytes).toBe(4200000);
    expect(body.elapsedMs).toBe(310);
    expect(body.hasMoreRows).toBe(false);
  });

  it("returns 400 with the real Athena error message when the query fails", async () => {
    mockedCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 2 });
    mockedRun.mockRejectedValue(new Error("Athena query failed: SYNTAX_ERROR: line 1:8: no such column"));

    const response = await POST(makeRequest({ sql: "SELECT nope FROM crypto_prices" }));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Athena query failed: SYNTAX_ERROR: line 1:8: no such column");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run app/api/explorer/query/route.test.ts`
Expected: FAIL with "Cannot find module './route'"

- [ ] **Step 3: Write `web/app/api/explorer/query/route.ts`**

```typescript
import { NextResponse, type NextRequest } from "next/server";
import { getAthenaClient } from "@/lib/aws";
import { runAthenaQueryWithStats, parseAthenaRows } from "@/lib/athena";
import { validateReadOnlySelect } from "@/lib/sqlGuard";
import { checkRateLimit, getExplorerLimiter } from "@/lib/ratelimit";
import { clientIp } from "@/lib/clientIp";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const sql = typeof body?.sql === "string" ? body.sql : "";

  const guard = validateReadOnlySelect(sql);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.reason }, { status: 400 });
  }

  const rateLimit = await checkRateLimit(clientIp(request), getExplorerLimiter());
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: "Đợi một chút rồi chạy tiếp." }, { status: 429 });
  }

  try {
    const { columns, rows, stats, hasMoreRows } = await runAthenaQueryWithStats(getAthenaClient(), sql, 100);
    const dataRows = parseAthenaRows(rows, (cols) => cols);

    return NextResponse.json({
      columns,
      rows: dataRows,
      scannedBytes: stats.dataScannedInBytes,
      elapsedMs: stats.engineExecutionTimeMs,
      hasMoreRows,
    });
  } catch (error) {
    console.error("Explorer query failed", error);
    const message = error instanceof Error ? error.message : "Không chạy được truy vấn.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run app/api/explorer/query/route.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Run full type check**

Run: `cd web && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add web/app/api/explorer/query/route.ts web/app/api/explorer/query/route.test.ts
git commit -m "$(cat <<'EOF'
Add POST /api/explorer/query with guard + rate limit + real Athena execution

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: `/explorer` page UI

**Files:**
- Create: `web/app/explorer/page.tsx`
- Modify: `web/components/NavBar.tsx`

**Interfaces:**
- Consumes: `GET /api/explorer/samples` response shape (Task 5), `POST /api/explorer/query` response shape (Task 6).
- Produces: nothing consumed by later tasks (this is the last code task).

- [ ] **Step 1: Add the nav link**

In `web/components/NavBar.tsx`, extend `LINKS` (currently 3 entries after the Catalog page) to add a 4th:

```typescript
const LINKS = [
  { href: "/", label: "Tổng quan" },
  { href: "/assistant", label: "RAG Assistant" },
  { href: "/catalog", label: "Data Catalog" },
  { href: "/explorer", label: "Data Explorer" },
];
```

- [ ] **Step 2: Write `web/app/explorer/page.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import type { SampleQueryGroup } from "@/lib/types";

type SamplesResponse = { workgroup: string; database: string; groups: SampleQueryGroup[] };
type QueryResult = { columns: string[]; rows: (string | null)[][]; scannedBytes: number; elapsedMs: number; hasMoreRows: boolean };

function formatBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default function ExplorerPage() {
  const [samples, setSamples] = useState<SamplesResponse | null>(null);
  const [samplesError, setSamplesError] = useState<string | null>(null);
  const [sql, setSql] = useState("");
  const [result, setResult] = useState<QueryResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    async function loadSamples() {
      try {
        const res = await fetch("/api/explorer/samples");
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Không tải được truy vấn mẫu.");
        setSamples(body);
        const firstQuery = body.groups[0]?.queries[0];
        if (firstQuery) setSql(firstQuery.sql);
      } catch (err) {
        setSamplesError(err instanceof Error ? err.message : "Không tải được truy vấn mẫu.");
      }
    }
    loadSamples();
  }, []);

  async function runQuery() {
    setRunning(true);
    setRunError(null);
    try {
      const res = await fetch("/api/explorer/query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sql }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Không chạy được truy vấn.");
      setResult(body);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : "Không chạy được truy vấn.");
      setResult(null);
    } finally {
      setRunning(false);
    }
  }

  if (samplesError) {
    return (
      <div className="p-9">
        <p className="text-error text-sm">{samplesError}</p>
      </div>
    );
  }

  return (
    <div className="p-9 flex flex-col gap-5">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-textPrimary">Data Explorer</h1>
        {samples && (
          <p className="mt-1.5 text-sm text-textSecondary">
            Workgroup <span className="font-mono">{samples.workgroup}</span> · DB{" "}
            <span className="font-mono">{samples.database}</span>
          </p>
        )}
      </div>

      <div className="flex gap-4 flex-grow min-h-0">
        <div className="w-[270px] shrink-0 rounded-2xl border border-border bg-surface p-4 flex flex-col gap-4 overflow-auto">
          <span className="text-xs font-semibold text-textPrimary">Truy vấn mẫu</span>
          {samples?.groups.map((group) => (
            <div key={group.label} className="flex flex-col gap-1.5">
              <span className="font-mono text-[10px] uppercase text-textMuted">{group.label}</span>
              {group.queries.map((query) => (
                <button
                  key={query.id}
                  onClick={() => setSql(query.sql)}
                  className={`text-left rounded-lg px-2.5 py-2 text-xs ${
                    sql === query.sql ? "bg-accent/10 border border-accent text-textPrimary" : "text-textSecondary"
                  }`}
                >
                  {query.label}
                </button>
              ))}
            </div>
          ))}
        </div>

        <div className="flex-grow flex flex-col gap-4 min-h-0">
          <div className="rounded-2xl border border-border bg-surface px-5 py-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-textPrimary">SQL</span>
              <button
                onClick={runQuery}
                disabled={running}
                className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-bg disabled:opacity-50"
              >
                {running ? "Đang chạy…" : "▶ Chạy"}
              </button>
            </div>
            <textarea
              value={sql}
              onChange={(e) => setSql(e.target.value)}
              rows={8}
              className="font-mono text-xs bg-bg border border-border rounded-lg p-3 text-accent resize-y"
            />
            {runError && <p className="text-error text-xs">{runError}</p>}
          </div>

          {result && (
            <div className="rounded-2xl border border-border bg-surface px-5 py-4 flex flex-col gap-3 flex-grow min-h-0 overflow-auto">
              <span className="text-xs font-semibold text-textPrimary">Kết quả</span>
              <table className="font-mono w-full border-collapse text-xs">
                <thead>
                  <tr>
                    {result.columns.map((col) => (
                      <th key={col} className="text-left text-textSecondary text-[10.5px] uppercase border-b border-border py-2 px-2.5">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row, i) => (
                    <tr key={i}>
                      {row.map((cell, j) => (
                        <td key={j} className="text-textSecondary border-b border-border py-2 px-2.5">
                          {cell ?? ""}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <span className="mt-auto text-[11px] text-textMuted">
                Quét {formatBytes(result.scannedBytes)} · {(result.elapsedMs / 1000).toFixed(2)}s · {result.rows.length} dòng
                {result.hasMoreRows ? " (hiển thị 100 dòng đầu)" : ""}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Run the full test suite**

Run: `cd web && npx vitest run`
Expected: all tests pass (existing + all new from Tasks 1-6)

- [ ] **Step 4: Run full type check**

Run: `cd web && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Run the production build**

Run: `cd web && npm run build`
Expected: build succeeds; `/explorer`, `/api/explorer/samples`, `/api/explorer/query` listed in the route output

- [ ] **Step 6: Commit**

```bash
git add web/app/explorer/page.tsx web/components/NavBar.tsx
git commit -m "$(cat <<'EOF'
Add /explorer page: editable SQL runner with curated sample queries

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Athena workgroup cost cap + deploy + live verification

**Files:**
- Modify: `infra/glue.tf`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing (final task).

- [ ] **Step 1: Add the cost cap to `infra/glue.tf`**

In `resource "aws_athena_workgroup" "main"`'s `configuration` block, add `bytes_scanned_cutoff_per_query`:

```hcl
resource "aws_athena_workgroup" "main" {
  name = "${local.name_prefix}-analytics"

  configuration {
    enforce_workgroup_configuration    = true
    publish_cloudwatch_metrics_enabled = true
    # Hard AWS-enforced cap so the Explorer page's free-form SQL can never
    # scan more than ~1 GiB in a single query (~$0.005 at Athena's
    # $5/TB-scanned rate), regardless of what SQL text produced it.
    bytes_scanned_cutoff_per_query = 1073741824

    result_configuration {
      output_location = "s3://${aws_s3_bucket.curated.bucket}/athena-results/"
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add infra/glue.tf
git commit -m "$(cat <<'EOF'
Cap Athena workgroup at 1 GiB scanned/query for the Explorer page

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 3: Push and wait for the deploy gate**

```bash
git push
```

This is a real `.tf` change, so `terraform plan`/`apply` runs through the
existing gated CI/CD pipeline like any other infra change (unlike the
Catalog sub-project's IAM-user step, this one needs no manual AWS CLI
step — the GitHub Actions deploy role already manages this workgroup
resource). Poll GitHub Actions; tell the user the Deploy run is waiting on
the production approval gate and wait for their approval before
proceeding.

- [ ] **Step 4: Live verification**

Once Deploy shows `completed success`, run each of the 7 sample queries
for real:

```bash
curl -sS https://realtime-data-pipeline.vercel.app/api/explorer/samples | python3 -m json.tool
```

Expected: `workgroup`/`database` match the real Terraform outputs; 3
groups, 7 queries total.

For at least 2 of the 7 sample queries (one simple, one with a `JOIN`/`UNNEST`), POST the exact `sql` string from the samples response to `/api/explorer/query` and confirm real columns/rows come back:

```bash
curl -sS -X POST https://realtime-data-pipeline.vercel.app/api/explorer/query \
  -H "content-type: application/json" \
  -d '{"sql": "<paste one sample query'"'"'s sql field here>"}' | python3 -m json.tool
```

Then verify the guard rejects a real attempt end-to-end:

```bash
curl -sS -X POST https://realtime-data-pipeline.vercel.app/api/explorer/query \
  -H "content-type: application/json" \
  -d '{"sql": "DROP TABLE crypto_prices"}'
```

Expected: `{"error":"Câu lệnh chứa từ khoá không được phép (chỉ đọc dữ liệu)."}`, HTTP 400.

Then verify the rate limit trips on the 4th rapid request:

```bash
for i in 1 2 3 4; do
  curl -sS -o /dev/null -w "request $i: HTTP %{http_code}\n" -X POST https://realtime-data-pipeline.vercel.app/api/explorer/query \
    -H "content-type: application/json" -d '{"sql": "SELECT 1"}'
done
```

Expected: requests 1-3 return 200, request 4 returns 429.

Finally:

```bash
curl -sS -o /dev/null -w "HTTP %{http_code}\n" https://realtime-data-pipeline.vercel.app/explorer
```

Expected: `HTTP 200`.

Report all results to the user before declaring the task complete.
