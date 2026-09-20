# Catalog Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real `/catalog` page to `web/` showing the 5 curated Glue tables (live schema from AWS) merged with verified static metadata (RAG-indexing status, ingestion cadence, source API, per-column notes).

**Architecture:** New `web/lib/glue.ts` wraps `@aws-sdk/client-glue`'s `GetTablesCommand`; a new `web/lib/catalogMeta.ts` holds static, code-verified facts keyed by table name; `web/app/api/catalog/route.ts` merges the two and serves JSON; `web/app/catalog/page.tsx` renders a two-column list/detail view matching the approved mockup.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, `@aws-sdk/client-glue`, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-20-catalog-page-design.md`

## Global Constraints

- TypeScript strict mode (existing `web/tsconfig.json` — do not weaken it).
- No new environment variables — reuse `ATHENA_DATABASE` as the Glue database name.
- Design tokens from `web/tailwind.config.ts`: `bg #0B1120, surface #131B2E, border #1E2A47, accent #2DD4BF, textPrimary #E8ECF6, textSecondary #93A0C2, textMuted #5C6892`. Use existing Tailwind class names (`bg-surface`, `border-border`, `text-textPrimary`, etc.), not raw hex.
- Fonts: `font-heading` (Space Grotesk) for headings, default sans (Work Sans) for body, `font-mono` (IBM Plex Mono) for table/schema data — matching `web/app/globals.css`'s existing font-family utility classes already used by Dashboard/Assistant.
- Vietnamese UI copy, exactly as specified in each task below — do not invent alternate wording.
- No component tests (project convention) — only `lib`/`route` unit tests, plus a manual live-verification checklist in the final task.
- Never fabricate a per-column note or a cadence/source fact — only what Task 1's `catalogMeta.ts` encodes, sourced from the spec's verified table.

---

### Task 1: `catalogMeta.ts` static metadata + `types.ts` additions

**Files:**
- Create: `web/lib/catalogMeta.ts`
- Modify: `web/lib/types.ts`
- Test: `web/lib/catalogMeta.test.ts`

**Interfaces:**
- Consumes: nothing (pure data module).
- Produces: `CatalogTableMeta` type, `CATALOG_META: Record<string, CatalogTableMeta>` (keyed by exact Glue table name), `CatalogColumn`, `CatalogTable` types — used by Task 2 (`glue.ts`) and Task 3 (`route.ts`).

- [ ] **Step 1: Write the failing test**

```typescript
// web/lib/catalogMeta.test.ts
import { describe, expect, it } from "vitest";
import { CATALOG_META } from "./catalogMeta";

describe("CATALOG_META", () => {
  it("has an entry for all 5 curated tables", () => {
    expect(Object.keys(CATALOG_META).sort()).toEqual([
      "crypto_prices",
      "github_repos",
      "hackernews_stories",
      "news_articles",
      "weather_observations",
    ]);
  });

  it("marks only hackernews, news, and github as RAG-indexed", () => {
    expect(CATALOG_META.hackernews_stories.ragIndexed).toBe(true);
    expect(CATALOG_META.news_articles.ragIndexed).toBe(true);
    expect(CATALOG_META.github_repos.ragIndexed).toBe(true);
    expect(CATALOG_META.crypto_prices.ragIndexed).toBe(false);
    expect(CATALOG_META.weather_observations.ragIndexed).toBe(false);
  });

  it("gives every table the shared 10-minute ingestion cadence", () => {
    for (const meta of Object.values(CATALOG_META)) {
      expect(meta.cadence).toBe("mỗi 10 phút");
    }
  });

  it("has a verified note on crypto_prices.price_usd about the float cast", () => {
    expect(CATALOG_META.crypto_prices.columnNotes?.price_usd).toMatch(/float/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run lib/catalogMeta.test.ts`
Expected: FAIL with "Cannot find module './catalogMeta'"

- [ ] **Step 3: Add types to `web/lib/types.ts`**

Append to the existing file (do not remove `SourceVolume`, `ActivityItem`, `DashboardResponse`):

```typescript
export type CatalogColumn = { name: string; type: string; note?: string };

export type CatalogTable = {
  name: string;
  columns: CatalogColumn[];
  location: string;
  ragIndexed: boolean;
  sourceApi: string;
  ingestionLambda: string;
  cadence: string;
};

export type CatalogTableMeta = {
  ragIndexed: boolean;
  sourceApi: string;
  ingestionLambda: string;
  cadence: string;
  columnNotes?: Record<string, string>;
};
```

- [ ] **Step 4: Write `web/lib/catalogMeta.ts`**

```typescript
import type { CatalogTableMeta } from "./types";

// Every fact here is verified against real source, per
// docs/superpowers/specs/2026-09-20-catalog-page-design.md's
// "Real data sources" table. Never add a fact that isn't traceable
// to code.
const CADENCE = "mỗi 10 phút"; // infra/eventbridge.tf: one shared rate(10 minutes) rule for all 5 ingestion Lambdas

export const CATALOG_META: Record<string, CatalogTableMeta> = {
  hackernews_stories: {
    ragIndexed: true, // rag/build_index.py:101
    sourceApi: "Hacker News Firebase API",
    ingestionLambda: "hackernews-ingestion",
    cadence: CADENCE,
  },
  news_articles: {
    ragIndexed: true, // rag/build_index.py:102
    sourceApi: "NewsAPI /v2/everything",
    ingestionLambda: "news-ingestion",
    cadence: CADENCE,
  },
  github_repos: {
    ragIndexed: true, // rag/build_index.py:103
    sourceApi: "GitHub Search API /search/repositories",
    ingestionLambda: "github-trending-ingestion",
    cadence: CADENCE,
  },
  weather_observations: {
    ragIndexed: false,
    sourceApi: "Open-Meteo forecast API",
    ingestionLambda: "weather-ingestion",
    cadence: CADENCE,
  },
  crypto_prices: {
    ragIndexed: false,
    sourceApi: "CoinGecko /simple/price",
    ingestionLambda: "crypto-ingestion",
    cadence: CADENCE,
    columnNotes: {
      // ingestion/crypto_ingestion.py:32-39 -- CoinGecko returns
      // whole-dollar prices as ints; explicit float() avoids Athena's
      // HIVE_BAD_DATA on a column typed double.
      price_usd: "ép float khi ingest (tránh HIVE_BAD_DATA vì CoinGecko trả số nguyên)",
    },
  },
};
```

Each `sourceApi` value above has already been verified against the
real request URL in its ingestion script: `hackernews_ingestion.py:12`
(`https://hacker-news.firebaseio.com/v0`), `news_ingestion.py:13`
(`https://newsapi.org/v2/everything`),
`github_trending_ingestion.py:12`
(`https://api.github.com/search/repositories`),
`weather_ingestion.py:12` (`https://api.open-meteo.com/v1/forecast`),
`crypto_ingestion.py:12`
(`https://api.coingecko.com/api/v3/simple/price`). Copy the values
verbatim — do not re-derive them.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd web && npx vitest run lib/catalogMeta.test.ts lib/types.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Run full type check**

Run: `cd web && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add web/lib/catalogMeta.ts web/lib/catalogMeta.test.ts web/lib/types.ts
git commit -m "$(cat <<'EOF'
Add verified static catalog metadata (RAG classification, cadence, notes)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `web/lib/glue.ts` — live Glue schema fetch

**Files:**
- Create: `web/lib/glue.ts`
- Modify: `web/lib/aws.ts` (add `getGlueClient()`)
- Modify: `web/package.json` (add `@aws-sdk/client-glue`)
- Test: `web/lib/glue.test.ts`

**Interfaces:**
- Consumes: `CatalogColumn`, `CatalogTable` types from Task 1 (`web/lib/types.ts`); `requiredEnv` from `web/lib/aws.ts`.
- Produces: `listCuratedTables(client: GlueClient, database: string): Promise<Omit<CatalogTable, "ragIndexed" | "sourceApi" | "ingestionLambda" | "cadence">[]>` — an array of `{ name, columns, location }`, consumed by Task 3's route handler.

- [ ] **Step 1: Install the Glue SDK client**

Run: `cd web && npm install @aws-sdk/client-glue`

- [ ] **Step 2: Write the failing test**

```typescript
// web/lib/glue.test.ts
import { describe, expect, it, vi } from "vitest";
import { listCuratedTables } from "./glue";

describe("listCuratedTables", () => {
  it("maps Glue's Table[] shape into CatalogTable rows", async () => {
    const send = vi.fn().mockResolvedValue({
      TableList: [
        {
          Name: "crypto_prices",
          StorageDescriptor: {
            Location: "s3://real-bucket/curated/source=crypto/",
            Columns: [
              { Name: "price_id", Type: "string" },
              { Name: "price_usd", Type: "double" },
            ],
          },
        },
      ],
    });
    const client = { send } as unknown as import("@aws-sdk/client-glue").GlueClient;

    const tables = await listCuratedTables(client, "curated_db");

    expect(tables).toEqual([
      {
        name: "crypto_prices",
        location: "s3://real-bucket/curated/source=crypto/",
        columns: [
          { name: "price_id", type: "string" },
          { name: "price_usd", type: "double" },
        ],
      },
    ]);
  });

  it("falls back to empty location and columns when StorageDescriptor is missing", async () => {
    const send = vi.fn().mockResolvedValue({
      TableList: [{ Name: "weird_table" }],
    });
    const client = { send } as unknown as import("@aws-sdk/client-glue").GlueClient;

    const tables = await listCuratedTables(client, "curated_db");

    expect(tables).toEqual([{ name: "weird_table", location: "", columns: [] }]);
  });

  it("returns an empty array when TableList is absent", async () => {
    const send = vi.fn().mockResolvedValue({});
    const client = { send } as unknown as import("@aws-sdk/client-glue").GlueClient;

    const tables = await listCuratedTables(client, "curated_db");

    expect(tables).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd web && npx vitest run lib/glue.test.ts`
Expected: FAIL with "Cannot find module './glue'"

- [ ] **Step 4: Add `getGlueClient()` to `web/lib/aws.ts`**

Add alongside the existing client getters (after `getCloudWatchClient`):

```typescript
import { GlueClient } from "@aws-sdk/client-glue";

let glueClient: GlueClient | undefined;
export function getGlueClient(): GlueClient {
  if (!glueClient) glueClient = new GlueClient({ region: requiredEnv("AWS_REGION") });
  return glueClient;
}
```

- [ ] **Step 5: Write `web/lib/glue.ts`**

```typescript
import { GetTablesCommand, type GlueClient } from "@aws-sdk/client-glue";
import type { CatalogColumn } from "./types";

type BareTable = { name: string; columns: CatalogColumn[]; location: string };

export async function listCuratedTables(client: GlueClient, database: string): Promise<BareTable[]> {
  const response = await client.send(new GetTablesCommand({ DatabaseName: database }));
  return (response.TableList ?? []).map((table) => ({
    name: table.Name ?? "",
    location: table.StorageDescriptor?.Location ?? "",
    columns: (table.StorageDescriptor?.Columns ?? []).map((col) => ({
      name: col.Name ?? "",
      type: col.Type ?? "",
    })),
  }));
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd web && npx vitest run lib/glue.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 7: Run full type check**

Run: `cd web && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 8: Commit**

```bash
git add web/lib/glue.ts web/lib/glue.test.ts web/lib/aws.ts web/package.json web/package-lock.json
git commit -m "$(cat <<'EOF'
Add Glue client and listCuratedTables() for live schema reads

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `GET /api/catalog` route

**Files:**
- Create: `web/app/api/catalog/route.ts`
- Test: `web/app/api/catalog/route.test.ts`

**Interfaces:**
- Consumes: `listCuratedTables` from `web/lib/glue.ts` (Task 2), `CATALOG_META` from `web/lib/catalogMeta.ts` (Task 1), `getGlueClient`/`requiredEnv` from `web/lib/aws.ts`, `CatalogTable` type from `web/lib/types.ts`.
- Produces: `GET(): Promise<NextResponse>` returning `CatalogTable[]` on success — consumed by Task 4's `page.tsx` via `fetch("/api/catalog")`.

- [ ] **Step 1: Write the failing test**

```typescript
// web/app/api/catalog/route.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/aws", () => ({
  getGlueClient: vi.fn(() => ({})),
  requiredEnv: vi.fn((name: string) => {
    if (name === "ATHENA_DATABASE") return "curated_db";
    throw new Error(`unexpected requiredEnv(${name})`);
  }),
}));

vi.mock("@/lib/glue", () => ({
  listCuratedTables: vi.fn(),
}));

import { listCuratedTables } from "@/lib/glue";
import { GET } from "./route";

const mockedList = vi.mocked(listCuratedTables);

beforeEach(() => {
  mockedList.mockReset();
});

describe("GET /api/catalog", () => {
  it("merges live schema with static catalog metadata", async () => {
    mockedList.mockResolvedValueOnce([
      {
        name: "crypto_prices",
        location: "s3://real-bucket/curated/source=crypto/",
        columns: [{ name: "price_usd", type: "double" }],
      },
    ]);

    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual([
      {
        name: "crypto_prices",
        location: "s3://real-bucket/curated/source=crypto/",
        columns: [{ name: "price_usd", type: "double", note: "ép float khi ingest (tránh HIVE_BAD_DATA vì CoinGecko trả số nguyên)" }],
        ragIndexed: false,
        sourceApi: "CoinGecko /simple/price",
        ingestionLambda: "crypto-ingestion",
        cadence: "mỗi 10 phút",
      },
    ]);
  });

  it("defaults metadata for a table not present in CATALOG_META, without throwing", async () => {
    mockedList.mockResolvedValueOnce([
      { name: "future_table", location: "s3://real-bucket/curated/source=future/", columns: [] },
    ]);

    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body[0].ragIndexed).toBe(false);
    expect(body[0].cadence).toBe("");
  });

  it("returns 500 with a safe message when Glue fails", async () => {
    mockedList.mockRejectedValueOnce(new Error("AccessDenied"));

    const response = await GET();
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("Không tải được Data Catalog, thử lại sau.");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run app/api/catalog/route.test.ts`
Expected: FAIL with "Cannot find module './route'"

- [ ] **Step 3: Write `web/app/api/catalog/route.ts`**

```typescript
import { NextResponse } from "next/server";
import { getGlueClient, requiredEnv } from "@/lib/aws";
import { listCuratedTables } from "@/lib/glue";
import { CATALOG_META } from "@/lib/catalogMeta";
import type { CatalogTable } from "@/lib/types";

export const maxDuration = 60;

export async function GET() {
  try {
    const database = requiredEnv("ATHENA_DATABASE");
    const bareTables = await listCuratedTables(getGlueClient(), database);

    const tables: CatalogTable[] = bareTables.map((table) => {
      const meta = CATALOG_META[table.name];
      return {
        name: table.name,
        location: table.location,
        columns: table.columns.map((col) => ({
          ...col,
          note: meta?.columnNotes?.[col.name],
        })),
        ragIndexed: meta?.ragIndexed ?? false,
        sourceApi: meta?.sourceApi ?? "",
        ingestionLambda: meta?.ingestionLambda ?? "",
        cadence: meta?.cadence ?? "",
      };
    });

    return NextResponse.json(tables, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
    });
  } catch (error) {
    console.error("Catalog API failed", error);
    return NextResponse.json(
      { error: "Không tải được Data Catalog, thử lại sau." },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run app/api/catalog/route.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Run full type check**

Run: `cd web && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add web/app/api/catalog/route.ts web/app/api/catalog/route.test.ts
git commit -m "$(cat <<'EOF'
Add /api/catalog route merging live Glue schema with static metadata

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `/catalog` page UI

**Files:**
- Create: `web/app/catalog/page.tsx`
- Modify: `web/components/NavBar.tsx`

**Interfaces:**
- Consumes: `CatalogTable`, `CatalogColumn` types from `web/lib/types.ts` (Task 1); `GET /api/catalog` response shape from Task 3.
- Produces: nothing consumed by later tasks (this is the last task).

- [ ] **Step 1: Add the nav link**

In `web/components/NavBar.tsx`, extend the `LINKS` array (currently 2 entries) to:

```typescript
const LINKS = [
  { href: "/", label: "Tổng quan" },
  { href: "/assistant", label: "RAG Assistant" },
  { href: "/catalog", label: "Data Catalog" },
];
```

- [ ] **Step 2: Write `web/app/catalog/page.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import type { CatalogTable } from "@/lib/types";

function badgeLabel(table: CatalogTable): string {
  return table.ragIndexed ? "RAG indexed" : "không vào RAG";
}

export default function CatalogPage() {
  const [tables, setTables] = useState<CatalogTable[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const res = await fetch("/api/catalog");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Không tải được Data Catalog.");
      setTables(body);
      setSelected((current) => current ?? body[0]?.name ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tải được Data Catalog.");
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

  if (!tables) {
    return (
      <div className="p-9 grid grid-cols-[270px_1fr] gap-4">
        <div className="h-96 rounded-2xl border border-border bg-surface animate-pulse" />
        <div className="h-96 rounded-2xl border border-border bg-surface animate-pulse" />
      </div>
    );
  }

  const current = tables.find((t) => t.name === selected) ?? tables[0];

  return (
    <div className="p-9 flex flex-col gap-5">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-textPrimary">Data Catalog</h1>
        <p className="mt-1.5 text-sm text-textSecondary">
          {tables.length} bảng trong Glue Data Catalog
        </p>
      </div>
      <div className="flex gap-4 flex-grow min-h-0">
        <div className="w-[270px] shrink-0 rounded-2xl border border-border bg-surface p-3.5 flex flex-col gap-1.5 overflow-auto">
          {tables.map((table) => (
            <button
              key={table.name}
              onClick={() => setSelected(table.name)}
              className={`text-left flex flex-col rounded-lg px-3 py-2.5 ${
                table.name === current?.name
                  ? "bg-accent/10 border border-accent"
                  : "border border-transparent"
              }`}
            >
              <span className="text-[12.5px] font-semibold text-textPrimary">{table.name}</span>
              <span className="text-[10.5px] text-textMuted">
                {table.columns.length} cột · {badgeLabel(table)}
              </span>
            </button>
          ))}
        </div>

        {current && (
          <div className="flex-grow flex flex-col gap-4 min-h-0">
            <div className="rounded-2xl border border-border bg-surface px-5 py-5 flex flex-col gap-2.5">
              <div className="flex items-center justify-between">
                <span className="font-heading text-[15px] font-semibold text-textPrimary">
                  {current.name}
                </span>
                <span className="font-mono text-[10px] rounded-md bg-bg px-2.5 py-1 text-textSecondary">
                  {badgeLabel(current)}
                </span>
              </div>
              <span className="text-xs text-textMuted">
                Ghi bởi <span className="font-mono">{current.ingestionLambda}</span> {current.cadence} · nguồn{" "}
                <span className="font-mono">{current.sourceApi}</span>
              </span>
            </div>

            <div className="rounded-2xl border border-border bg-surface px-5 py-5 flex flex-col gap-2.5 flex-grow min-h-0 overflow-auto">
              <span className="text-[12.5px] font-semibold text-textPrimary">Schema</span>
              <table className="font-mono w-full border-collapse text-xs">
                <thead>
                  <tr>
                    <th className="text-left text-textSecondary text-[10.5px] uppercase tracking-wide border-b border-border py-2 px-2.5">
                      Cột
                    </th>
                    <th className="text-left text-textSecondary text-[10.5px] uppercase tracking-wide border-b border-border py-2 px-2.5">
                      Kiểu
                    </th>
                    <th className="text-left text-textSecondary text-[10.5px] uppercase tracking-wide border-b border-border py-2 px-2.5">
                      Ghi chú
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {current.columns.map((col) => (
                    <tr key={col.name}>
                      <td className="text-textSecondary border-b border-border py-2 px-2.5">{col.name}</td>
                      <td className="text-textSecondary border-b border-border py-2 px-2.5">{col.type}</td>
                      <td className="text-textMuted border-b border-border py-2 px-2.5">{col.note ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <span className="mt-auto text-[11px] text-textMuted">
                Vị trí lưu trữ: <span className="font-mono">{current.location}</span>
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Run the full test suite**

Run: `cd web && npx vitest run`
Expected: all tests pass (existing + new)

- [ ] **Step 4: Run full type check**

Run: `cd web && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Run the production build**

Run: `cd web && npm run build`
Expected: build succeeds; `/catalog` and `/api/catalog` listed in the route output

- [ ] **Step 6: Commit**

```bash
git add web/app/catalog/page.tsx web/components/NavBar.tsx
git commit -m "$(cat <<'EOF'
Add /catalog page: live Glue schema list/detail view

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: IAM policy update + deploy + live verification

**Files:**
- Modify: `infra/README.md` (the manual IAM policy JSON in the "Web app IAM user" section)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing (final task).

- [ ] **Step 1: Add the Glue statement to `infra/README.md`'s policy JSON**

Find the existing 6-statement policy JSON block in `infra/README.md` (under "Web app IAM user (manual -- not managed by Terraform)") and add a 7th statement, keeping the surrounding `terraform output`-driven variable substitution style already used there:

```json
{
  "Sid": "GlueReadCuratedCatalog",
  "Effect": "Allow",
  "Action": ["glue:GetTables", "glue:GetTable"],
  "Resource": [
    "arn:aws:glue:${AWS_REGION}:${ACCOUNT_ID}:catalog",
    "arn:aws:glue:${AWS_REGION}:${ACCOUNT_ID}:database/${GLUE_DATABASE}",
    "arn:aws:glue:${AWS_REGION}:${ACCOUNT_ID}:table/${GLUE_DATABASE}/*"
  ]
}
```

Match whatever shell-variable naming convention the existing 6 statements
already use for region/account/database substitution — do not invent a
different convention.

- [ ] **Step 2: Commit the README change**

```bash
git add infra/README.md
git commit -m "$(cat <<'EOF'
Document Glue read permissions needed for the Catalog page

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 3: Ask the user to apply the updated IAM policy**

Tell the user: run the updated `put-user-policy` script from
`infra/README.md` with their own AWS credentials, since this session's
CI role and local role are both deliberately scoped away from IAM
writes (established in the earlier Dashboard/Assistant work). Wait for
confirmation before proceeding.

- [ ] **Step 4: Push and wait for the deploy gate**

```bash
git push
```

Poll GitHub Actions; tell the user the Deploy run is waiting on the
production approval gate (same as every previous deploy in this
project) and wait for them to approve it before proceeding.

- [ ] **Step 5: Live verification**

Once Deploy shows `completed success`, run:

```bash
curl -sS https://realtime-data-pipeline.vercel.app/api/catalog | python3 -m json.tool | head -40
```

Expected: valid JSON array of 5 objects; confirm each `name` matches
`infra/glue.tf`'s 5 table resources, each `columns` array's length
matches that table's column list in `infra/glue.tf`, and `location`
contains the real S3 bucket name (not empty, not a placeholder).

Then:

```bash
curl -sS -o /dev/null -w "HTTP %{http_code}\n" https://realtime-data-pipeline.vercel.app/catalog
```

Expected: `HTTP 200`.

Report both results to the user before declaring the task complete.
