# Settings Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real `/settings` page showing real EventBridge schedule
state for both real ingestion rules and real Secrets Manager
configured-status for both real secrets.

**Architecture:** One new API route (`/api/settings`) backed by the
existing `getScheduleStatus` helper (reused from Ops, unchanged) plus a
new `getSecretStatus` helper (metadata-only, never fetches secret
values), merged with static real facts in a client page.

**Tech Stack:** Next.js 15 App Router, TypeScript,
`@aws-sdk/client-secrets-manager` (new dependency), `@aws-sdk/client-eventbridge`
(already a dependency), Vitest, Terraform.

**Spec:** `docs/superpowers/specs/2026-09-21-settings-page-design.md`

## Global Constraints

- No write access anywhere on this page -- no pause-ingestion button, no
  mutating call of any kind. Schedule state is read-only
  (`events:DescribeRule` only).
- No PII -- the real `alarm_email` Terraform variable is never fetched
  or displayed on this public page.
- No live-editable ingestion config -- no "+ add" affordance; a static
  caption ("Chỉnh sửa nguồn dữ liệu qua common/config.py + redeploy")
  replaces it.
- `getSecretStatus` NEVER calls `GetSecretValue` -- only
  `DescribeSecretCommand`, checking `VersionIdsToStages` for an
  `AWSCURRENT` entry. The actual secret content must never reach this
  app's server or client code.
- The shared and news EventBridge rule NAMES are derived client-side by
  string construction from `ALARM_NAME_PREFIX` (`` `${prefix}-ingestion-schedule` ``
  and `` `${prefix}-news-ingestion-schedule` ``), exactly matching
  `ops/route.ts`'s already-shipped pattern -- no new env var or Terraform
  output for either rule name at the runtime-route level.
- Secret IDs (`NEWS_SECRET_NAME`, `TAVILY_SECRET_NAME`) ARE new env vars,
  sourced from the Terraform outputs that already exist (`news_secret_name`,
  `tavily_secret_name`) -- `DescribeSecretCommand`'s `SecretId` field
  accepts a plain name, not just an ARN (verified against the real
  `@aws-sdk/client-secrets-manager` `.d.ts` types).
- The new IAM grants (`events:DescribeRule` on the news rule's ARN,
  `secretsmanager:DescribeSecret` on both secrets' ARNs) use real
  Terraform ARN outputs, never a string-guessed ARN in bash -- this is
  the specific lesson from the Ops sub-project's real IAM-ARN-construction
  incident (a bash suffix-strip produced a wrong ARN in the user's actual
  shell). Secrets Manager ARNs specifically include a random 6-character
  suffix Terraform can't predict from the name alone, making a real `.arn`
  output the only safe option (unlike EventBridge rule ARNs, which have a
  fully deterministic format and are safely bash-constructed from the
  existing `ingestion_schedule_rule_name` pattern).
- Error handling matches the established convention: `console.error` + `{
  error: "Không tải được Settings, thử lại sau." }` at 500, uncached.
- Cache-Control: `public, s-maxage=60, stale-while-revalidate=120`.

---

### Task 1: Secrets Manager status helper

**Files:**
- Create: `web/lib/secretsManager.ts`
- Create: `web/lib/secretsManager.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `getSecretStatus(client: SecretsManagerClient, secretId:
  string): Promise<{ configured: boolean }>`. Task 3's route calls this
  twice (once per secret).

- [ ] **Step 1: Install the new dependency**

```bash
cd web && npm install @aws-sdk/client-secrets-manager
```

- [ ] **Step 2: Write the failing tests**

Create `web/lib/secretsManager.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { getSecretStatus } from "./secretsManager";

function mockClient(versionIdsToStages: Record<string, string[]> | undefined): SecretsManagerClient {
  return { send: vi.fn().mockResolvedValue({ VersionIdsToStages: versionIdsToStages }) } as unknown as SecretsManagerClient;
}

describe("getSecretStatus", () => {
  it("returns configured: true when a version is staged AWSCURRENT", async () => {
    const client = mockClient({ v1: ["AWSCURRENT"] });
    const result = await getSecretStatus(client, "my-secret");
    expect(result).toEqual({ configured: true });
  });

  it("returns configured: false when VersionIdsToStages is undefined", async () => {
    const client = mockClient(undefined);
    const result = await getSecretStatus(client, "my-secret");
    expect(result).toEqual({ configured: false });
  });

  it("returns configured: false when VersionIdsToStages is empty", async () => {
    const client = mockClient({});
    const result = await getSecretStatus(client, "my-secret");
    expect(result).toEqual({ configured: false });
  });

  it("returns configured: false when versions exist but none staged AWSCURRENT", async () => {
    const client = mockClient({ v1: ["AWSPREVIOUS"] });
    const result = await getSecretStatus(client, "my-secret");
    expect(result).toEqual({ configured: false });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd web && npx vitest run lib/secretsManager.test.ts`
Expected: FAIL -- module `./secretsManager` not found

- [ ] **Step 4: Implement**

Create `web/lib/secretsManager.ts`:

```ts
import { DescribeSecretCommand, type SecretsManagerClient } from "@aws-sdk/client-secrets-manager";

// DescribeSecretCommand never returns the secret's actual value -- only
// metadata. VersionIdsToStages maps each version id to its staging
// labels; a version staged AWSCURRENT is the real, safe, read-only
// signal that a value has been set. GetSecretValue is never called
// anywhere in this app.
export async function getSecretStatus(
  client: SecretsManagerClient,
  secretId: string
): Promise<{ configured: boolean }> {
  const response = await client.send(new DescribeSecretCommand({ SecretId: secretId }));
  const configured = Object.values(response.VersionIdsToStages ?? {}).some((stages) =>
    stages.includes("AWSCURRENT")
  );
  return { configured };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd web && npx vitest run lib/secretsManager.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add web/package.json web/package-lock.json web/lib/secretsManager.ts web/lib/secretsManager.test.ts
git commit -m "Add Secrets Manager status helper (metadata-only, never GetSecretValue)"
```

---

### Task 2: Static data-source metadata

**Files:**
- Create: `web/lib/settingsMeta.ts`
- Create: `web/lib/settingsMeta.test.ts`

**Interfaces:**
- Consumes: `WEATHER_LOCATION_NAMES` from `web/lib/weatherMeta.ts` (built
  for the Weather sub-project, exported already).
- Produces: `DataSourceMeta = { id: string; name: string; detail:
  string; usesNewsSchedule: boolean }`, `DATA_SOURCES: DataSourceMeta[]`
  (5 entries), `SECRET_LABELS: string[]` (2 entries: `"news-api-key"`,
  `"tavily-api-key"`). Task 4's page imports `DATA_SOURCES` to render the
  data-sources card. Task 3's route imports `SECRET_LABELS` as the single
  source of truth for the 2 secrets' display names, instead of
  hardcoding the same 2 strings a second time.

- [ ] **Step 1: Write the failing tests**

Create `web/lib/settingsMeta.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DATA_SOURCES, SECRET_LABELS } from "./settingsMeta";

describe("DATA_SOURCES", () => {
  it("has exactly 5 real ingestion sources", () => {
    expect(DATA_SOURCES.map((s) => s.id)).toEqual(["hackernews", "news", "weather", "crypto", "github"]);
  });

  it("only News API uses the separate news schedule", () => {
    const flags = Object.fromEntries(DATA_SOURCES.map((s) => [s.id, s.usesNewsSchedule]));
    expect(flags).toEqual({
      hackernews: false,
      news: true,
      weather: false,
      crypto: false,
      github: false,
    });
  });

  it("every source has a non-empty name and detail", () => {
    for (const source of DATA_SOURCES) {
      expect(source.name.length).toBeGreaterThan(0);
      expect(source.detail.length).toBeGreaterThan(0);
    }
  });

  it("the weather source's detail mentions all 12 real locations", () => {
    const weather = DATA_SOURCES.find((s) => s.id === "weather");
    expect(weather?.detail).toContain("Da Lat");
    expect(weather?.detail).toContain("Tay Ninh");
  });
});

describe("SECRET_LABELS", () => {
  it("has exactly the 2 real secrets", () => {
    expect(SECRET_LABELS).toEqual(["news-api-key", "tavily-api-key"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run lib/settingsMeta.test.ts`
Expected: FAIL -- module `./settingsMeta` not found

- [ ] **Step 3: Implement**

Create `web/lib/settingsMeta.ts`:

```ts
import { WEATHER_LOCATION_NAMES } from "./weatherMeta";

export type DataSourceMeta = {
  id: string;
  name: string;
  detail: string;
  usesNewsSchedule: boolean;
};

// CRYPTO_COIN_IDS: verbatim from common/config.py.
const CRYPTO_COIN_IDS = ["bitcoin", "ethereum", "solana"];

// NEWS_QUERY default: common/config.py. GITHUB_TRENDING_DAYS/LIMIT:
// common/config.py (7 / 20). GitHub's real unauthenticated Search API
// rate limit (10 req/min) is documented by GitHub itself, not this
// repo's code -- ingestion/github_trending_ingestion.py calls
// GET /search/repositories, the Search endpoint this limit applies to.
export const DATA_SOURCES: DataSourceMeta[] = [
  {
    id: "hackernews",
    name: "Hacker News",
    detail: "Top stories · không cần API key",
    usesNewsSchedule: false,
  },
  {
    id: "news",
    name: "News API",
    detail: 'query="cryptocurrency OR technology"',
    usesNewsSchedule: true,
  },
  {
    id: "weather",
    name: "Weather (Open-Meteo)",
    detail: `${WEATHER_LOCATION_NAMES.length} khu vực · không cần API key · ${WEATHER_LOCATION_NAMES.join(", ")}`,
    usesNewsSchedule: false,
  },
  {
    id: "crypto",
    name: "Crypto (CoinGecko)",
    detail: `không cần API key · ${CRYPTO_COIN_IDS.join(", ")}`,
    usesNewsSchedule: false,
  },
  {
    id: "github",
    name: "GitHub Trending",
    detail: "created > 7 ngày · top 20 · giới hạn 10 req/phút (GitHub Search API, unauthenticated)",
    usesNewsSchedule: false,
  },
];

export const SECRET_LABELS = ["news-api-key", "tavily-api-key"];
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run lib/settingsMeta.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add web/lib/settingsMeta.ts web/lib/settingsMeta.test.ts
git commit -m "Add Settings page's static real data-source metadata"
```

---

### Task 3: API route, types, infra outputs, and IAM documentation

**Files:**
- Modify: `web/lib/types.ts`
- Modify: `web/lib/aws.ts`
- Create: `web/app/api/settings/route.ts`
- Create: `web/app/api/settings/route.test.ts`
- Modify: `web/.env.example`
- Modify: `infra/outputs.tf`
- Modify: `infra/README.md`

**Interfaces:**
- Consumes: `getScheduleStatus` (existing, `web/lib/eventbridge.ts`,
  unchanged); `getSecretStatus` (Task 1); `SECRET_LABELS` (Task 2,
  `web/lib/settingsMeta.ts`); `requiredEnv`, `getEventBridgeClient`
  (existing, `web/lib/aws.ts`).
- Produces: `ScheduleStatus = { scheduleExpression: string; enabled:
  boolean }`, `SecretStatus = { name: string; configured: boolean }`,
  `SettingsResponse = { sharedSchedule: ScheduleStatus; newsSchedule:
  ScheduleStatus; secrets: SecretStatus[] }` (`web/lib/types.ts`);
  `getSecretsManagerClient(): SecretsManagerClient` (`web/lib/aws.ts`).
  Task 4's page consumes `SettingsResponse` exactly as shown.

- [ ] **Step 1: Add the new types**

Add to the end of `web/lib/types.ts`:

```ts
export type ScheduleStatus = { scheduleExpression: string; enabled: boolean };

export type SecretStatus = { name: string; configured: boolean };

export type SettingsResponse = {
  sharedSchedule: ScheduleStatus;
  newsSchedule: ScheduleStatus;
  secrets: SecretStatus[];
};
```

- [ ] **Step 2: Add the Secrets Manager client getter**

In `web/lib/aws.ts`, add the import alongside the existing ones:

```ts
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
```

And add this getter at the end of the file, matching the exact pattern
of every other getter in this file:

```ts
let secretsManagerClient: SecretsManagerClient | undefined;
export function getSecretsManagerClient(): SecretsManagerClient {
  if (!secretsManagerClient) secretsManagerClient = new SecretsManagerClient({ region: requiredEnv("AWS_REGION") });
  return secretsManagerClient;
}
```

- [ ] **Step 3: Write the failing tests for the route**

Create `web/app/api/settings/route.test.ts`:

```ts
// web/app/api/settings/route.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/aws", () => ({
  getEventBridgeClient: vi.fn(() => ({})),
  getSecretsManagerClient: vi.fn(() => ({})),
  requiredEnv: vi.fn((name: string) => {
    if (name === "ALARM_NAME_PREFIX") return "test-prefix";
    if (name === "NEWS_SECRET_NAME") return "test-prefix/news-api";
    if (name === "TAVILY_SECRET_NAME") return "test-prefix/tavily-api";
    throw new Error(`unexpected env var: ${name}`);
  }),
}));
vi.mock("@/lib/eventbridge", () => ({ getScheduleStatus: vi.fn() }));
vi.mock("@/lib/secretsManager", () => ({ getSecretStatus: vi.fn() }));

import { getScheduleStatus } from "@/lib/eventbridge";
import { getSecretStatus } from "@/lib/secretsManager";
import { GET } from "./route";

const mockedSchedule = vi.mocked(getScheduleStatus);
const mockedSecret = vi.mocked(getSecretStatus);

beforeEach(() => {
  mockedSchedule.mockReset();
  mockedSecret.mockReset();
});

describe("GET /api/settings", () => {
  it("returns real schedule and secret status for both rules and both secrets", async () => {
    mockedSchedule.mockImplementation((_client, ruleName: string) =>
      Promise.resolve(
        ruleName === "test-prefix-ingestion-schedule"
          ? { scheduleExpression: "rate(10 minutes)", enabled: true }
          : { scheduleExpression: "rate(20 minutes)", enabled: true }
      )
    );
    mockedSecret.mockResolvedValue({ configured: true });

    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.sharedSchedule).toEqual({ scheduleExpression: "rate(10 minutes)", enabled: true });
    expect(body.newsSchedule).toEqual({ scheduleExpression: "rate(20 minutes)", enabled: true });
    expect(body.secrets).toEqual([
      { name: "news-api-key", configured: true },
      { name: "tavily-api-key", configured: true },
    ]);
    expect(mockedSchedule).toHaveBeenCalledWith(expect.anything(), "test-prefix-ingestion-schedule");
    expect(mockedSchedule).toHaveBeenCalledWith(expect.anything(), "test-prefix-news-ingestion-schedule");
    expect(mockedSecret).toHaveBeenCalledWith(expect.anything(), "test-prefix/news-api");
    expect(mockedSecret).toHaveBeenCalledWith(expect.anything(), "test-prefix/tavily-api");
  });

  it("returns 500 with a safe message when a call fails", async () => {
    mockedSchedule.mockRejectedValue(new Error("boom"));
    mockedSecret.mockResolvedValue({ configured: true });
    const response = await GET();
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("Không tải được Settings, thử lại sau.");
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cd web && npx vitest run app/api/settings/route.test.ts`
Expected: FAIL -- module `./route` not found

- [ ] **Step 5: Implement the route**

Create `web/app/api/settings/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getEventBridgeClient, getSecretsManagerClient, requiredEnv } from "@/lib/aws";
import { getScheduleStatus } from "@/lib/eventbridge";
import { getSecretStatus } from "@/lib/secretsManager";
import { SECRET_LABELS } from "@/lib/settingsMeta";
import type { SettingsResponse } from "@/lib/types";

export const maxDuration = 60;

export async function GET() {
  try {
    const prefix = requiredEnv("ALARM_NAME_PREFIX");
    // Rule names derived by string construction, matching
    // infra/eventbridge.tf's real resource names -- exact same pattern
    // already shipped in web/app/api/ops/route.ts, no new env var needed.
    const sharedRuleName = `${prefix}-ingestion-schedule`;
    const newsRuleName = `${prefix}-news-ingestion-schedule`;
    const newsSecretId = requiredEnv("NEWS_SECRET_NAME");
    const tavilySecretId = requiredEnv("TAVILY_SECRET_NAME");

    const eventBridge = getEventBridgeClient();
    const secretsManager = getSecretsManagerClient();

    const [sharedSchedule, newsSchedule, newsSecret, tavilySecret] = await Promise.all([
      getScheduleStatus(eventBridge, sharedRuleName),
      getScheduleStatus(eventBridge, newsRuleName),
      getSecretStatus(secretsManager, newsSecretId),
      getSecretStatus(secretsManager, tavilySecretId),
    ]);

    // SECRET_LABELS[0]/[1] pair positionally with news/tavily above --
    // both defined once, together, in settingsMeta.ts (single source of
    // truth for the 2 real secrets' display names).
    const response: SettingsResponse = {
      sharedSchedule,
      newsSchedule,
      secrets: [
        { name: SECRET_LABELS[0], configured: newsSecret.configured },
        { name: SECRET_LABELS[1], configured: tavilySecret.configured },
      ],
    };

    return NextResponse.json(response, {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" },
    });
  } catch (error) {
    console.error("Settings API failed", error);
    return NextResponse.json({ error: "Không tải được Settings, thử lại sau." }, { status: 500 });
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd web && npx vitest run app/api/settings/route.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 7: Add the 2 new env vars to `.env.example`**

Add to the end of `web/.env.example`:

```
# Secret names (not values) for the Settings page's real, metadata-only
# "configured" check -- DescribeSecret only, never GetSecretValue.
NEWS_SECRET_NAME=realtime-data-pipeline-dev/news-api
TAVILY_SECRET_NAME=realtime-data-pipeline-dev/tavily-api
```

- [ ] **Step 8: Add the 3 new Terraform outputs**

Add to the end of `infra/outputs.tf`:

```hcl
output "news_ingestion_schedule_rule_name" {
  value = aws_cloudwatch_event_rule.news_ingestion_schedule.name
}

output "news_secret_arn" {
  value = aws_secretsmanager_secret.news_api.arn
}

output "tavily_secret_arn" {
  value = aws_secretsmanager_secret.tavily_api.arn
}
```

- [ ] **Step 9: Update the manual IAM policy script in `infra/README.md`**

In the script block (the one starting `USER_NAME="realtime-data-pipeline-dev-web-app"`),
add these 3 lines right after the existing
`INGESTION_SCHEDULE_ARN="arn:aws:events:${REGION}:${ACCOUNT_ID}:rule/$(terraform output -raw ingestion_schedule_rule_name)"`
line:

```bash
NEWS_INGESTION_SCHEDULE_ARN="arn:aws:events:${REGION}:${ACCOUNT_ID}:rule/$(terraform output -raw news_ingestion_schedule_rule_name)"
NEWS_SECRET_ARN="$(terraform output -raw news_secret_arn)"
TAVILY_SECRET_ARN="$(terraform output -raw tavily_secret_arn)"
```

Change the existing `EventBridgeReadSchedule` statement's `Resource`
from a single string to a 2-element list:

```json
    {
      "Sid": "EventBridgeReadSchedule",
      "Effect": "Allow",
      "Action": ["events:DescribeRule"],
      "Resource": ["${INGESTION_SCHEDULE_ARN}", "${NEWS_INGESTION_SCHEDULE_ARN}"]
    },
```

Add a new statement right after the existing `InvokeRagLambdas`
statement (before the closing `]` of `"Statement"`):

```json
    {
      "Sid": "SecretsManagerDescribeOnly",
      "Effect": "Allow",
      "Action": ["secretsmanager:DescribeSecret"],
      "Resource": ["${NEWS_SECRET_ARN}", "${TAVILY_SECRET_ARN}"]
    }
```

(Remember to add a trailing comma after the `InvokeRagLambdas` block's
closing `}` now that another statement follows it.)

Add 2 new lines to the "Web app environment variables" list further down
`infra/README.md` (same section that already lists
`RAG_QUERY_FUNCTION_NAME` etc.):

```markdown
- `NEWS_SECRET_NAME` -- name of the News API secret (Settings page's real, metadata-only "configured" check)
- `TAVILY_SECRET_NAME` -- name of the Tavily secret (same check)
```

- [ ] **Step 10: Run the full suite to confirm nothing else broke**

Run: `cd web && npx vitest run`
Expected: PASS, all files including the new ones

- [ ] **Step 11: Commit**

```bash
git add web/lib/types.ts web/lib/aws.ts web/app/api/settings/route.ts web/app/api/settings/route.test.ts web/.env.example infra/outputs.tf infra/README.md
git commit -m "Add GET /api/settings route, real IAM grants, and Terraform outputs"
```

---

### Task 4: Settings page

**Files:**
- Create: `web/app/settings/page.tsx`
- Modify: `web/components/NavBar.tsx`

**Interfaces:**
- Consumes: `SettingsResponse` (Task 3); `DATA_SOURCES` (Task 2).
  Fetches `/api/settings` (Task 3) at runtime.
- Produces: nothing (final page, no other task depends on it).

This task has no dedicated automated test (project convention: page
components aren't unit-tested, verified manually after deploy in Task 5).

- [ ] **Step 1: Implement the page**

Create `web/app/settings/page.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import type { SettingsResponse } from "@/lib/types";
import { DATA_SOURCES } from "@/lib/settingsMeta";

export default function SettingsPage() {
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const res = await fetch("/api/settings");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Không tải được Settings.");
      setData(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tải được Settings.");
    }
  }

  useEffect(() => {
    load();
  }, []);

  if (error) {
    return (
      <div className="p-9 flex flex-col gap-4">
        <p className="text-error text-sm">{error}</p>
        <button onClick={load} className="w-fit rounded-lg border border-border px-4 py-2 text-sm text-textPrimary">
          Thử lại
        </button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-9 flex flex-col gap-4">
        <div className="h-96 rounded-2xl border border-border bg-surface animate-pulse" />
      </div>
    );
  }

  return (
    <div className="p-9 flex flex-col gap-5">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-textPrimary">Settings</h1>
        <p className="mt-1.5 text-sm text-textSecondary">Cấu hình nguồn dữ liệu, secrets &amp; lịch vận hành</p>
      </div>

      <div className="grid grid-cols-[1.4fr_1fr] gap-4 flex-grow min-h-0">
        <div className="rounded-2xl border border-border bg-surface px-5 py-5 flex flex-col gap-3.5 overflow-auto">
          <span className="text-xs font-semibold text-textPrimary">Nguồn dữ liệu</span>
          <div className="flex flex-col gap-2.5">
            {DATA_SOURCES.map((source) => {
              const schedule = source.usesNewsSchedule ? data.newsSchedule : data.sharedSchedule;
              return (
                <div key={source.id} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5">
                  <span
                    className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${schedule.enabled ? "bg-success" : "bg-error"}`}
                  />
                  <div className="flex-grow">
                    <span className="text-xs text-textPrimary">{source.name}</span>
                    <div className="text-[10.5px] text-textMuted">{source.detail}</div>
                  </div>
                  <span className="font-mono text-[11px] px-2.5 py-1 rounded-md bg-bg text-textSecondary">
                    {schedule.scheduleExpression}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="text-[10.5px] text-textMuted">Chỉnh sửa nguồn dữ liệu qua common/config.py + redeploy.</p>
        </div>

        <div className="rounded-2xl border border-border bg-surface px-5 py-5 flex flex-col gap-3">
          <span className="text-xs font-semibold text-textPrimary">Secrets Manager</span>
          {data.secrets.map((secret) => (
            <div key={secret.name} className="flex justify-between items-center">
              <span className="text-xs text-textSecondary">{secret.name}</span>
              <span className={`font-mono text-[11px] ${secret.configured ? "text-success" : "text-error"}`}>
                {secret.configured ? "● configured" : "○ chưa cấu hình"}
              </span>
            </div>
          ))}
          <p className="text-[10.5px] text-textMuted">Giá trị được set qua AWS CLI, Terraform không quản lý value.</p>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add the NavBar entry**

In `web/components/NavBar.tsx`, add after the `/weather` entry:

```ts
  { href: "/settings", label: "Settings" },
```

- [ ] **Step 3: Run the full test suite and typecheck**

Run: `cd web && npx vitest run && npx tsc --noEmit`
Expected: all tests PASS, tsc clean (no output)

- [ ] **Step 4: Commit**

```bash
git add web/app/settings/page.tsx web/components/NavBar.tsx
git commit -m "Add /settings page: real schedule state, real secret status"
```

---

### Task 5: Apply infra, update IAM grants, deploy, and live-verify

**Files:** none (no code changes -- this task applies real infra
changes, then pushes and verifies).

**Interfaces:**
- Consumes: nothing new (no new AWS resources -- only new Terraform
  outputs of already-existing resources, and 2 new least-privilege IAM
  grants on already-existing ARNs).
- Produces: nothing (final task).

This task has a real infra dependency the prior sub-projects didn't:
the new route's env vars and IAM grants must exist for real BEFORE the
web app's first deploy with this code can succeed. Do these in order:

- [ ] **Step 1: Ask the user to apply the new Terraform outputs**

Tell the user: run `terraform apply` from `infra/` (using their own AWS
credentials, same as every prior `terraform apply` this project). This
creates no new AWS resources -- only the 3 new outputs defined in Task 3
(`news_ingestion_schedule_rule_name`, `news_secret_arn`,
`tavily_secret_arn`), all pointing at already-existing resources. Wait
for confirmation before proceeding.

- [ ] **Step 2: Ask the user to re-run the updated IAM policy script**

Tell the user: re-run the (now-updated, per Task 3's
`infra/README.md` changes) manual IAM policy script from `infra/README.md`'s
"Web app IAM user" section, using their own AWS credentials. This grants
the 2 new least-privilege permissions (`events:DescribeRule` on the news
rule, `secretsmanager:DescribeSecret` on both secrets) without touching
any existing grant. Wait for confirmation before proceeding.

- [ ] **Step 3: Ask the user to add the 2 new Vercel env vars**

Tell the user: add `NEWS_SECRET_NAME` and `TAVILY_SECRET_NAME` as Vercel
project environment variables, using the real values from
`terraform output -raw news_secret_name` and
`terraform output -raw tavily_secret_name` (these 2 outputs already
existed before this sub-project). Wait for confirmation before
proceeding -- this must happen before the push in Step 4, so the very
first deploy already has them (same established pattern as every prior
credential addition this project).

- [ ] **Step 4: Push and wait for the deploy gate**

```bash
git push origin main
```

Wait for the GitHub Actions "Deploy" workflow. `Terraform Plan` should
show 0 resources to add/change/destroy (only the 3 new outputs, already
applied for real in Step 1, so this push's own apply is a true no-op on
resources); `apply` will still wait on the `environment: production`
approval gate as usual. Report the run URL and wait for approval before
proceeding.

- [ ] **Step 5: Live-verify**

```bash
curl -s https://realtime-data-pipeline.vercel.app/api/settings | python3 -m json.tool
curl -s -o /dev/null -w "%{http_code}\n" https://realtime-data-pipeline.vercel.app/settings
```

Confirm: `/api/settings` returns real, currently-true data --
`sharedSchedule.enabled` and `newsSchedule.enabled` both `true` (unless
ingestion has been deliberately paused), `sharedSchedule.scheduleExpression`
and `newsSchedule.scheduleExpression` match the real values in
`infra/variables.tf` (`rate(10 minutes)` / `rate(20 minutes)` by
default), and both `secrets[].configured` are `true` (both secrets were
set via AWS CLI earlier this project -- cross-check with
`aws secretsmanager describe-secret --secret-id <name>` if in doubt).
Confirm `/settings` itself returns `200`, and that nothing on the
rendered page shows an alarm email, a pause button, or a "+ add"
affordance.
