# Next.js Web App (Dashboard + RAG Assistant) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and deploy a public Next.js app with two screens — a Dashboard (live Athena + CloudWatch data) and a RAG Assistant (invokes the deployed `rag_query`/`rag_agent` Lambdas) — reusing the existing AWS pipeline with no changes to its Lambda code.

**Architecture:** A `web/` Next.js 15 App Router project with two API routes (`/api/dashboard`, `/api/assistant`) as the only AWS-facing code; everything else is presentational React. A new least-privilege IAM user (Terraform) supplies the AWS credentials Vercel's serverless functions use at runtime. Upstash rate-limits the Bedrock-backed assistant endpoint.

**Tech Stack:** Next.js 15 (App Router, TypeScript, App Router route handlers), Tailwind CSS 3, Vitest for unit tests, `@aws-sdk/client-athena` / `@aws-sdk/client-lambda` / `@aws-sdk/client-cloudwatch`, `@upstash/ratelimit` + `@upstash/redis`, deployed to Vercel.

**Spec:** `docs/superpowers/specs/2026-09-19-nextjs-web-app-design.md`

## Global Constraints

- Lives at `web/` in this repo; Vercel project root directory = `web/`. Does not touch `.github/workflows` (Vercel deploys via its own GitHub integration).
- No mock data anywhere — both API routes call real AWS from the first working version.
- No authentication; the only abuse protection is the 5 req/min/IP limit on `/api/assistant`.
- Dashboard "chi phí ước tính" is the static value `1.02` (USD) — never a live Cost Explorer call.
- Design tokens (exact hex, from the approved mockup): bg `#0B1120`, surface `#131B2E`, border `#1E2A47`, accent `#2DD4BF`, text primary `#E8ECF6`, text secondary `#93A0C2`, text muted `#5C6892`, success `#34D399`, warning `#F5A524`, error `#F0576B`. Fonts: Space Grotesk (headings), Work Sans (body), IBM Plex Mono (data/numbers), all via `next/font/google`.
- Package manager: npm. TypeScript `strict: true`.
- Glue table names/columns (already deployed, do not rename): `hackernews_stories(story_id,title,...,ingested_at,keywords)`, `news_articles(article_id,title,...)`, `weather_observations(weather_id,location,...)`, `crypto_prices(price_id,coin_id,...)`, `github_repos(repo_id,full_name,...)` — all 5 partitioned by `year,month,day` (string).

---

## File structure (end state)

```
web/
  app/
    layout.tsx
    globals.css
    page.tsx                  Dashboard (client component)
    assistant/page.tsx        RAG Assistant (client component)
    api/dashboard/route.ts
    api/assistant/route.ts
  lib/
    types.ts                  DashboardResponse, SourceVolume, ActivityItem
    aws.ts                    requiredEnv + AWS SDK client singletons
    athena.ts                 date/query builders, row parser, query runner
    ratelimit.ts               checkRateLimit()
    assistant.ts               AssistantResult types + normalizeAssistantResult()
  components/
    KpiCard.tsx
    SourceVolumeChart.tsx
    ActivityFeed.tsx
    ModeToggle.tsx
    ChatThread.tsx
    ToolTrace.tsx
  package.json, tsconfig.json, tailwind.config.ts, postcss.config.js, next.config.ts, vitest.config.ts
infra/
  web_access.tf               new IAM user/policy/access key + outputs
```

---

### Task 1: Scaffold the Next.js app

**Files:**
- Create: `web/package.json`, `web/tsconfig.json`, `web/next.config.ts`, `web/tailwind.config.ts`, `web/postcss.config.js`, `web/vitest.config.ts`
- Create: `web/app/layout.tsx`, `web/app/globals.css`, `web/app/page.tsx` (placeholder)

**Interfaces:**
- Produces: the `@/*` path alias (→ `web/*`), the Tailwind color tokens (`bg`, `surface`, `border`, `accent`, `textPrimary`, `textSecondary`, `textMuted`, `success`, `warning`, `error`) used by every later component task.

- [ ] **Step 1: Write `web/package.json`**

```json
{
  "name": "datapulse-web",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "test": "vitest run"
  },
  "dependencies": {
    "next": "15.1.0",
    "react": "19.0.0",
    "react-dom": "19.0.0",
    "@aws-sdk/client-athena": "^3.687.0",
    "@aws-sdk/client-lambda": "^3.687.0",
    "@aws-sdk/client-cloudwatch": "^3.687.0",
    "@upstash/ratelimit": "^2.0.3",
    "@upstash/redis": "^1.34.0"
  },
  "devDependencies": {
    "typescript": "^5.6.3",
    "@types/node": "^22.9.0",
    "@types/react": "^19.0.1",
    "@types/react-dom": "^19.0.2",
    "tailwindcss": "^3.4.14",
    "postcss": "^8.4.47",
    "autoprefixer": "^10.4.20",
    "vitest": "^2.1.4"
  }
}
```

- [ ] **Step 2: Write `web/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Write `web/next.config.ts`**

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {};

export default nextConfig;
```

- [ ] **Step 4: Write `web/tailwind.config.ts`**

```ts
import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0B1120",
        surface: "#131B2E",
        border: "#1E2A47",
        accent: "#2DD4BF",
        textPrimary: "#E8ECF6",
        textSecondary: "#93A0C2",
        textMuted: "#5C6892",
        success: "#34D399",
        warning: "#F5A524",
        error: "#F0576B",
      },
      fontFamily: {
        heading: ["var(--font-space-grotesk)"],
        body: ["var(--font-work-sans)"],
        mono: ["var(--font-ibm-plex-mono)"],
      },
    },
  },
  plugins: [],
};

export default config;
```

- [ ] **Step 5: Write `web/postcss.config.js`**

```js
module.exports = {
  plugins: { tailwindcss: {}, autoprefixer: {} },
};
```

- [ ] **Step 6: Write `web/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: { environment: "node" },
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
});
```

- [ ] **Step 7: Write `web/app/globals.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

body {
  background-color: #0b1120;
  color: #e8ecf6;
  font-family: var(--font-work-sans), sans-serif;
}
```

- [ ] **Step 8: Write `web/app/layout.tsx`**

```tsx
import type { Metadata } from "next";
import { Space_Grotesk, Work_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-space-grotesk",
});
const workSans = Work_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-work-sans",
});
const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-ibm-plex-mono",
});

export const metadata: Metadata = {
  title: "DataPulse",
  description: "Real-time data pipeline dashboard & RAG assistant",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className={`${spaceGrotesk.variable} ${workSans.variable} ${ibmPlexMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 9: Write placeholder `web/app/page.tsx`**

```tsx
export default function Home() {
  return <div className="p-9 text-textPrimary">DataPulse — building.</div>;
}
```

- [ ] **Step 10: Install and build**

Run: `cd web && npm install && npm run build`
Expected: build succeeds, no TypeScript errors.

- [ ] **Step 11: Commit**

```bash
git add web/
git commit -m "Scaffold Next.js web app (empty dashboard placeholder)"
```

---

### Task 2: Athena helpers (`lib/athena.ts`)

**Files:**
- Create: `web/lib/athena.ts`
- Test: `web/lib/athena.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (pure module; `runAthenaQuery` takes an injected client so it has no hard dependency on `lib/aws.ts`).
- Produces: `todayUtcParts(now?: Date): { year: string; month: string; day: string }`, `buildSourceVolumeQuery(parts): string`, `buildRecentActivityQuery(parts): string`, `type AthenaResultRow = { Data?: Array<{ VarCharValue?: string }> }`, `parseAthenaRows<T>(rows: AthenaResultRow[], mapRow: (cols: (string | null)[]) => T): T[]`, `runAthenaQuery(client, sql: string): Promise<AthenaResultRow[]>` — all consumed by Task 4.

- [ ] **Step 1: Write the failing tests**

```ts
// web/lib/athena.test.ts
import { describe, expect, it, vi } from "vitest";
import {
  todayUtcParts,
  buildSourceVolumeQuery,
  buildRecentActivityQuery,
  parseAthenaRows,
  runAthenaQuery,
} from "./athena";

describe("todayUtcParts", () => {
  it("zero-pads month and day", () => {
    const parts = todayUtcParts(new Date("2026-01-05T23:59:00Z"));
    expect(parts).toEqual({ year: "2026", month: "01", day: "05" });
  });
});

describe("buildSourceVolumeQuery", () => {
  it("filters all 5 tables on the given partition", () => {
    const sql = buildSourceVolumeQuery({ year: "2026", month: "09", day: "19" });
    expect(sql).toContain("hackernews_stories");
    expect(sql).toContain("crypto_prices");
    expect(sql).toContain("github_repos");
    expect(sql).toContain("year='2026' AND month='09' AND day='19'");
  });
});

describe("buildRecentActivityQuery", () => {
  it("orders by ingested_at and limits to 5", () => {
    const sql = buildRecentActivityQuery({ year: "2026", month: "09", day: "19" });
    expect(sql).toContain("ORDER BY ingested_at DESC LIMIT 5");
    expect(sql).toContain("weather_observations");
  });
});

describe("parseAthenaRows", () => {
  it("skips the header row and maps the rest", () => {
    const rows = [
      { Data: [{ VarCharValue: "source" }, { VarCharValue: "records" }] },
      { Data: [{ VarCharValue: "hackernews" }, { VarCharValue: "612" }] },
      { Data: [{ VarCharValue: "news" }, { VarCharValue: "540" }] },
    ];
    const parsed = parseAthenaRows(rows, (cols) => ({ source: cols[0], records: Number(cols[1]) }));
    expect(parsed).toEqual([
      { source: "hackernews", records: 612 },
      { source: "news", records: 540 },
    ]);
  });
});

describe("runAthenaQuery", () => {
  it("starts, polls until SUCCEEDED, then returns result rows", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ QueryExecutionId: "q-1" })
      .mockResolvedValueOnce({ QueryExecution: { Status: { State: "SUCCEEDED" } } })
      .mockResolvedValueOnce({ ResultSet: { Rows: [{ Data: [{ VarCharValue: "x" }] }] } });
    const client = { send } as unknown as import("@aws-sdk/client-athena").AthenaClient;

    process.env.ATHENA_WORKGROUP = "wg";
    process.env.ATHENA_DATABASE = "db";
    const rows = await runAthenaQuery(client, "SELECT 1");

    expect(rows).toEqual([{ Data: [{ VarCharValue: "x" }] }]);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("throws with the failure reason when the query fails", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ QueryExecutionId: "q-2" })
      .mockResolvedValueOnce({
        QueryExecution: { Status: { State: "FAILED", StateChangeReason: "table not found" } },
      });
    const client = { send } as unknown as import("@aws-sdk/client-athena").AthenaClient;

    process.env.ATHENA_WORKGROUP = "wg";
    process.env.ATHENA_DATABASE = "db";
    await expect(runAthenaQuery(client, "SELECT 1")).rejects.toThrow("table not found");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run lib/athena.test.ts`
Expected: FAIL — `./athena` has no exported members.

- [ ] **Step 3: Write the implementation**

```ts
// web/lib/athena.ts
import {
  AthenaClient,
  StartQueryExecutionCommand,
  GetQueryExecutionCommand,
  GetQueryResultsCommand,
} from "@aws-sdk/client-athena";

export type TodayParts = { year: string; month: string; day: string };

export function todayUtcParts(now: Date = new Date()): TodayParts {
  return {
    year: String(now.getUTCFullYear()),
    month: String(now.getUTCMonth() + 1).padStart(2, "0"),
    day: String(now.getUTCDate()).padStart(2, "0"),
  };
}

function partitionWhere({ year, month, day }: TodayParts): string {
  return `WHERE year='${year}' AND month='${month}' AND day='${day}'`;
}

export function buildSourceVolumeQuery(parts: TodayParts): string {
  const where = partitionWhere(parts);
  return [
    `SELECT 'hackernews' AS source, COUNT(*) AS records FROM hackernews_stories ${where}`,
    `SELECT 'news' AS source, COUNT(*) AS records FROM news_articles ${where}`,
    `SELECT 'weather' AS source, COUNT(*) AS records FROM weather_observations ${where}`,
    `SELECT 'crypto' AS source, COUNT(*) AS records FROM crypto_prices ${where}`,
    `SELECT 'github' AS source, COUNT(*) AS records FROM github_repos ${where}`,
  ].join("\nUNION ALL\n");
}

export function buildRecentActivityQuery(parts: TodayParts): string {
  const where = partitionWhere(parts);
  const union = [
    `SELECT 'hackernews' AS source, title AS label, ingested_at FROM hackernews_stories ${where}`,
    `SELECT 'news' AS source, title AS label, ingested_at FROM news_articles ${where}`,
    `SELECT 'weather' AS source, location AS label, ingested_at FROM weather_observations ${where}`,
    `SELECT 'crypto' AS source, coin_id AS label, ingested_at FROM crypto_prices ${where}`,
    `SELECT 'github' AS source, full_name AS label, ingested_at FROM github_repos ${where}`,
  ].join("\nUNION ALL\n");
  return `SELECT * FROM (\n${union}\n) ORDER BY ingested_at DESC LIMIT 5`;
}

export type AthenaResultRow = { Data?: Array<{ VarCharValue?: string }> };

export function parseAthenaRows<T>(
  rows: AthenaResultRow[],
  mapRow: (cols: (string | null)[]) => T
): T[] {
  return rows.slice(1).map((row) => mapRow((row.Data ?? []).map((cell) => cell.VarCharValue ?? null)));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runAthenaQuery(client: AthenaClient, sql: string): Promise<AthenaResultRow[]> {
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

  for (let attempt = 0; attempt < 20; attempt++) {
    const status = await client.send(new GetQueryExecutionCommand({ QueryExecutionId: queryExecutionId }));
    const state = status.QueryExecution?.Status?.State;
    if (state === "SUCCEEDED") break;
    if (state === "FAILED" || state === "CANCELLED") {
      const reason = status.QueryExecution?.Status?.StateChangeReason ?? "unknown reason";
      throw new Error(`Athena query ${state.toLowerCase()}: ${reason}`);
    }
    await sleep(300);
  }

  const results = await client.send(new GetQueryResultsCommand({ QueryExecutionId: queryExecutionId }));
  return (results.ResultSet?.Rows ?? []) as AthenaResultRow[];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run lib/athena.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add web/lib/athena.ts web/lib/athena.test.ts
git commit -m "Add Athena query builders, row parser, and query runner"
```

---

### Task 3: AWS client singletons (`lib/aws.ts`)

**Files:**
- Create: `web/lib/aws.ts`
- Test: `web/lib/aws.test.ts`

**Interfaces:**
- Produces: `requiredEnv(name: string): string`, `getAthenaClient(): AthenaClient`, `getLambdaClient(): LambdaClient`, `getCloudWatchClient(): CloudWatchClient` — consumed by Tasks 4 and 7.

- [ ] **Step 1: Write the failing test**

```ts
// web/lib/aws.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { requiredEnv } from "./aws";

describe("requiredEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the value when set", () => {
    vi.stubEnv("AWS_REGION", "us-east-1");
    expect(requiredEnv("AWS_REGION")).toBe("us-east-1");
  });

  it("throws a clear error when missing", () => {
    vi.stubEnv("SOME_MISSING_VAR", "");
    expect(() => requiredEnv("SOME_MISSING_VAR")).toThrow(
      "Missing required environment variable: SOME_MISSING_VAR"
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run lib/aws.test.ts`
Expected: FAIL — `requiredEnv` is not exported.

- [ ] **Step 3: Write the implementation**

```ts
// web/lib/aws.ts
import { AthenaClient } from "@aws-sdk/client-athena";
import { LambdaClient } from "@aws-sdk/client-lambda";
import { CloudWatchClient } from "@aws-sdk/client-cloudwatch";

export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

let athenaClient: AthenaClient | undefined;
export function getAthenaClient(): AthenaClient {
  if (!athenaClient) athenaClient = new AthenaClient({ region: requiredEnv("AWS_REGION") });
  return athenaClient;
}

let lambdaClient: LambdaClient | undefined;
export function getLambdaClient(): LambdaClient {
  if (!lambdaClient) lambdaClient = new LambdaClient({ region: requiredEnv("AWS_REGION") });
  return lambdaClient;
}

let cloudWatchClient: CloudWatchClient | undefined;
export function getCloudWatchClient(): CloudWatchClient {
  if (!cloudWatchClient) cloudWatchClient = new CloudWatchClient({ region: requiredEnv("AWS_REGION") });
  return cloudWatchClient;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run lib/aws.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add web/lib/aws.ts web/lib/aws.test.ts
git commit -m "Add AWS SDK client singletons and requiredEnv helper"
```

---

### Task 4: Dashboard types + API route (`app/api/dashboard/route.ts`)

**Files:**
- Create: `web/lib/types.ts`
- Create: `web/app/api/dashboard/route.ts`
- Test: `web/app/api/dashboard/route.test.ts`

**Interfaces:**
- Consumes: `getAthenaClient`, `getCloudWatchClient`, `requiredEnv` (Task 3); `runAthenaQuery`, `todayUtcParts`, `buildSourceVolumeQuery`, `buildRecentActivityQuery`, `parseAthenaRows` (Task 2).
- Produces: `type SourceVolume = { source: string; records: number }`, `type ActivityItem = { source: string; label: string; ingestedAt: string }`, `type DashboardResponse = { recordsToday: number; sourceVolumes: SourceVolume[]; sourcesHealthy: number; sourcesTotal: number; alarmsBreaching: number; alarmsTotal: number; costEstimateUsd: number; recentActivity: ActivityItem[] }` — consumed by Tasks 8 and 9. `GET /api/dashboard` → 200 `DashboardResponse` | 500 `{ error: string }`.

- [ ] **Step 1: Write `web/lib/types.ts`**

```ts
export type SourceVolume = { source: string; records: number };
export type ActivityItem = { source: string; label: string; ingestedAt: string };

export type DashboardResponse = {
  recordsToday: number;
  sourceVolumes: SourceVolume[];
  sourcesHealthy: number;
  sourcesTotal: number;
  alarmsBreaching: number;
  alarmsTotal: number;
  costEstimateUsd: number;
  recentActivity: ActivityItem[];
};
```

- [ ] **Step 2: Write the failing test**

```ts
// web/app/api/dashboard/route.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/aws", () => ({
  getAthenaClient: vi.fn(() => ({})),
  getCloudWatchClient: vi.fn(() => ({
    send: vi.fn().mockResolvedValue({
      MetricAlarms: [
        { StateValue: "OK" },
        { StateValue: "OK" },
        { StateValue: "ALARM" },
      ],
    }),
  })),
  requiredEnv: vi.fn((name: string) => {
    if (name === "ALARM_NAME_PREFIX") return "realtime-data-pipeline-dev";
    throw new Error(`unexpected requiredEnv(${name})`);
  }),
}));

vi.mock("@/lib/athena", async () => {
  const actual = await vi.importActual<typeof import("@/lib/athena")>("@/lib/athena");
  return {
    ...actual,
    runAthenaQuery: vi.fn(),
  };
});

import { runAthenaQuery } from "@/lib/athena";
import { GET } from "./route";

const mockedRun = vi.mocked(runAthenaQuery);

beforeEach(() => {
  mockedRun.mockReset();
});

describe("GET /api/dashboard", () => {
  it("returns aggregated dashboard data", async () => {
    mockedRun
      .mockResolvedValueOnce([
        { Data: [{ VarCharValue: "source" }, { VarCharValue: "records" }] },
        { Data: [{ VarCharValue: "hackernews" }, { VarCharValue: "612" }] },
        { Data: [{ VarCharValue: "news" }, { VarCharValue: "0" }] },
      ])
      .mockResolvedValueOnce([
        { Data: [{ VarCharValue: "source" }, { VarCharValue: "label" }, { VarCharValue: "ingested_at" }] },
        { Data: [{ VarCharValue: "hackernews" }, { VarCharValue: "Some title" }, { VarCharValue: "2026-09-19T10:00:00Z" }] },
      ]);

    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.recordsToday).toBe(612);
    expect(body.sourcesHealthy).toBe(1);
    expect(body.sourcesTotal).toBe(5);
    expect(body.alarmsBreaching).toBe(1);
    expect(body.alarmsTotal).toBe(3);
    expect(body.costEstimateUsd).toBe(1.02);
    expect(body.recentActivity).toHaveLength(1);
  });

  it("returns 500 with a safe message when Athena fails", async () => {
    mockedRun.mockRejectedValueOnce(new Error("Athena query failed: table not found"));

    const response = await GET();
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("Không tải được dữ liệu dashboard, thử lại sau.");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd web && npx vitest run app/api/dashboard/route.test.ts`
Expected: FAIL — `./route` has no module.

- [ ] **Step 4: Write the implementation**

```ts
// web/app/api/dashboard/route.ts
import { NextResponse } from "next/server";
import { DescribeAlarmsCommand } from "@aws-sdk/client-cloudwatch";
import { getAthenaClient, getCloudWatchClient, requiredEnv } from "@/lib/aws";
import {
  runAthenaQuery,
  todayUtcParts,
  buildSourceVolumeQuery,
  buildRecentActivityQuery,
  parseAthenaRows,
} from "@/lib/athena";
import type { DashboardResponse, SourceVolume, ActivityItem } from "@/lib/types";

export const revalidate = 60;

const COST_ESTIMATE_USD = 1.02;
const SOURCES_TOTAL = 5;

export async function GET() {
  try {
    const parts = todayUtcParts();
    const athena = getAthenaClient();

    const [volumeRows, activityRows] = await Promise.all([
      runAthenaQuery(athena, buildSourceVolumeQuery(parts)),
      runAthenaQuery(athena, buildRecentActivityQuery(parts)),
    ]);

    const sourceVolumes: SourceVolume[] = parseAthenaRows(volumeRows, (cols) => ({
      source: cols[0] ?? "",
      records: Number(cols[1] ?? 0),
    }));
    const recentActivity: ActivityItem[] = parseAthenaRows(activityRows, (cols) => ({
      source: cols[0] ?? "",
      label: cols[1] ?? "",
      ingestedAt: cols[2] ?? "",
    }));

    const recordsToday = sourceVolumes.reduce((sum, s) => sum + s.records, 0);
    const sourcesHealthy = sourceVolumes.filter((s) => s.records > 0).length;

    const alarms = await getCloudWatchClient().send(
      new DescribeAlarmsCommand({ AlarmNamePrefix: requiredEnv("ALARM_NAME_PREFIX") })
    );
    const alarmsTotal = alarms.MetricAlarms?.length ?? 0;
    const alarmsBreaching = alarms.MetricAlarms?.filter((a) => a.StateValue === "ALARM").length ?? 0;

    const response: DashboardResponse = {
      recordsToday,
      sourceVolumes,
      sourcesHealthy,
      sourcesTotal: SOURCES_TOTAL,
      alarmsBreaching,
      alarmsTotal,
      costEstimateUsd: COST_ESTIMATE_USD,
      recentActivity,
    };
    return NextResponse.json(response);
  } catch (error) {
    console.error("Dashboard API failed", error);
    return NextResponse.json(
      { error: "Không tải được dữ liệu dashboard, thử lại sau." },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd web && npx vitest run app/api/dashboard/route.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add web/lib/types.ts web/app/api/dashboard/
git commit -m "Add dashboard API route backed by real Athena + CloudWatch data"
```

---

### Task 5: Rate limiter (`lib/ratelimit.ts`)

**Files:**
- Create: `web/lib/ratelimit.ts`
- Test: `web/lib/ratelimit.test.ts`

**Interfaces:**
- Consumes: `requiredEnv` (Task 3).
- Produces: `type RateLimitResult = { allowed: boolean; remaining: number }`, `checkRateLimit(identifier: string, limiter?: Ratelimit): Promise<RateLimitResult>` — consumed by Task 7.

- [ ] **Step 1: Write the failing test**

```ts
// web/lib/ratelimit.test.ts
import { describe, expect, it, vi } from "vitest";
import type { Ratelimit } from "@upstash/ratelimit";
import { checkRateLimit } from "./ratelimit";

function fakeLimiter(success: boolean, remaining: number): Ratelimit {
  return { limit: vi.fn().mockResolvedValue({ success, remaining }) } as unknown as Ratelimit;
}

describe("checkRateLimit", () => {
  it("returns allowed:true under the limit", async () => {
    const result = await checkRateLimit("1.2.3.4", fakeLimiter(true, 4));
    expect(result).toEqual({ allowed: true, remaining: 4 });
  });

  it("returns allowed:false over the limit", async () => {
    const result = await checkRateLimit("1.2.3.4", fakeLimiter(false, 0));
    expect(result).toEqual({ allowed: false, remaining: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run lib/ratelimit.test.ts`
Expected: FAIL — `checkRateLimit` is not exported.

- [ ] **Step 3: Write the implementation**

```ts
// web/lib/ratelimit.ts
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { requiredEnv } from "@/lib/aws";

let defaultLimiter: Ratelimit | undefined;
function getDefaultLimiter(): Ratelimit {
  if (!defaultLimiter) {
    const redis = new Redis({
      url: requiredEnv("UPSTASH_REDIS_REST_URL"),
      token: requiredEnv("UPSTASH_REDIS_REST_TOKEN"),
    });
    defaultLimiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(5, "1 m"),
      prefix: "assistant-ratelimit",
    });
  }
  return defaultLimiter;
}

export type RateLimitResult = { allowed: boolean; remaining: number };

export async function checkRateLimit(
  identifier: string,
  limiter: Ratelimit = getDefaultLimiter()
): Promise<RateLimitResult> {
  const { success, remaining } = await limiter.limit(identifier);
  return { allowed: success, remaining };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run lib/ratelimit.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add web/lib/ratelimit.ts web/lib/ratelimit.test.ts
git commit -m "Add Upstash sliding-window rate limiter for the assistant endpoint"
```

---

### Task 6: Assistant result normalizer (`lib/assistant.ts`)

**Files:**
- Create: `web/lib/assistant.ts`
- Test: `web/lib/assistant.test.ts`

**Interfaces:**
- Consumes: nothing (pure module).
- Produces: `type AssistantMode = "crag" | "agent"`, `type AssistantSource = { title: string; url: string; source: string; score?: number | null; grade?: string }`, `type AssistantResult = { mode: AssistantMode; question: string; answer: string; grounded: boolean; sources: AssistantSource[]; cragDetail?: { answerSource: string; discarded: Array<{ title: string; grade: string }> }; agentDetail?: { toolCalls: unknown[] } }`, `normalizeAssistantResult(mode: AssistantMode, raw: unknown): AssistantResult` — consumed by Tasks 7, 10, 11.

- [ ] **Step 1: Write the failing test**

```ts
// web/lib/assistant.test.ts
import { describe, expect, it } from "vitest";
import { normalizeAssistantResult } from "./assistant";

describe("normalizeAssistantResult", () => {
  it("normalizes a rag_query (CRAG) payload", () => {
    const raw = {
      statusCode: 200,
      question: "Xu hướng AI agent tuần này?",
      answer: "HN thảo luận nhiều về tool-calling agent.",
      grounded: true,
      answer_source: "local_knowledge_base",
      sources: [{ title: "Building a tool-calling agent loop", url: "https://hn/1", source: "hackernews", score: 0.83, grade: "relevant" }],
      discarded_low_relevance: [{ title: "Unrelated story", grade: "irrelevant" }],
    };

    const result = normalizeAssistantResult("crag", raw);

    expect(result.mode).toBe("crag");
    expect(result.answer).toBe(raw.answer);
    expect(result.grounded).toBe(true);
    expect(result.sources).toEqual(raw.sources);
    expect(result.cragDetail).toEqual({
      answerSource: "local_knowledge_base",
      discarded: [{ title: "Unrelated story", grade: "irrelevant" }],
    });
    expect(result.agentDetail).toBeUndefined();
  });

  it("normalizes a rag_agent payload", () => {
    const raw = {
      statusCode: 200,
      question: "Xu hướng AI agent tuần này?",
      answer: "Agent tự tra cứu và trả lời.",
      grounded: true,
      tool_calls: [{ tool: "search_knowledge_base", input: { query: "AI agent" }, result_count: 4 }],
      sources: [{ title: "agent-loop-examples", url: "https://gh/1", source: "github" }],
    };

    const result = normalizeAssistantResult("agent", raw);

    expect(result.mode).toBe("agent");
    expect(result.sources).toEqual(raw.sources);
    expect(result.agentDetail).toEqual({ toolCalls: raw.tool_calls });
    expect(result.cragDetail).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run lib/assistant.test.ts`
Expected: FAIL — `normalizeAssistantResult` is not exported.

- [ ] **Step 3: Write the implementation**

```ts
// web/lib/assistant.ts
export type AssistantMode = "crag" | "agent";

export type AssistantSource = {
  title: string;
  url: string;
  source: string;
  score?: number | null;
  grade?: string;
};

export type AssistantResult = {
  mode: AssistantMode;
  question: string;
  answer: string;
  grounded: boolean;
  sources: AssistantSource[];
  cragDetail?: { answerSource: string; discarded: Array<{ title: string; grade: string }> };
  agentDetail?: { toolCalls: unknown[] };
};

type RawCragPayload = {
  question: string;
  answer: string;
  grounded: boolean;
  answer_source: string;
  sources: AssistantSource[];
  discarded_low_relevance: Array<{ title: string; grade: string }>;
};

type RawAgentPayload = {
  question: string;
  answer: string;
  grounded: boolean;
  tool_calls: unknown[];
  sources: AssistantSource[];
};

export function normalizeAssistantResult(mode: AssistantMode, raw: unknown): AssistantResult {
  const base = raw as { question: string; answer: string; grounded: boolean; sources: AssistantSource[] };
  const shared = {
    mode,
    question: base.question,
    answer: base.answer,
    grounded: base.grounded,
    sources: base.sources,
  };
  if (mode === "crag") {
    const cragRaw = raw as RawCragPayload;
    return {
      ...shared,
      cragDetail: { answerSource: cragRaw.answer_source, discarded: cragRaw.discarded_low_relevance },
    };
  }
  const agentRaw = raw as RawAgentPayload;
  return { ...shared, agentDetail: { toolCalls: agentRaw.tool_calls } };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run lib/assistant.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add web/lib/assistant.ts web/lib/assistant.test.ts
git commit -m "Add normalizer unifying rag_query and rag_agent Lambda payload shapes"
```

---

### Task 7: Assistant API route (`app/api/assistant/route.ts`)

**Files:**
- Create: `web/app/api/assistant/route.ts`
- Test: `web/app/api/assistant/route.test.ts`

**Interfaces:**
- Consumes: `getLambdaClient`, `requiredEnv` (Task 3); `checkRateLimit` (Task 5); `normalizeAssistantResult`, `AssistantMode` (Task 6).
- Produces: `POST /api/assistant` with body `{ question: string, mode: "crag" | "agent" }` → 200 `AssistantResult` | 400 `{error}` | 429 `{error}` | 502 `{error}` | 500 `{error}` — consumed by Task 11.

- [ ] **Step 1: Write the failing test**

```ts
// web/app/api/assistant/route.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/aws", () => ({
  getLambdaClient: vi.fn(),
  requiredEnv: vi.fn((name: string) => {
    if (name === "RAG_QUERY_FUNCTION_NAME") return "realtime-data-pipeline-dev-rag-query";
    if (name === "RAG_AGENT_FUNCTION_NAME") return "realtime-data-pipeline-dev-rag-agent";
    throw new Error(`unexpected requiredEnv(${name})`);
  }),
}));
vi.mock("@/lib/ratelimit", () => ({ checkRateLimit: vi.fn() }));

import { getLambdaClient } from "@/lib/aws";
import { checkRateLimit } from "@/lib/ratelimit";
import { POST } from "./route";

const mockedGetLambdaClient = vi.mocked(getLambdaClient);
const mockedCheckRateLimit = vi.mocked(checkRateLimit);

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/assistant", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", "x-forwarded-for": "9.9.9.9" },
  });
}

beforeEach(() => {
  mockedCheckRateLimit.mockReset();
  mockedGetLambdaClient.mockReset();
});

describe("POST /api/assistant", () => {
  it("returns 400 for a missing question", async () => {
    const response = await POST(makeRequest({ mode: "crag" }));
    expect(response.status).toBe(400);
  });

  it("returns 429 when rate limited", async () => {
    mockedCheckRateLimit.mockResolvedValue({ allowed: false, remaining: 0 });
    const response = await POST(makeRequest({ question: "hi", mode: "crag" }));
    expect(response.status).toBe(429);
    expect(mockedGetLambdaClient).not.toHaveBeenCalled();
  });

  it("returns the normalized result on success", async () => {
    mockedCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 4 });
    const payload = {
      statusCode: 200,
      question: "hi",
      answer: "answer text",
      grounded: true,
      answer_source: "local_knowledge_base",
      sources: [],
      discarded_low_relevance: [],
    };
    mockedGetLambdaClient.mockReturnValue({
      send: vi.fn().mockResolvedValue({ Payload: Buffer.from(JSON.stringify(payload)) }),
    } as never);

    const response = await POST(makeRequest({ question: "hi", mode: "crag" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.answer).toBe("answer text");
    expect(body.cragDetail.answerSource).toBe("local_knowledge_base");
  });

  it("returns 502 when the Lambda itself reports an error", async () => {
    mockedCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 4 });
    mockedGetLambdaClient.mockReturnValue({
      send: vi.fn().mockResolvedValue({
        Payload: Buffer.from(JSON.stringify({ statusCode: 400, error: "Missing 'question' in event" })),
      }),
    } as never);

    const response = await POST(makeRequest({ question: "hi", mode: "crag" }));
    expect(response.status).toBe(502);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run app/api/assistant/route.test.ts`
Expected: FAIL — `./route` has no module.

- [ ] **Step 3: Write the implementation**

```ts
// web/app/api/assistant/route.ts
import { NextRequest, NextResponse } from "next/server";
import { InvokeCommand } from "@aws-sdk/client-lambda";
import { getLambdaClient, requiredEnv } from "@/lib/aws";
import { checkRateLimit } from "@/lib/ratelimit";
import { normalizeAssistantResult, type AssistantMode } from "@/lib/assistant";

function clientIp(request: NextRequest): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  const mode = body?.mode as AssistantMode;

  if (!question || (mode !== "crag" && mode !== "agent")) {
    return NextResponse.json({ error: "Thiếu 'question' hoặc 'mode' không hợp lệ." }, { status: 400 });
  }

  const rateLimit = await checkRateLimit(clientIp(request));
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: "Đợi một chút rồi hỏi tiếp." }, { status: 429 });
  }

  const functionName = requiredEnv(
    mode === "crag" ? "RAG_QUERY_FUNCTION_NAME" : "RAG_AGENT_FUNCTION_NAME"
  );

  try {
    const response = await getLambdaClient().send(
      new InvokeCommand({ FunctionName: functionName, Payload: Buffer.from(JSON.stringify({ question })) })
    );
    const payload = JSON.parse(Buffer.from(response.Payload ?? new Uint8Array()).toString("utf-8"));
    if (payload.statusCode !== 200) {
      return NextResponse.json({ error: payload.error ?? "Lambda trả lỗi." }, { status: 502 });
    }
    return NextResponse.json(normalizeAssistantResult(mode, payload));
  } catch (error) {
    console.error("Assistant API failed", error);
    return NextResponse.json({ error: "Không gọi được RAG Lambda, thử lại sau." }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run app/api/assistant/route.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add web/app/api/assistant/
git commit -m "Add rate-limited assistant API route invoking rag_query/rag_agent"
```

---

### Task 8: Dashboard presentational components

**Files:**
- Create: `web/components/KpiCard.tsx`, `web/components/SourceVolumeChart.tsx`, `web/components/ActivityFeed.tsx`

**Interfaces:**
- Consumes: `SourceVolume`, `ActivityItem` (Task 4).
- Produces: `<KpiCard label value hint? hintColor?>`, `<SourceVolumeChart sourceVolumes>`, `<ActivityFeed items>` — consumed by Task 9.

- [ ] **Step 1: Write `web/components/KpiCard.tsx`**

```tsx
type KpiCardProps = {
  label: string;
  value: string;
  hint?: string;
  hintColor?: "success" | "muted";
};

export function KpiCard({ label, value, hint, hintColor = "muted" }: KpiCardProps) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5 flex flex-col gap-2">
      <span className="text-xs text-textSecondary">{label}</span>
      <span className="font-mono text-2xl text-textPrimary">{value}</span>
      {hint && (
        <span className={`text-xs ${hintColor === "success" ? "text-success" : "text-textMuted"}`}>
          {hint}
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Write `web/components/SourceVolumeChart.tsx`**

```tsx
import type { SourceVolume } from "@/lib/types";

const LABELS: Record<string, string> = {
  hackernews: "HackerNews",
  news: "News API",
  weather: "Weather",
  crypto: "Crypto",
  github: "GitHub",
};

export function SourceVolumeChart({ sourceVolumes }: { sourceVolumes: SourceVolume[] }) {
  const max = Math.max(1, ...sourceVolumes.map((s) => s.records));
  return (
    <div className="rounded-2xl border border-border bg-surface p-6 flex flex-col gap-4">
      <span className="text-sm font-semibold text-textPrimary">Khối lượng theo nguồn (hôm nay)</span>
      <div className="flex items-end gap-6 h-40">
        {sourceVolumes.map((s) => (
          <div key={s.source} className="flex flex-col items-center gap-2 flex-1">
            <span className="font-mono text-xs text-textSecondary">{s.records}</span>
            <div
              className="w-full rounded-t bg-accent"
              style={{ height: `${(s.records / max) * 100}%` }}
            />
            <span className="text-xs text-textMuted">{LABELS[s.source] ?? s.source}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Write `web/components/ActivityFeed.tsx`**

```tsx
import type { ActivityItem } from "@/lib/types";

export function ActivityFeed({ items }: { items: ActivityItem[] }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-6 flex flex-col gap-3">
      <span className="text-sm font-semibold text-textPrimary">Hoạt động gần đây</span>
      {items.length === 0 && <span className="text-xs text-textMuted">Chưa có bản ghi hôm nay.</span>}
      {items.map((item, i) => (
        <div key={i} className="flex gap-2 items-start text-xs text-textSecondary">
          <span className="w-2 h-2 mt-1 rounded-full bg-accent flex-shrink-0" />
          <span>
            <span className="text-textMuted">[{item.source}]</span> {item.label}
          </span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add web/components/KpiCard.tsx web/components/SourceVolumeChart.tsx web/components/ActivityFeed.tsx
git commit -m "Add dashboard presentational components"
```

---

### Task 9: Dashboard page (`app/page.tsx`)

**Files:**
- Modify: `web/app/page.tsx`

**Interfaces:**
- Consumes: `DashboardResponse` (Task 4), `KpiCard`, `SourceVolumeChart`, `ActivityFeed` (Task 8), `GET /api/dashboard` (Task 4).

- [ ] **Step 1: Replace the placeholder with the real page**

```tsx
// web/app/page.tsx
"use client";

import { useEffect, useState } from "react";
import { KpiCard } from "@/components/KpiCard";
import { SourceVolumeChart } from "@/components/SourceVolumeChart";
import { ActivityFeed } from "@/components/ActivityFeed";
import type { DashboardResponse } from "@/lib/types";

export default function DashboardPage() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const res = await fetch("/api/dashboard");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Không tải được dashboard.");
      setData(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tải được dashboard.");
    }
  }

  useEffect(() => {
    load();
  }, []);

  if (error) {
    return (
      <div className="p-9 flex flex-col gap-4">
        <p className="text-error text-sm">{error}</p>
        <button
          onClick={load}
          className="w-fit rounded-lg border border-border px-4 py-2 text-sm text-textPrimary"
        >
          Thử lại
        </button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-9 grid grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 rounded-2xl border border-border bg-surface animate-pulse" />
        ))}
      </div>
    );
  }

  const allHealthy = data.sourcesHealthy === data.sourcesTotal;

  return (
    <div className="p-9 flex flex-col gap-5">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-textPrimary">Tổng quan hệ thống</h1>
      </div>
      <div className="grid grid-cols-4 gap-4">
        <KpiCard label="Bản ghi hôm nay" value={String(data.recordsToday)} />
        <KpiCard
          label="Nguồn hoạt động"
          value={`${data.sourcesHealthy} / ${data.sourcesTotal}`}
          hint={allHealthy ? "Tất cả healthy" : "Có nguồn chưa ghi hôm nay"}
          hintColor={allHealthy ? "success" : "muted"}
        />
        <KpiCard
          label="Cảnh báo đang bật"
          value={String(data.alarmsBreaching)}
          hint={`trong ${data.alarmsTotal} alarm`}
        />
        <KpiCard label="Chi phí ước tính" value={`$${data.costEstimateUsd.toFixed(2)}`} hint="tháng này" />
      </div>
      <div className="grid grid-cols-[1.4fr_1fr] gap-4">
        <SourceVolumeChart sourceVolumes={data.sourceVolumes} />
        <ActivityFeed items={data.recentActivity} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck and build**

Run: `cd web && npx tsc --noEmit && npm run build`
Expected: no errors, build succeeds.

- [ ] **Step 3: Manual verification against real AWS**

This screen has no automated test (per spec §7) — verify it live instead:

Run: `cd web && AWS_ACCESS_KEY_ID=<from Task 12> AWS_SECRET_ACCESS_KEY=<from Task 12> AWS_REGION=us-east-1 ATHENA_WORKGROUP=realtime-data-pipeline-dev-analytics ATHENA_DATABASE=realtime_data_pipeline_dev_curated ALARM_NAME_PREFIX=realtime-data-pipeline-dev npm run dev`

Open `http://localhost:3000`, confirm the KPI numbers and per-source bars match a manual Athena query for today's partition (`sql/sample_queries.sql` #5), and that the alarm count matches `aws cloudwatch describe-alarms --alarm-name-prefix realtime-data-pipeline-dev`.

- [ ] **Step 4: Commit**

```bash
git add web/app/page.tsx
git commit -m "Wire the Dashboard page to live Athena + CloudWatch data"
```

---

### Task 10: Assistant presentational components

**Files:**
- Create: `web/components/ModeToggle.tsx`, `web/components/ChatThread.tsx`, `web/components/ToolTrace.tsx`

**Interfaces:**
- Consumes: `AssistantMode`, `AssistantResult` (Task 6).
- Produces: `<ModeToggle mode onChange>`, `<ChatThread question result loading>`, `<ToolTrace result>` — consumed by Task 11.

- [ ] **Step 1: Write `web/components/ModeToggle.tsx`**

```tsx
import type { AssistantMode } from "@/lib/assistant";

export function ModeToggle({
  mode,
  onChange,
}: {
  mode: AssistantMode;
  onChange: (mode: AssistantMode) => void;
}) {
  const base = "rounded-full px-4 py-2 text-sm font-semibold border";
  const active = "bg-accent/10 text-accent border-accent";
  const inactive = "border-border text-textSecondary";
  return (
    <div className="flex gap-2">
      <button onClick={() => onChange("crag")} className={`${base} ${mode === "crag" ? active : inactive}`}>
        Pipeline CRAG (cố định)
      </button>
      <button onClick={() => onChange("agent")} className={`${base} ${mode === "agent" ? active : inactive}`}>
        Tool-calling Agent
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Write `web/components/ChatThread.tsx`**

```tsx
import type { AssistantResult } from "@/lib/assistant";

export function ChatThread({
  question,
  result,
  loading,
}: {
  question: string | null;
  result: AssistantResult | null;
  loading: boolean;
}) {
  if (!question) {
    return <p className="text-sm text-textMuted">Đặt câu hỏi về dữ liệu đã ingest để bắt đầu.</p>;
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <div className="max-w-[70%] rounded-2xl rounded-br-sm bg-[#1B2540] px-4 py-3">
          <span className="text-sm text-textPrimary">{question}</span>
        </div>
      </div>
      {loading && <span className="text-xs text-textMuted">Đang xử lý…</span>}
      {result && (
        <div className="flex justify-start">
          <div className="max-w-[80%] rounded-2xl rounded-bl-sm border border-border bg-[#0F1728] px-4 py-3 flex flex-col gap-3">
            <span className="text-sm leading-relaxed text-textSecondary">{result.answer}</span>
            <div className="flex flex-wrap gap-2">
              {result.sources.map((s, i) => (
                <span key={i} className="font-mono text-[10.5px] text-accent bg-accent/10 rounded px-2 py-1">
                  {s.source} · {s.title}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Write `web/components/ToolTrace.tsx`**

```tsx
import type { AssistantResult } from "@/lib/assistant";

export function ToolTrace({ result }: { result: AssistantResult | null }) {
  if (!result) return null;

  if (result.cragDetail) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-5 flex flex-col gap-3">
        <span className="text-xs font-semibold text-textPrimary">Fixed pipeline steps</span>
        <span className="font-mono text-xs text-textSecondary">1. Embed câu hỏi (Titan Embed)</span>
        <span className="font-mono text-xs text-textSecondary">
          2. Grade (Claude Haiku) → {result.grounded ? "relevant" : "irrelevant/ambiguous"}
        </span>
        <span className="font-mono text-xs text-textSecondary">
          3. Trả lời từ {result.cragDetail.answerSource}
        </span>
      </div>
    );
  }

  if (result.agentDetail) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-5 flex flex-col gap-3">
        <span className="text-xs font-semibold text-textPrimary">Tool trace (agent tự quyết định)</span>
        {result.agentDetail.toolCalls.map((call, i) => (
          <span key={i} className="font-mono text-xs text-textSecondary">
            {JSON.stringify(call)}
          </span>
        ))}
      </div>
    );
  }

  return null;
}
```

- [ ] **Step 4: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add web/components/ModeToggle.tsx web/components/ChatThread.tsx web/components/ToolTrace.tsx
git commit -m "Add RAG Assistant presentational components"
```

---

### Task 11: Assistant page (`app/assistant/page.tsx`)

**Files:**
- Create: `web/app/assistant/page.tsx`

**Interfaces:**
- Consumes: `AssistantMode`, `AssistantResult` (Task 6), `ModeToggle`, `ChatThread`, `ToolTrace` (Task 10), `POST /api/assistant` (Task 7).

- [ ] **Step 1: Write the page**

```tsx
// web/app/assistant/page.tsx
"use client";

import { useState } from "react";
import { ModeToggle } from "@/components/ModeToggle";
import { ChatThread } from "@/components/ChatThread";
import { ToolTrace } from "@/components/ToolTrace";
import type { AssistantMode, AssistantResult } from "@/lib/assistant";

export default function AssistantPage() {
  const [mode, setMode] = useState<AssistantMode>("crag");
  const [input, setInput] = useState("");
  const [question, setQuestion] = useState<string | null>(null);
  const [result, setResult] = useState<AssistantResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit() {
    const trimmed = input.trim();
    if (!trimmed || loading) return;
    setQuestion(trimmed);
    setResult(null);
    setNotice(null);
    setLoading(true);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: trimmed, mode }),
      });
      const body = await res.json();
      if (res.status === 429) {
        setNotice(body.error ?? "Đợi một chút rồi hỏi tiếp.");
      } else if (!res.ok) {
        setNotice(body.error ?? "Không gọi được RAG Lambda.");
      } else {
        setResult(body as AssistantResult);
      }
    } catch {
      setNotice("Không gọi được RAG Lambda, thử lại sau.");
    } finally {
      setLoading(false);
      setInput("");
    }
  }

  return (
    <div className="p-9 flex flex-col gap-5">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-textPrimary">RAG Assistant</h1>
      </div>
      <ModeToggle mode={mode} onChange={setMode} />
      <div className="grid grid-cols-[1.5fr_1fr] gap-5">
        <div className="rounded-2xl border border-border bg-surface p-6 flex flex-col gap-4">
          <ChatThread question={question} result={result} loading={loading} />
          {notice && <p className="text-xs text-warning">{notice}</p>}
          <div className="mt-auto flex gap-2 items-center border border-border rounded-xl px-3 py-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder="Đặt câu hỏi về dữ liệu đã ingest…"
              className="flex-grow bg-transparent text-sm text-textPrimary outline-none placeholder:text-textMuted"
              disabled={loading}
            />
            <button
              onClick={submit}
              disabled={loading}
              className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-bg disabled:opacity-50"
            >
              Gửi
            </button>
          </div>
        </div>
        <ToolTrace result={result} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck and build**

Run: `cd web && npx tsc --noEmit && npm run build`
Expected: no errors, build succeeds.

- [ ] **Step 3: Manual verification against real AWS**

Run: `cd web && AWS_ACCESS_KEY_ID=<from Task 12> AWS_SECRET_ACCESS_KEY=<from Task 12> AWS_REGION=us-east-1 RAG_QUERY_FUNCTION_NAME=realtime-data-pipeline-dev-rag-query RAG_AGENT_FUNCTION_NAME=realtime-data-pipeline-dev-rag-agent UPSTASH_REDIS_REST_URL=<from Task 12> UPSTASH_REDIS_REST_TOKEN=<from Task 12> npm run dev`

Open `http://localhost:3000/assistant`, ask a real question in CRAG mode, confirm a real Bedrock-backed answer with sources; switch to Agent mode and repeat; submit 6 rapid questions and confirm the 6th shows the rate-limit notice.

- [ ] **Step 4: Commit**

```bash
git add web/app/assistant/
git commit -m "Wire the RAG Assistant page to live rag_query/rag_agent Lambdas"
```

---

### Task 12: Terraform IAM + Vercel deployment

**Files:**
- Create: `infra/web_access.tf`
- Modify: `infra/outputs.tf`

**Interfaces:**
- Consumes: `data.aws_caller_identity.current`, `var.aws_region`, `aws_athena_workgroup.main`, `aws_glue_catalog_database.curated`, `aws_s3_bucket.curated`, `aws_lambda_function.rag_query`, `aws_lambda_function.rag_agent` (all existing).
- Produces: `web_app_access_key_id`, `web_app_secret_access_key` (sensitive) Terraform outputs — used to configure Vercel env vars.

- [ ] **Step 1: Write `infra/web_access.tf`**

```hcl
resource "aws_iam_user" "web_app" {
  name = "${local.name_prefix}-web-app"
}

resource "aws_iam_user_policy" "web_app" {
  name = "${local.name_prefix}-web-app-policy"
  user = aws_iam_user.web_app.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AthenaQuery"
        Effect = "Allow"
        Action = [
          "athena:StartQueryExecution",
          "athena:GetQueryExecution",
          "athena:GetQueryResults",
          "athena:StopQueryExecution",
          "athena:GetWorkGroup",
        ]
        Resource = aws_athena_workgroup.main.arn
      },
      {
        Sid    = "GlueReadCuratedDatabase"
        Effect = "Allow"
        Action = ["glue:GetTable", "glue:GetDatabase", "glue:GetPartitions"]
        Resource = [
          "arn:aws:glue:${var.aws_region}:${data.aws_caller_identity.current.account_id}:catalog",
          "arn:aws:glue:${var.aws_region}:${data.aws_caller_identity.current.account_id}:database/${aws_glue_catalog_database.curated.name}",
          "arn:aws:glue:${var.aws_region}:${data.aws_caller_identity.current.account_id}:table/${aws_glue_catalog_database.curated.name}/*",
        ]
      },
      {
        Sid      = "S3ReadCuratedData"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:ListBucket", "s3:GetBucketLocation"]
        Resource = [aws_s3_bucket.curated.arn, "${aws_s3_bucket.curated.arn}/*"]
      },
      {
        Sid      = "S3AthenaResults"
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:GetObject"]
        Resource = "${aws_s3_bucket.curated.arn}/athena-results/*"
      },
      {
        Sid      = "CloudWatchAlarmsReadOnly"
        Effect   = "Allow"
        Action   = ["cloudwatch:DescribeAlarms"]
        Resource = "*"
      },
      {
        Sid      = "InvokeRagLambdas"
        Effect   = "Allow"
        Action   = ["lambda:InvokeFunction"]
        Resource = [aws_lambda_function.rag_query.arn, aws_lambda_function.rag_agent.arn]
      },
    ]
  })
}

resource "aws_iam_access_key" "web_app" {
  user = aws_iam_user.web_app.name
}
```

- [ ] **Step 2: Add outputs to `infra/outputs.tf`**

```hcl
output "web_app_access_key_id" {
  value = aws_iam_access_key.web_app.id
}

output "web_app_secret_access_key" {
  value     = aws_iam_access_key.web_app.secret
  sensitive = true
}
```

- [ ] **Step 3: Validate and format**

Run: `cd infra && terraform fmt -check && terraform validate`
Expected: no diff, validation succeeds.

- [ ] **Step 4: Plan, push, and go through the existing CI/CD gate**

```bash
git add infra/web_access.tf infra/outputs.tf
git commit -m "Add least-privilege IAM user for the Next.js web app"
git push
```

Wait for the GitHub Actions `plan` job, then approve the `apply` job in the `production` environment gate the same way every previous infra change in this project has been approved.

- [ ] **Step 5: Retrieve credentials and configure Vercel**

```bash
cd infra
terraform output -raw web_app_access_key_id
terraform output -raw web_app_secret_access_key
terraform output -raw glue_database_name
terraform output -raw athena_workgroup_name
terraform output -raw rag_query_function_name
terraform output -raw rag_agent_function_name
```

In the Vercel project (root directory `web/`, connected to this GitHub repo), set these environment variables: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION=us-east-1`, `ATHENA_WORKGROUP`, `ATHENA_DATABASE`, `ALARM_NAME_PREFIX=realtime-data-pipeline-dev`, `RAG_QUERY_FUNCTION_NAME`, `RAG_AGENT_FUNCTION_NAME`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` (from a new free Upstash Redis database created for this project).

- [ ] **Step 6: Deploy and run the full manual verification checklist**

Trigger the Vercel deploy (push to `main` or the dashboard's "Deploy" button). Once live, repeat the Task 9 and Task 11 manual checks against the production URL instead of `localhost`: Dashboard numbers match a manual Athena query, both RAG Assistant modes return real Bedrock-backed answers, and 6 rapid assistant requests trigger the rate-limit notice on the 6th.

- [ ] **Step 7: Update the design doc with the live URL**

Once verified, update the Claude Docs design doc's roadmap/deliverables with the real deployment (this repeats the pattern used for every other feature in this project — see the "cập nhật lại doc thiết kế" step in prior work).
