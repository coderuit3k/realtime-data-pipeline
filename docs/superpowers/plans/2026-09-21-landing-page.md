# Landing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the app's root route (`/`) with a static portfolio
landing page (the 8th and final mockup screen), moving the current
Dashboard to `/dashboard`.

**Architecture:** A pure static server component at `web/app/page.tsx`
(no fetch, no client state) showing real, cited architectural facts
(data source count, Lambda count, test count, monthly cost, weather
region count) sourced from existing constants elsewhere in this app. The
current Dashboard moves to a new `/dashboard` route unchanged.

**Tech Stack:** Next.js 15 App Router, TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-21-landing-page-design.md`

## Global Constraints

- No live API route, no new AWS credential -- every number on this page
  is a build-time constant with an inline citation, matching
  `opsMeta.ts`'s established convention for static facts.
- No shared `<NavBar>` on the Landing route (`/`) -- matches the
  mockup's own layout choice and real landing-page convention.
- Real, verified numbers (not the mockup's stale ones): `DATA_SOURCE_COUNT`
  = 5 (from `settingsMeta.ts`'s `DATA_SOURCES.length`), `LAMBDA_COUNT` =
  9 (6 pipeline + 3 RAG, verified via `grep -n "^resource
  \"aws_lambda_function\"" infra/*.tf`), `TEST_COUNT` = 233 (73 real
  pytest + 160 real vitest -- the vitest count includes this feature's
  own `landingMeta.test.ts`, since that file is part of the same
  real, currently-passing suite it's describing; corrected during
  Task 1's review after an initial count of 228 measured vitest
  *before* that test file existed, undercounting by exactly the 5
  tests the task itself adds; verified 2026-09-21), `MONTHLY_COST_USD`
  reused from `opsMeta.ts`'s `COST_ESTIMATE_USD` (1.02, displayed as
  `$1`), `WEATHER_LOCATION_COUNT` = 12 (from `weatherMeta.ts`'s
  `WEATHER_LOCATION_NAMES.length`). `DATA_SOURCE_COUNT` and
  `WEATHER_LOCATION_COUNT` must be genuinely re-derived from their
  source arrays' `.length`, never a second hardcoded number, so they
  can't silently drift from the arrays they describe.
- Corrected copy vs. the mockup: weather region count says 12, not 4;
  ingestion cadence says "mỗi 10-20 phút tuỳ nguồn" (varies by source),
  not a blanket "mỗi 10 phút" (News API has had its own separate,
  slower `rate(20 minutes)` rule since the Ops sub-project's real
  rate-limit incident fix); both inline "test tự động" mentions (hero
  stat row and the IaC/CI-CD feature card) show the real 233, not the
  mockup's stale 73.
- Tech stack chips: the mockup's original 8 (Python, Terraform, AWS
  Lambda, S3, Glue, Athena, Bedrock, GitHub Actions) plus 3 real,
  currently-used additions (Next.js, TypeScript, Vercel).
- Links: "Mã nguồn" / "Xem trên GitHub" point at the real public repo
  (`https://github.com/coderuit3k/realtime-data-pipeline`); "Xem demo"
  points at `/dashboard`.
- Color tokens: use this app's existing Tailwind tokens (`accent` =
  `#2DD4BF`, matches the mockup's teal exactly; `surface`, `border`,
  `textPrimary`, `textSecondary`, `textMuted`), never raw hex values.

---

### Task 1: Real, cited landing-page constants

**Files:**
- Create: `web/lib/landingMeta.ts`
- Create: `web/lib/landingMeta.test.ts`

**Interfaces:**
- Consumes: `DATA_SOURCES` from `web/lib/settingsMeta.ts` (existing,
  built for the Settings sub-project); `WEATHER_LOCATION_NAMES` from
  `web/lib/weatherMeta.ts` (existing, built for the Weather
  sub-project); `COST_ESTIMATE_USD` from `web/lib/opsMeta.ts` (existing).
- Produces: `DATA_SOURCE_COUNT: number`, `LAMBDA_COUNT: number`,
  `TEST_COUNT: number`, `MONTHLY_COST_USD: number`,
  `WEATHER_LOCATION_COUNT: number`. Task 3's page imports all five.

- [ ] **Step 1: Write the failing tests**

Create `web/lib/landingMeta.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DATA_SOURCES } from "./settingsMeta";
import { WEATHER_LOCATION_NAMES } from "./weatherMeta";
import {
  DATA_SOURCE_COUNT,
  LAMBDA_COUNT,
  TEST_COUNT,
  MONTHLY_COST_USD,
  WEATHER_LOCATION_COUNT,
} from "./landingMeta";

describe("landingMeta", () => {
  it("DATA_SOURCE_COUNT is genuinely derived from DATA_SOURCES, not a second hardcoded number", () => {
    expect(DATA_SOURCE_COUNT).toBe(DATA_SOURCES.length);
  });

  it("WEATHER_LOCATION_COUNT is genuinely derived from WEATHER_LOCATION_NAMES, not a second hardcoded number", () => {
    expect(WEATHER_LOCATION_COUNT).toBe(WEATHER_LOCATION_NAMES.length);
  });

  it("LAMBDA_COUNT is a positive real number", () => {
    expect(LAMBDA_COUNT).toBeGreaterThan(0);
  });

  it("TEST_COUNT is a positive real number", () => {
    expect(TEST_COUNT).toBeGreaterThan(0);
  });

  it("MONTHLY_COST_USD is a positive real number", () => {
    expect(MONTHLY_COST_USD).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run lib/landingMeta.test.ts`
Expected: FAIL -- module `./landingMeta` not found

- [ ] **Step 3: Implement**

Create `web/lib/landingMeta.ts`:

```ts
import { DATA_SOURCES } from "./settingsMeta";
import { WEATHER_LOCATION_NAMES } from "./weatherMeta";
import { COST_ESTIMATE_USD } from "./opsMeta";

// Real count of the 5 real ingestion sources -- derived from
// settingsMeta.ts's DATA_SOURCES (built for the Settings sub-project),
// never re-declared as a second hardcoded number, so this can't drift
// from the array it describes.
export const DATA_SOURCE_COUNT = DATA_SOURCES.length;

// Real count of aws_lambda_function resources across this project's
// Terraform, verified 2026-09-21 via:
//   grep -n '^resource "aws_lambda_function"' infra/*.tf
// 6 in infra/lambda.tf (hackernews/news/weather/crypto/github ingestion
// + transform) + 3 in infra/rag.tf (rag_build_index, rag_query,
// rag_agent) = 9.
export const LAMBDA_COUNT = 9;

// Real combined automated test count, verified 2026-09-21 AFTER this
// file's own test file (landingMeta.test.ts) was added -- that file is
// itself part of the real vitest suite this constant describes, so the
// count must include it, not the pre-this-commit vitest total:
//   .venv/bin/python -m pytest tests/ --collect-only -q   -> 73
//   cd web && npx vitest run                              -> 160 (34 files)
// 73 + 160 = 233. Both are real, currently-passing suites for this
// same project (Python pipeline + TypeScript web app).
export const TEST_COUNT = 233;

// Reused directly from opsMeta.ts's existing, already-cited
// COST_ESTIMATE_USD -- never re-derived separately.
export const MONTHLY_COST_USD = COST_ESTIMATE_USD;

// Real count of the 12 real Southern Vietnam weather locations --
// derived from weatherMeta.ts's WEATHER_LOCATION_NAMES (built for the
// Weather sub-project), never re-declared as a second hardcoded number.
export const WEATHER_LOCATION_COUNT = WEATHER_LOCATION_NAMES.length;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run lib/landingMeta.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add web/lib/landingMeta.ts web/lib/landingMeta.test.ts
git commit -m "Add Landing page's real, cited architectural-fact constants"
```

---

### Task 2: Move Dashboard to /dashboard

**Files:**
- Create: `web/app/dashboard/page.tsx`

**Interfaces:**
- Consumes: nothing new -- verbatim copy of the current
  `web/app/page.tsx`'s content (unchanged imports, unchanged behavior,
  unchanged fetch of `/api/dashboard`).
- Produces: the `/dashboard` route. Task 3 links to it (NavBar's first
  entry, and the Landing page's "Xem demo" CTAs).

This task has no dedicated automated test -- it is a verbatim file copy
of an already-tested, already-shipped page (Dashboard has its own
existing manual live-verification history from when it first shipped);
verified manually in Task 4 after deploy.

- [ ] **Step 1: Create the new route with the exact current Dashboard content**

Create `web/app/dashboard/page.tsx` with this exact content (verbatim
copy of the current `web/app/page.tsx`, before Task 3 rewrites that
file):

```tsx
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

- [ ] **Step 2: Run the full test suite and typecheck**

Run: `cd web && npx vitest run && npx tsc --noEmit`
Expected: all tests PASS (this task adds no new tests -- count
unchanged), tsc clean

- [ ] **Step 3: Commit**

```bash
git add web/app/dashboard/page.tsx
git commit -m "Add /dashboard route (Dashboard content, moved verbatim ahead of the Landing rewrite)"
```

---

### Task 3: NavBar update and the new Landing page

**Files:**
- Modify: `web/components/NavBar.tsx`
- Modify: `web/app/page.tsx` (rewritten -- becomes the Landing page)

**Interfaces:**
- Consumes: `DATA_SOURCE_COUNT`, `LAMBDA_COUNT`, `TEST_COUNT`,
  `MONTHLY_COST_USD`, `WEATHER_LOCATION_COUNT` (Task 1,
  `web/lib/landingMeta.ts`); the `/dashboard` route (Task 2).
- Produces: nothing (final content task -- Task 4 only deploys and
  verifies).

This task has no dedicated automated test (project convention: no
component tests for pages; this page additionally has no fetch to mock
since it is fully static). Verified manually in Task 4 after deploy.

- [ ] **Step 1: Update NavBar**

In `web/components/NavBar.tsx`:

1. Change the first entry in `LINKS` from
   `{ href: "/", label: "Tổng quan" }` to
   `{ href: "/dashboard", label: "Tổng quan" }`.
2. Add an early return right after the existing
   `const pathname = usePathname();` line, so the shared nav never
   renders on the new Landing route:

```tsx
  const pathname = usePathname();
  if (pathname === "/") return null;
```

The rest of the component (the `return (<nav>...)` block) is unchanged.

- [ ] **Step 2: Replace `web/app/page.tsx` with the Landing page**

Overwrite the entire current content of `web/app/page.tsx` (the
Dashboard content, already preserved verbatim at `/dashboard` by Task 2)
with:

```tsx
import Link from "next/link";
import type { ReactNode } from "react";
import {
  DATA_SOURCE_COUNT,
  LAMBDA_COUNT,
  TEST_COUNT,
  MONTHLY_COST_USD,
  WEATHER_LOCATION_COUNT,
} from "@/lib/landingMeta";

const GITHUB_URL = "https://github.com/coderuit3k/realtime-data-pipeline";

const TECH_STACK = [
  "Python",
  "Terraform",
  "AWS Lambda",
  "S3",
  "Glue",
  "Athena",
  "Bedrock",
  "GitHub Actions",
  "Next.js",
  "TypeScript",
  "Vercel",
];

function ArrowIcon() {
  return (
    <svg width="26" height="14" viewBox="0 0 26 14" fill="none" stroke="#3D4874" strokeWidth={2}>
      <path d="M0 7h22M17 2l6 5-6 5" />
    </svg>
  );
}

function FeatureCard({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface px-6 py-[22px] flex flex-col gap-2">
      {icon}
      <span className="text-sm font-semibold text-textPrimary">{title}</span>
      <span className="text-[12.5px] leading-relaxed text-textSecondary">{description}</span>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="flex flex-col">
      <header className="h-[76px] flex-shrink-0 flex items-center justify-between px-14 border-b border-border">
        <div className="flex items-center gap-2.5">
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-accent"
          >
            <path d="M13 2 3 14h8l-1 8 10-12h-8l1-8z" />
          </svg>
          <span className="font-heading text-base font-bold text-textPrimary">DataPulse</span>
        </div>
        <nav className="flex items-center gap-7">
          <a href="#architecture" className="text-[13px] text-textSecondary">
            Kiến trúc
          </a>
          <a href="#features" className="text-[13px] text-textSecondary">
            Tính năng
          </a>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-border px-4 py-2 text-[12.5px] text-textSecondary"
          >
            Mã nguồn
          </a>
          <Link href="/dashboard" className="rounded-lg bg-accent px-4 py-2 text-[12.5px] font-semibold text-bg">
            Xem demo →
          </Link>
        </nav>
      </header>

      <section className="px-14 pt-[88px] pb-16 flex flex-col items-center text-center gap-5 border-b border-border">
        <span className="font-mono text-[11px] tracking-wide text-accent bg-accent/10 px-3.5 py-1.5 rounded-full">
          PORTFOLIO PROJECT · DATA ENGINEERING
        </span>
        <h1 className="max-w-3xl font-heading text-[44px] leading-[1.15] font-bold text-textPrimary">
          Pipeline dữ liệu real-time, serverless, chạy thật trên AWS
        </h1>
        <p className="max-w-xl text-[15px] leading-relaxed text-textSecondary">
          5 nguồn dị chủng đổ về S3 → Glue/Athena, cộng 2 kiến trúc RAG song song trên Bedrock — một pipeline cố
          định (CRAG) và một agent tự quyết định gọi tool. Toàn bộ hạ tầng bằng Terraform, deploy qua GitHub
          Actions với gate phê duyệt production.
        </p>
        <div className="flex gap-3 mt-1.5">
          <Link href="/dashboard" className="rounded-lg bg-accent px-6 py-3 text-[13.5px] font-semibold text-bg">
            Xem demo nội bộ →
          </Link>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-border px-6 py-3 text-[13.5px] text-textPrimary"
          >
            Xem trên GitHub
          </a>
        </div>
        <div className="flex gap-10 mt-6">
          <div className="flex flex-col items-center">
            <span className="font-mono text-xl text-textPrimary">{DATA_SOURCE_COUNT}</span>
            <span className="text-[11px] text-textMuted">nguồn dữ liệu</span>
          </div>
          <div className="flex flex-col items-center">
            <span className="font-mono text-xl text-textPrimary">{LAMBDA_COUNT}</span>
            <span className="text-[11px] text-textMuted">Lambda serverless</span>
          </div>
          <div className="flex flex-col items-center">
            <span className="font-mono text-xl text-textPrimary">{TEST_COUNT}</span>
            <span className="text-[11px] text-textMuted">test tự động</span>
          </div>
          <div className="flex flex-col items-center">
            <span className="font-mono text-xl text-textPrimary">${MONTHLY_COST_USD.toFixed(0)}</span>
            <span className="text-[11px] text-textMuted">chi phí / tháng</span>
          </div>
        </div>
      </section>

      <section id="architecture" className="px-14 py-[52px] flex flex-col gap-6 border-b border-border">
        <span className="text-center font-heading text-[19px] font-semibold text-textPrimary">
          Kiến trúc trong một dòng
        </span>
        <div className="flex items-center justify-center gap-3.5 flex-wrap">
          <div className="rounded-2xl border border-border bg-surface px-4 py-3.5 flex flex-col items-center gap-1 w-[120px]">
            <span className="text-[11.5px] text-textPrimary">HN · News</span>
            <span className="text-[11.5px] text-textPrimary">Weather · Crypto</span>
            <span className="text-[11.5px] text-textPrimary">GitHub</span>
          </div>
          <ArrowIcon />
          <div className="rounded-2xl border border-border bg-surface px-[18px] py-3.5 text-center w-[160px]">
            <span className="font-mono text-[11.5px] text-textPrimary">S3 raw → curated</span>
          </div>
          <ArrowIcon />
          <div className="rounded-2xl border border-border bg-surface px-[18px] py-3.5 text-center w-[160px]">
            <span className="font-mono text-[11.5px] text-textPrimary">Glue Catalog + Athena</span>
          </div>
          <ArrowIcon />
          <div className="rounded-2xl border border-accent bg-surface px-[18px] py-3.5 text-center w-[170px]">
            <span className="font-mono text-[11.5px] text-accent">RAG: CRAG + Agent</span>
          </div>
        </div>
      </section>

      <section id="features" className="px-14 py-[52px] grid grid-cols-2 gap-4 border-b border-border">
        <FeatureCard
          icon={
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2DD4BF" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
          }
          title="5 nguồn dữ liệu dị chủng"
          description={`Hacker News, News API, thời tiết Open-Meteo (${WEATHER_LOCATION_COUNT} khu vực), giá crypto CoinGecko, GitHub trending — ingest mỗi 10-20 phút tuỳ nguồn.`}
        />
        <FeatureCard
          icon={
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2DD4BF" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="9" rx="1.5" />
              <rect x="14" y="3" width="7" height="5" rx="1.5" />
              <rect x="14" y="12" width="7" height="9" rx="1.5" />
              <rect x="3" y="16" width="7" height="5" rx="1.5" />
            </svg>
          }
          title="100% serverless trên AWS"
          description="Lambda, EventBridge, S3, Glue, Athena — không quản lý server, không crawler, partition projection."
        />
        <FeatureCard
          icon={
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2DD4BF" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
            </svg>
          }
          title="RAG kép: CRAG + Agentic"
          description="So sánh trực tiếp pipeline CRAG cố định với một agent thật tự gọi tool qua Bedrock Converse API."
        />
        <FeatureCard
          icon={
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2DD4BF" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <line x1="6" y1="3" x2="6" y2="15" />
              <circle cx="18" cy="6" r="3" />
              <circle cx="6" cy="18" r="3" />
              <path d="M18 9a9 9 0 0 1-9 9" />
            </svg>
          }
          title="IaC + CI/CD thật"
          description={`Terraform 2-stack, GitHub Actions qua OIDC, gate phê duyệt thủ công trước khi apply production, ${TEST_COUNT} test tự động.`}
        />
      </section>

      <section className="px-14 py-10 flex flex-col items-center gap-4 flex-grow">
        <span className="font-mono text-[10.5px] tracking-wide text-textMuted">TECH STACK</span>
        <div className="flex flex-wrap gap-2 justify-center max-w-3xl">
          {TECH_STACK.map((tech) => (
            <span
              key={tech}
              className="font-mono text-[11px] px-3 py-1.5 rounded-lg bg-surface border border-border text-textSecondary"
            >
              {tech}
            </span>
          ))}
        </div>
        <p className="mt-[18px] text-[11.5px] text-textMuted">Xây dựng để ứng tuyển vị trí Data Engineer Intern · 2026</p>
      </section>
    </div>
  );
}
```

- [ ] **Step 3: Run the full test suite and typecheck**

Run: `cd web && npx vitest run && npx tsc --noEmit`
Expected: all tests PASS (this task adds no new tests -- count
unchanged from Task 1's 5 new tests), tsc clean

- [ ] **Step 4: Commit**

```bash
git add web/components/NavBar.tsx web/app/page.tsx
git commit -m "Landing page takes over /, Dashboard lives at /dashboard"
```

---

### Task 4: Deploy and live-verify

**Files:** none (no code changes -- this task pushes and verifies).

**Interfaces:**
- Consumes: nothing new -- no new AWS credential, no new IAM grant, no
  new Terraform resource.
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
curl -s -o /dev/null -w "/ -> %{http_code}\n" https://realtime-data-pipeline.vercel.app/
curl -s -o /dev/null -w "/dashboard -> %{http_code}\n" https://realtime-data-pipeline.vercel.app/dashboard
curl -s https://realtime-data-pipeline.vercel.app/dashboard | grep -o "Tổng quan hệ thống"
curl -s https://realtime-data-pipeline.vercel.app/ | grep -oE "nguồn dữ liệu|Lambda serverless|test tự động|chi phí"
curl -s https://realtime-data-pipeline.vercel.app/ | grep -c "DataPulse"
```

Confirm: both `/` and `/dashboard` return `200`; `/dashboard`'s HTML
contains the real Dashboard heading ("Tổng quan hệ thống"), confirming
the move preserved it exactly; `/`'s HTML contains all 4 stat labels
(proving the real numbers rendered); manually load `/` in a way you can
inspect (or `curl` the full HTML and read it) to confirm the shared nav
bar is NOT present on `/` but IS present when loading `/dashboard` and
every other existing page (`/assistant`, `/catalog`, `/explorer`,
`/insights`, `/ops`, `/cicd`, `/weather`, `/settings` -- spot-check at
least 2 of these still show the nav with a working, highlighted
"Tổng quan" link pointing at `/dashboard`); confirm the "Mã nguồn" and
"Xem demo" links/buttons on `/` resolve to the real GitHub repo URL and
`/dashboard` respectively (their `href` attributes, visible in the raw
HTML).
