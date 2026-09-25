# Catalog Excel Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real "Xuất Excel" button to `/catalog` that runs 5 real Athena queries, builds a real `.xlsx` workbook (one sheet per curated table), uploads it to the user's existing Cloudflare R2 `excel` bucket, and lets the browser download it via a short-lived presigned URL.

**Architecture:** A new API route (`/api/catalog/export`) reuses this codebase's existing Athena query helpers to fetch all 5 curated tables in parallel, hands the results to a new pure `excelExport.ts` module to build the workbook, then hands the resulting buffer to a new `r2.ts` module (an S3-compatible client pointed at Cloudflare R2) which uploads it and returns a presigned download URL. The `/catalog` page gets one new button that calls the route and redirects the browser to that URL.

**Tech Stack:** Next.js 15 App Router, TypeScript, Vitest, `exceljs` (new), `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` (new, R2 is S3-API-compatible).

**Spec:** `docs/superpowers/specs/2026-09-25-catalog-excel-export-design.md`

## Global Constraints

- No Terraform changes anywhere in this plan — both R2 buckets already exist; this is application-level code only.
- Every AWS/R2-touching function takes its client as its first parameter (dependency injection), so tests use a plain fake object and never touch real credentials — mirrors `lib/eventbridge.ts`'s `getScheduleStatus(client, ruleName)` and every other client-taking function in this codebase.
- New required env vars (documented in `.env.example`, no values committed): `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_EXCEL_BUCKET_NAME`. The user creates the real R2 API token themselves and pastes it into Vercel's env var UI — no task in this plan ever invents or requests a credential value.
- Each export sheet is capped at `LIMIT 5000` rows per table (bounded Athena cost/file size, per the approved spec).
- The presigned download URL expires in 600 seconds (10 minutes).
- The rate limiter for this route must key on `clientIp(request)`, never a client-controlled value (this project already found and fixed exactly this bug once, on the conversation-rate-limit route — do not repeat it).
- All-or-nothing: if any of the 5 Athena queries fails, nothing is uploaded to R2 and the client gets one safe error message (never raw AWS internals — same redaction pattern already used by `/api/explorer/query`).
- No component-rendering test infrastructure exists in this codebase (Vitest runs with `environment: "node"`) — `catalog/page.tsx`'s button is verified by starting the real dev server and driving it with Playwright/the browser tooling, not a component unit test. This matches how every other page-level UI change in this project has been verified.

## Review Focus

- **A table with 0 rows this run must still produce a valid sheet** (header row only, no thrown error) — pinned by Task 1's empty-rows test.
- **The rate limiter must be keyed on IP, not a client-controlled value** — pinned by Task 3's route test asserting `checkRateLimit` is called with `clientIp(request)`.
- **A failed Athena query must never result in a partial/corrupt upload** — pinned by Task 3's route test asserting `uploadAndPresign` is never called when `runAthenaQueryWithStats` rejects.
- **The presigned URL's expiry must actually reach `getSignedUrl`, not get silently dropped** — pinned by Task 2's test asserting `expiresIn` is passed through.
- **The R2 credential-touching module must never be importable from client-side code** — pinned by Task 4's step 3 (grep-based import check), since this codebase has no automated bundle-content test for this property (the same property was verified this way for `lib/supabase.ts` earlier in this project).

---

### Task 1: `web/lib/excelExport.ts` — build the workbook

**Files:**
- Create: `web/lib/excelExport.ts`
- Test: `web/lib/excelExport.test.ts`
- Modify: `web/package.json` (add the `exceljs` dependency)

**Interfaces:**
- Produces: `type ExportSheet = { name: string; columns: string[]; rows: (string | null)[][] }` and `buildCatalogWorkbook(sheets: ExportSheet[]): Promise<Buffer>` — Task 3 calls this with one `ExportSheet` per curated table.

- [ ] **Step 1: Add the `exceljs` dependency**

Run: `cd web && npm install exceljs`

This adds `exceljs` to `web/package.json`'s `dependencies` and updates `web/package-lock.json`.

- [ ] **Step 2: Write the failing tests**

Create `web/lib/excelExport.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { buildCatalogWorkbook } from "./excelExport";

describe("buildCatalogWorkbook", () => {
  it("writes a header row and data rows for one sheet", async () => {
    const buffer = await buildCatalogWorkbook([
      {
        name: "hackernews_stories",
        columns: ["story_id", "title"],
        rows: [
          ["1", "Hello"],
          ["2", "World"],
        ],
      },
    ]);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.getWorksheet("hackernews_stories");

    expect(sheet).toBeDefined();
    expect(sheet!.rowCount).toBe(3);
    expect(sheet!.getRow(1).values).toEqual([undefined, "story_id", "title"]);
    expect(sheet!.getRow(2).values).toEqual([undefined, "1", "Hello"]);
    expect(sheet!.getRow(3).values).toEqual([undefined, "2", "World"]);
  });

  it("writes multiple sheets in the given order", async () => {
    const buffer = await buildCatalogWorkbook([
      { name: "a_table", columns: ["x"], rows: [["1"]] },
      { name: "b_table", columns: ["y"], rows: [["2"]] },
    ]);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    expect(workbook.worksheets.map((w) => w.name)).toEqual(["a_table", "b_table"]);
  });

  it("writes a header-only sheet when a table has zero rows", async () => {
    const buffer = await buildCatalogWorkbook([{ name: "empty_table", columns: ["x", "y"], rows: [] }]);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.getWorksheet("empty_table")!;

    expect(sheet.rowCount).toBe(1);
    expect(sheet.getRow(1).values).toEqual([undefined, "x", "y"]);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd web && npx vitest run lib/excelExport.test.ts`
Expected: FAIL — `Cannot find module './excelExport'` (the file doesn't exist yet).

- [ ] **Step 4: Write the implementation**

Create `web/lib/excelExport.ts`:

```ts
import ExcelJS from "exceljs";

export type ExportSheet = { name: string; columns: string[]; rows: (string | null)[][] };

export async function buildCatalogWorkbook(sheets: ExportSheet[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();

  for (const sheet of sheets) {
    const worksheet = workbook.addWorksheet(sheet.name);
    worksheet.addRow(sheet.columns);
    for (const row of sheet.rows) {
      worksheet.addRow(row);
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd web && npx vitest run lib/excelExport.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
cd web && git add package.json package-lock.json lib/excelExport.ts lib/excelExport.test.ts
git commit -m "feat: add buildCatalogWorkbook for the catalog Excel export"
```

---

### Task 2: `web/lib/r2.ts` — upload to Cloudflare R2 and presign a download URL

**Files:**
- Create: `web/lib/r2.ts`
- Test: `web/lib/r2.test.ts`
- Modify: `web/package.json` (add `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`)
- Modify: `web/.env.example` (document the 4 new R2 env vars)

**Interfaces:**
- Consumes: `requiredEnv(name: string): string` from `web/lib/aws.ts` (already exists — throws if the named env var is missing).
- Produces: `getR2Client(): S3Client` and `uploadAndPresign(client: S3Client, bucket: string, key: string, body: Buffer, contentType: string, expiresInSeconds?: number): Promise<string>` — Task 3 imports both.

- [ ] **Step 1: Add the R2/S3 dependencies**

Run: `cd web && npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner`

- [ ] **Step 2: Write the failing tests**

Create `web/lib/r2.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { PutObjectCommand, GetObjectCommand, type S3Client } from "@aws-sdk/client-s3";

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn().mockResolvedValue("https://example.r2.dev/signed-url"),
}));

import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { uploadAndPresign } from "./r2";

const mockedGetSignedUrl = vi.mocked(getSignedUrl);

beforeEach(() => {
  mockedGetSignedUrl.mockClear();
});

describe("uploadAndPresign", () => {
  it("uploads the body with the given bucket/key/contentType", async () => {
    const send = vi.fn().mockResolvedValue({});
    const client = { send } as unknown as S3Client;

    await uploadAndPresign(client, "excel", "exports/test.xlsx", Buffer.from("data"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");

    expect(send).toHaveBeenCalledOnce();
    const putCommand = send.mock.calls[0][0] as PutObjectCommand;
    expect(putCommand.input).toEqual({
      Bucket: "excel",
      Key: "exports/test.xlsx",
      Body: Buffer.from("data"),
      ContentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
  });

  it("returns whatever getSignedUrl resolves to", async () => {
    const send = vi.fn().mockResolvedValue({});
    const client = { send } as unknown as S3Client;

    const url = await uploadAndPresign(client, "excel", "exports/test.xlsx", Buffer.from("data"), "text/plain");

    expect(url).toBe("https://example.r2.dev/signed-url");
  });

  it("defaults the presigned URL to a 600-second expiry", async () => {
    const send = vi.fn().mockResolvedValue({});
    const client = { send } as unknown as S3Client;

    await uploadAndPresign(client, "excel", "exports/test.xlsx", Buffer.from("data"), "text/plain");

    expect(mockedGetSignedUrl).toHaveBeenCalledWith(client, expect.any(GetObjectCommand), { expiresIn: 600 });
  });

  it("passes a custom expiresInSeconds through to getSignedUrl", async () => {
    const send = vi.fn().mockResolvedValue({});
    const client = { send } as unknown as S3Client;

    await uploadAndPresign(client, "excel", "exports/test.xlsx", Buffer.from("data"), "text/plain", 120);

    expect(mockedGetSignedUrl).toHaveBeenCalledWith(client, expect.any(GetObjectCommand), { expiresIn: 120 });
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd web && npx vitest run lib/r2.test.ts`
Expected: FAIL — `Cannot find module './r2'`.

- [ ] **Step 4: Write the implementation**

Create `web/lib/r2.ts`:

```ts
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { requiredEnv } from "@/lib/aws";

let r2Client: S3Client | undefined;

export function getR2Client(): S3Client {
  if (!r2Client) {
    r2Client = new S3Client({
      region: "auto",
      endpoint: `https://${requiredEnv("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: requiredEnv("R2_ACCESS_KEY_ID"),
        secretAccessKey: requiredEnv("R2_SECRET_ACCESS_KEY"),
      },
    });
  }
  return r2Client;
}

export async function uploadAndPresign(
  client: S3Client,
  bucket: string,
  key: string,
  body: Buffer,
  contentType: string,
  expiresInSeconds = 600
): Promise<string> {
  await client.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType })
  );
  return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
    expiresIn: expiresInSeconds,
  });
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd web && npx vitest run lib/r2.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Document the new env vars**

Append to `web/.env.example` (check the file first — add these 4 lines in the same `KEY=` style as its existing entries, with no values):

```
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_EXCEL_BUCKET_NAME=
```

- [ ] **Step 7: Commit**

```bash
cd web && git add package.json package-lock.json lib/r2.ts lib/r2.test.ts .env.example
git commit -m "feat: add Cloudflare R2 upload-and-presign helper"
```

---

### Task 3: `web/app/api/catalog/export/route.ts` — the export endpoint

**Files:**
- Create: `web/app/api/catalog/export/route.ts`
- Test: `web/app/api/catalog/export/route.test.ts`
- Modify: `web/lib/ratelimit.ts` (add `getExportLimiter`)

**Interfaces:**
- Consumes: `buildCatalogWorkbook` (Task 1), `getR2Client`/`uploadAndPresign` (Task 2), `getAthenaClient`/`requiredEnv` (`web/lib/aws.ts`, existing), `runAthenaQueryWithStats`/`parseAthenaRows` (`web/lib/athena.ts`, existing), `checkRateLimit` (`web/lib/ratelimit.ts`, existing), `clientIp` (`web/lib/clientIp.ts`, existing).
- Produces: `POST` handler returning `{ url: string }` on success, `{ error: string }` with status 429 (rate limited) or 500 (any other failure) otherwise. No later task consumes this directly by import — Task 4 calls it over HTTP.

- [ ] **Step 1: Add `getExportLimiter` to `web/lib/ratelimit.ts`**

Open `web/lib/ratelimit.ts` and add this block after `getConversationLimiter` (following the exact same shape as the other limiter getters already in that file):

```ts
let exportLimiter: Ratelimit | undefined;
export function getExportLimiter(): Ratelimit {
  if (!exportLimiter) {
    const redis = new Redis({
      url: requiredEnv("UPSTASH_REDIS_REST_URL"),
      token: requiredEnv("UPSTASH_REDIS_REST_TOKEN"),
    });
    exportLimiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(3, "1 h"),
      prefix: "export-ratelimit",
    });
  }
  return exportLimiter;
}
```

No new test file is needed for this step: this codebase's existing `lib/ratelimit.test.ts` only tests the generic `checkRateLimit` function with a fake limiter, and never unit-tests the individual limiter getters (`getExplorerLimiter`, `getCostLimiter`, `getConversationLimiter` have no dedicated tests either) — Task 3's route test below exercises `getExportLimiter` indirectly.

- [ ] **Step 2: Write the failing tests**

Create `web/app/api/catalog/export/route.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/aws", () => ({
  getAthenaClient: vi.fn(() => ({})),
  requiredEnv: vi.fn((name: string) => `fake-${name}`),
}));
vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: vi.fn(),
  getExportLimiter: vi.fn(() => "export-limiter-marker"),
}));
vi.mock("@/lib/athena", async () => {
  // Keep the real parseAthenaRows (route.ts uses it on runAthenaQueryWithStats's
  // output) while mocking only the network-calling function.
  const actual = await vi.importActual<typeof import("@/lib/athena")>("@/lib/athena");
  return { ...actual, runAthenaQueryWithStats: vi.fn() };
});
vi.mock("@/lib/excelExport", () => ({ buildCatalogWorkbook: vi.fn() }));
vi.mock("@/lib/r2", () => ({ getR2Client: vi.fn(() => ({})), uploadAndPresign: vi.fn() }));

import { checkRateLimit } from "@/lib/ratelimit";
import { runAthenaQueryWithStats } from "@/lib/athena";
import { buildCatalogWorkbook } from "@/lib/excelExport";
import { uploadAndPresign } from "@/lib/r2";
import { POST } from "./route";

const mockedCheckRateLimit = vi.mocked(checkRateLimit);
const mockedRun = vi.mocked(runAthenaQueryWithStats);
const mockedBuild = vi.mocked(buildCatalogWorkbook);
const mockedUpload = vi.mocked(uploadAndPresign);

function makeRequest(): NextRequest {
  return new NextRequest("http://localhost/api/catalog/export", {
    method: "POST",
    headers: { "x-forwarded-for": "9.9.9.9" },
  });
}

function athenaRow(value: string) {
  return { Data: [{ VarCharValue: value }] };
}

beforeEach(() => {
  mockedCheckRateLimit.mockReset();
  mockedRun.mockReset();
  mockedBuild.mockReset();
  mockedUpload.mockReset();
});

describe("POST /api/catalog/export", () => {
  it("returns 429 and never queries Athena when rate limited", async () => {
    mockedCheckRateLimit.mockResolvedValue({ allowed: false, remaining: 0 });

    const response = await POST(makeRequest());

    expect(response.status).toBe(429);
    expect(mockedCheckRateLimit).toHaveBeenCalledWith("9.9.9.9", "export-limiter-marker");
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("queries all 5 curated tables, builds one workbook, and returns the presigned url", async () => {
    mockedCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 2 });
    mockedRun.mockResolvedValue({
      columns: ["a"],
      rows: [athenaRow("a"), athenaRow("1")],
      stats: { dataScannedInBytes: 0, engineExecutionTimeMs: 0 },
      hasMoreRows: false,
    });
    mockedBuild.mockResolvedValue(Buffer.from("fake-xlsx"));
    mockedUpload.mockResolvedValue("https://example.r2.dev/signed-url");

    const response = await POST(makeRequest());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.url).toBe("https://example.r2.dev/signed-url");
    expect(mockedRun).toHaveBeenCalledTimes(5);
    expect(mockedBuild).toHaveBeenCalledWith([
      { name: "hackernews_stories", columns: ["a"], rows: [["1"]] },
      { name: "news_articles", columns: ["a"], rows: [["1"]] },
      { name: "github_repos", columns: ["a"], rows: [["1"]] },
      { name: "weather_observations", columns: ["a"], rows: [["1"]] },
      { name: "crypto_prices", columns: ["a"], rows: [["1"]] },
    ]);
    expect(mockedUpload).toHaveBeenCalledWith(
      expect.anything(),
      "fake-R2_EXCEL_BUCKET_NAME",
      expect.stringMatching(/^exports\/catalog-.*\.xlsx$/),
      Buffer.from("fake-xlsx"),
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
  });

  it("returns a safe 500 and never uploads when an Athena query fails", async () => {
    mockedCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 2 });
    mockedRun.mockRejectedValue(new Error("Athena query failed: some real AWS internals, ARNs, etc"));

    const response = await POST(makeRequest());

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("Không xuất được file Excel, thử lại sau.");
    expect(body.error).not.toContain("ARN");
    expect(mockedUpload).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd web && npx vitest run app/api/catalog/export/route.test.ts`
Expected: FAIL — `Cannot find module './route'`.

- [ ] **Step 4: Write the implementation**

Create `web/app/api/catalog/export/route.ts`:

```ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getAthenaClient, requiredEnv } from "@/lib/aws";
import { runAthenaQueryWithStats, parseAthenaRows } from "@/lib/athena";
import { buildCatalogWorkbook, type ExportSheet } from "@/lib/excelExport";
import { getR2Client, uploadAndPresign } from "@/lib/r2";
import { checkRateLimit, getExportLimiter } from "@/lib/ratelimit";
import { clientIp } from "@/lib/clientIp";

export const maxDuration = 60;

const EXPORT_TABLES = [
  "hackernews_stories",
  "news_articles",
  "github_repos",
  "weather_observations",
  "crypto_prices",
];

const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export async function POST(request: NextRequest) {
  const rateLimit = await checkRateLimit(clientIp(request), getExportLimiter());
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: "Đợi một chút rồi thử xuất lại." }, { status: 429 });
  }

  try {
    const athenaClient = getAthenaClient();
    const sheets: ExportSheet[] = await Promise.all(
      EXPORT_TABLES.map(async (table) => {
        const { columns, rows } = await runAthenaQueryWithStats(athenaClient, `SELECT * FROM ${table} LIMIT 5000`);
        return { name: table, columns, rows: parseAthenaRows(rows, (cols) => cols) };
      })
    );

    const buffer = await buildCatalogWorkbook(sheets);
    const key = `exports/catalog-${new Date().toISOString().replace(/[:.]/g, "-")}.xlsx`;
    const url = await uploadAndPresign(
      getR2Client(),
      requiredEnv("R2_EXCEL_BUCKET_NAME"),
      key,
      buffer,
      XLSX_CONTENT_TYPE
    );

    return NextResponse.json({ url });
  } catch (error) {
    console.error("Catalog export failed", error);
    return NextResponse.json({ error: "Không xuất được file Excel, thử lại sau." }, { status: 500 });
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd web && npx vitest run app/api/catalog/export/route.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Run the full web test suite**

Run: `cd web && npx vitest run`
Expected: PASS, all files including the new ones from Tasks 1-3.

- [ ] **Step 7: Commit**

```bash
cd web && git add lib/ratelimit.ts app/api/catalog/export/route.ts app/api/catalog/export/route.test.ts
git commit -m "feat: add POST /api/catalog/export"
```

---

### Task 4: `/catalog` page — the "Xuất Excel" button

**Files:**
- Modify: `web/app/catalog/page.tsx`

**Interfaces:**
- Consumes: `POST /api/catalog/export` (Task 3) over `fetch`, response shape `{ url: string }` on 200 or `{ error: string }` otherwise.

- [ ] **Step 1: Add export state and the handler**

In `web/app/catalog/page.tsx`, inside `export default function CatalogPage()`, add two new state variables alongside the existing ones (`tables`, `error`, `selected`, `cicd`, `costBreakdown`):

```ts
const [exporting, setExporting] = useState(false);
const [exportError, setExportError] = useState<string | null>(null);
```

Add this function in the same component, after the existing `load` function:

```ts
async function handleExport() {
  setExporting(true);
  setExportError(null);
  try {
    const res = await fetch("/api/catalog/export", { method: "POST" });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? "Không xuất được file Excel.");
    window.location.href = body.url;
  } catch (err) {
    setExportError(err instanceof Error ? err.message : "Không xuất được file Excel.");
  } finally {
    setExporting(false);
  }
}
```

- [ ] **Step 2: Add the button to the page header**

Find this block (the page header, right after `const current = tables.find(...)`):

```tsx
      <div>
        <h1 className="font-heading text-2xl font-semibold text-textPrimary">Architecture & Lakehouse</h1>
        <p className="mt-1.5 text-sm text-textSecondary tabular-nums">
          Kiến trúc pipeline, trạng thái CI/CD, chi phí hạ tầng, và {tables.length} bảng trong Glue Data Catalog
        </p>
      </div>
```

Replace it with:

```tsx
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-textPrimary">Architecture & Lakehouse</h1>
          <p className="mt-1.5 text-sm text-textSecondary tabular-nums">
            Kiến trúc pipeline, trạng thái CI/CD, chi phí hạ tầng, và {tables.length} bảng trong Glue Data Catalog
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <button
            onClick={handleExport}
            disabled={exporting}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-surface/75 backdrop-blur-md px-3.5 py-2 text-xs font-semibold text-textPrimary disabled:opacity-50 transition-shadow hover:shadow-glowCyan"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
              <path d="M12 3v12m0 0 4-4m-4 4-4-4" />
              <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
            </svg>
            {exporting ? "Đang xuất..." : "Xuất Excel"}
          </button>
          {exportError && <p className="text-error text-[11px] max-w-[220px] text-right">{exportError}</p>}
        </div>
      </div>
```

- [ ] **Step 3: Verify `lib/r2.ts` is never imported client-side**

Run:

```bash
cd web && grep -rn "from \"@/lib/r2\"" app components
```

Expected: only `app/api/catalog/export/route.ts` (a server-only route file) matches. If any `"use client"` file matches, stop and fix the import before continuing — this would leak the R2 credential-touching module into the client bundle.

- [ ] **Step 4: Type-check and build**

Run: `cd web && npx tsc --noEmit && npx next build`
Expected: both succeed with no errors.

- [ ] **Step 5: Manual live verification with a real browser**

This page has no component-rendering test infrastructure (see Global Constraints), so verify by hand:

```bash
cd web && npx next dev -p 3411
```

Then, using the browser tooling available in this session, navigate to `http://localhost:3411/catalog` (or `127.0.0.1` if `localhost` doesn't resolve for the tool in use), take a screenshot to confirm the "Xuất Excel" button renders in the header, click it, and confirm one of two real outcomes:
- If real `R2_ACCOUNT_ID`/`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`/`R2_EXCEL_BUCKET_NAME` and AWS Athena credentials are present in `web/.env.local`, confirm the browser navigates to a real presigned R2 URL and downloads a real `.xlsx` file.
- If those env vars are not present locally, confirm the button shows the loading state then a clear error message (never a silent failure or an unhandled exception in the console) — this still proves the request/response wiring works; full success is then verified after deploy, against the real production env vars in Vercel.

Stop the dev server and delete any screenshot/log files created for this verification before committing (this repo's convention — see `.gitignore`'s `.playwright-mcp/` entry).

- [ ] **Step 6: Commit**

```bash
cd web && git add app/catalog/page.tsx
git commit -m "feat: add Xuất Excel button to /catalog"
```

---

## Post-plan: real deploy verification

Not a task in this plan (no code changes) — after all 4 tasks are pushed and deployed, the user must add the 4 real `R2_ACCOUNT_ID`/`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`/`R2_EXCEL_BUCKET_NAME` values to Vercel's env var UI themselves (this assistant never handles the real token). Once set, a real click on the deployed `/catalog` page's "Xuất Excel" button is the final end-to-end proof — same live-verification pattern already used for the RAG Assistant conversations feature and the ingestion dedup fix earlier in this project.
