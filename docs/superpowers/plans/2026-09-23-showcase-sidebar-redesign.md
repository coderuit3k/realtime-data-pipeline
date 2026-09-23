# Sidebar 4-Mục + Showcase & Overview Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the app's sidebar navigation from 9 links down to the 4-item IA shown in the Stitch "Terminal Obsidian · Phương án 1" design (Showcase & Overview, Live Metrics & Ops, RAG Comparison Studio, Architecture & Lakehouse), and rebuild the landing page (`/`) to live inside that same sidebar shell with a real GitHub commits panel and a real log-stream footer, matching the Showcase & Overview mockup.

**Architecture:** `components/Sidebar.tsx` (already rendered by every route via `app/layout.tsx`) currently early-returns `null` on `/` and lists 9 links in two groups. It becomes a flat 4-link list, no early return. `app/page.tsx` currently renders its own full-width marketing header outside the sidebar shell; it's rewritten to a two-column layout (main content + right rail) that lives inside `<main>` next to the sidebar, reusing all of its existing real data (`DATA_SOURCE_COUNT`, `LAMBDA_COUNT`, `TEST_COUNT`, `MONTHLY_COST_USD` from `lib/landingMeta.ts`) plus two new real, read-only data sources: recent GitHub commits (via a new `getRecentCommits()` in the existing `lib/github.ts`, same `GITHUB_READ_TOKEN` already used by `/api/cicd`) and the existing `/api/ops` endpoint's `recentLogs` field (already real CloudWatch Logs data, already used by the Ops page).

**Tech Stack:** Next.js 15 App Router, TypeScript, Vitest (`environment: "node"` — no component-rendering test infra exists in this repo; this plan does not add any), GitHub REST API.

**Spec:** No separate spec file — this is the first of four Stitch-design sub-projects (Showcase & Overview, Live Metrics & Ops, RAG Comparison Studio, Architecture & Lakehouse), scoped directly during brainstorming and approved in-chat. The three later sub-projects are separate, not-yet-planned work.

## Global Constraints

- Every new data point rendered on `/` must come from a real source already in this codebase or a real, already-integrated external API (GitHub REST) — never fabricated/mocked numbers.
- `GITHUB_READ_TOKEN` already exists as a real env var (set up by the user for the CI/CD sub-project) — do not ask the user to create a new credential for this plan.
- No task in this plan adds, modifies, or exposes any credential capable of a write/destructive action against real AWS or GitHub infrastructure.
- Do not introduce component-rendering test infrastructure (jsdom, @testing-library/react, etc.) — this repo's Vitest config is `environment: "node"` and has zero `.test.tsx` files; stay consistent with that. New server-side logic (lib functions, API routes) gets Vitest tests as usual; the two React component files touched in this plan (`Sidebar.tsx`, `page.tsx`) are verified by `tsc`, `next build`, and live browser verification after deploy — not by new component tests.
- `/settings` and `/weather` routes and their page/API files are left completely untouched in this plan — only their link is removed from the sidebar's rendered list.
- `/dashboard`, `/assistant`, `/catalog` pages are left completely untouched in this plan — only the sidebar labels/order pointing at them change.

---

### Task 1: `getRecentCommits()` in `lib/github.ts`

**Files:**
- Modify: `web/lib/github.ts`
- Modify: `web/lib/github.test.ts`

**Interfaces:**
- Consumes: existing `githubRequest<T>()`, `GITHUB_OWNER`, `GITHUB_REPO` (all already defined in this file).
- Produces: `getRecentCommits(limit: number): Promise<GithubCommit[]>` where `GithubCommit = { sha: string; message: string; authorName: string; date: string; htmlUrl: string }` — Task 2's route imports both the function and the type from `@/lib/github`.

- [ ] **Step 1: Write the failing test**

Add to `web/lib/github.test.ts` (after the existing `describe("getRecentRuns", ...)` block):

```ts
describe("getRecentCommits", () => {
  const REAL_COMMIT = {
    sha: "d566a7154738a4ae790b89ed0bea0265cdfebcd9",
    commit: {
      author: { name: "coderuit3k", date: "2026-09-23T03:08:05Z" },
      message: "feat: restyle web app to Terminal Obsidian design system",
    },
    html_url:
      "https://github.com/coderuit3k/realtime-data-pipeline/commit/d566a7154738a4ae790b89ed0bea0265cdfebcd9",
  };

  it("maps the real GitHub commit shape into GithubCommit, using only the message subject line", async () => {
    const multilineCommit = {
      ...REAL_COMMIT,
      sha: "abc0000000000000000000000000000000000000",
      commit: {
        ...REAL_COMMIT.commit,
        message: "fix: rate-limit /api/cost\n\nAlso corrects stale ops labels.",
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([REAL_COMMIT, multilineCommit]),
      })
    );

    const commits = await getRecentCommits(5);

    expect(commits).toEqual([
      {
        sha: "d566a7154738a4ae790b89ed0bea0265cdfebcd9",
        message: "feat: restyle web app to Terminal Obsidian design system",
        authorName: "coderuit3k",
        date: "2026-09-23T03:08:05Z",
        htmlUrl:
          "https://github.com/coderuit3k/realtime-data-pipeline/commit/d566a7154738a4ae790b89ed0bea0265cdfebcd9",
      },
      {
        sha: "abc0000000000000000000000000000000000000",
        message: "fix: rate-limit /api/cost",
        authorName: "coderuit3k",
        date: "2026-09-23T03:08:05Z",
        htmlUrl:
          "https://github.com/coderuit3k/realtime-data-pipeline/commit/d566a7154738a4ae790b89ed0bea0265cdfebcd9",
      },
    ]);
    const [url] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://api.github.com/repos/coderuit3k/realtime-data-pipeline/commits?per_page=5");
  });

  it("returns an empty array when the repo has no commits in range", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) }));
    const commits = await getRecentCommits(5);
    expect(commits).toEqual([]);
  });
});
```

Add `getRecentCommits` to the existing import line at the top of the test file:

```ts
import { getLatestWorkflowRun, getRunJobs, getRecentRuns, getRecentCommits } from "./github";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run lib/github.test.ts`
Expected: FAIL — `getRecentCommits is not a function` (or a TypeScript error naming the missing export).

- [ ] **Step 3: Write minimal implementation**

Add to `web/lib/github.ts`, after the existing `RawRun` type:

```ts
type RawCommit = {
  sha: string;
  commit: { author: { name: string; date: string } | null; message: string };
  html_url: string;
};
```

Add to `lib/types.ts` (not `github.ts` — this repo keeps all shared response/entity types in `lib/types.ts`; `GithubRun`/`GithubJob` are the precedent):

```ts
export type GithubCommit = {
  sha: string;
  message: string;
  authorName: string;
  date: string;
  htmlUrl: string;
};
```

Import `GithubCommit` into `web/lib/github.ts`'s existing type import line:

```ts
import type { GithubRun, GithubJob, GithubCommit } from "./types";
```

Add the mapper and function to `web/lib/github.ts`, after `mapRun`:

```ts
function mapCommit(raw: RawCommit): GithubCommit {
  return {
    sha: raw.sha,
    message: raw.commit.message.split("\n")[0],
    authorName: raw.commit.author?.name ?? "unknown",
    date: raw.commit.author?.date ?? "",
    htmlUrl: raw.html_url,
  };
}

export async function getRecentCommits(limit: number): Promise<GithubCommit[]> {
  const data = await githubRequest<RawCommit[]>(
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/commits?per_page=${limit}`
  );
  return data.map(mapCommit);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run lib/github.test.ts`
Expected: PASS, all `getRecentCommits` and pre-existing tests green.

- [ ] **Step 5: Commit**

```bash
cd web && git add lib/github.ts lib/github.test.ts lib/types.ts
git commit -m "feat: add getRecentCommits to lib/github.ts"
```

---

### Task 2: `GET /api/commits`

**Files:**
- Create: `web/app/api/commits/route.ts`
- Create: `web/app/api/commits/route.test.ts`

**Interfaces:**
- Consumes: `getRecentCommits(limit: number)` and `GithubCommit` from `@/lib/github` / `@/lib/types` (Task 1).
- Produces: `CommitsResponse = { commits: GithubCommit[] }` (added to `lib/types.ts`), served at `GET /api/commits`. Task 4's landing page fetches this route directly.

- [ ] **Step 1: Write the failing test**

Create `web/app/api/commits/route.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/github", () => ({ getRecentCommits: vi.fn() }));

import { getRecentCommits } from "@/lib/github";
import { GET } from "./route";

const mockedGetRecentCommits = vi.mocked(getRecentCommits);

beforeEach(() => {
  mockedGetRecentCommits.mockReset();
});

describe("GET /api/commits", () => {
  it("returns the 5 most recent real commits with a short Cache-Control", async () => {
    const commits = [
      {
        sha: "d566a7154738a4ae790b89ed0bea0265cdfebcd9",
        message: "feat: restyle web app to Terminal Obsidian design system",
        authorName: "coderuit3k",
        date: "2026-09-23T03:08:05Z",
        htmlUrl:
          "https://github.com/coderuit3k/realtime-data-pipeline/commit/d566a7154738a4ae790b89ed0bea0265cdfebcd9",
      },
    ];
    mockedGetRecentCommits.mockResolvedValue(commits);

    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("public, s-maxage=60, stale-while-revalidate=120");
    const body = await response.json();
    expect(body).toEqual({ commits });
    expect(mockedGetRecentCommits).toHaveBeenCalledWith(5);
  });

  it("returns 500 with a safe message when the GitHub API fails", async () => {
    mockedGetRecentCommits.mockRejectedValue(new Error("boom"));
    const response = await GET();
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("Không tải được commit, thử lại sau.");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run app/api/commits/route.test.ts`
Expected: FAIL — cannot find module `./route`.

- [ ] **Step 3: Write minimal implementation**

Add to `web/lib/types.ts`, after the `GithubCommit` type added in Task 1:

```ts
export type CommitsResponse = { commits: GithubCommit[] };
```

Create `web/app/api/commits/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getRecentCommits } from "@/lib/github";
import type { CommitsResponse } from "@/lib/types";

export const maxDuration = 60;

export async function GET() {
  try {
    const commits = await getRecentCommits(5);
    const response: CommitsResponse = { commits };

    return NextResponse.json(response, {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" },
    });
  } catch (error) {
    console.error("Commits API failed", error);
    return NextResponse.json({ error: "Không tải được commit, thử lại sau." }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run app/api/commits/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd web && git add app/api/commits/route.ts app/api/commits/route.test.ts lib/types.ts
git commit -m "feat: add GET /api/commits route"
```

---

### Task 3: Sidebar rewritten to the 4-item IA

**Files:**
- Modify: `web/components/Sidebar.tsx`

**Interfaces:**
- Consumes: nothing new — same `usePathname()`, `HealthResponse`, and `/api/health` fetch already in this file.
- Produces: nothing consumed by later tasks in this plan (Task 4 does not import from Sidebar), but the routes it links to (`/`, `/dashboard`, `/assistant`, `/catalog`) must stay exactly those four strings — later sub-projects (not part of this plan) will change what each of the latter three routes renders, not their paths.

This task has no automated test (see Global Constraints — no component test infra in this repo). Its deliverable is verified by `tsc --noEmit` and a `next build` passing, plus a live visual check after the whole plan deploys.

- [ ] **Step 1: Replace the two link groups with a flat 4-item list**

In `web/components/Sidebar.tsx`, replace the `ANALYTICS_LINKS` and `OPS_LINKS` arrays (and the `<nav>` block that renders them in two labelled groups) as follows.

Replace the two array declarations (lines defining `ANALYTICS_LINKS` through the end of `OPS_LINKS`) with a single array:

```ts
const NAV_LINKS: NavLink[] = [
  {
    href: "/",
    label: "Showcase & Overview",
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d="M13 2 3 14h8l-1 8 10-12h-8l1-8z" />
      </svg>
    ),
  },
  {
    href: "/dashboard",
    label: "Live Metrics & Ops",
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="9" rx="1.5" />
        <rect x="14" y="3" width="7" height="5" rx="1.5" />
        <rect x="14" y="12" width="7" height="9" rx="1.5" />
        <rect x="3" y="16" width="7" height="5" rx="1.5" />
      </svg>
    ),
  },
  {
    href: "/assistant",
    label: "RAG Comparison Studio",
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
      </svg>
    ),
  },
  {
    href: "/catalog",
    label: "Architecture & Lakehouse",
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M3 10h18M9 4v16" />
      </svg>
    ),
  },
];
```

Replace the `<nav className="flex flex-col gap-4">...</nav>` block (which currently renders `ANALYTICS_LINKS` and `OPS_LINKS` in two labelled groups) with:

```tsx
<nav className="flex flex-col gap-1">
  {NAV_LINKS.map((link) => (
    <SidebarLink key={link.href} link={link} active={pathname === link.href} />
  ))}
</nav>
```

- [ ] **Step 2: Remove the landing-page guard**

Delete this line (currently right before the `return (` that renders the `<aside>`):

```ts
if (pathname === "/") return null;
```

- [ ] **Step 3: Verify the project still typechecks and builds**

Run: `cd web && npx tsc --noEmit`
Expected: no errors. (`app/page.tsx` still compiles against the unmodified Sidebar props at this point — Task 4 changes `page.tsx` itself, not anything Sidebar exports.)

- [ ] **Step 4: Commit**

```bash
cd web && git add components/Sidebar.tsx
git commit -m "feat: collapse sidebar nav to the 4-item Showcase/Live Metrics/RAG Studio/Architecture IA"
```

---

### Task 4: Rebuild `/` inside the sidebar shell

**Files:**
- Modify: `web/app/page.tsx`

**Interfaces:**
- Consumes: `DATA_SOURCE_COUNT`, `LAMBDA_COUNT`, `TEST_COUNT`, `MONTHLY_COST_USD`, `WEATHER_LOCATION_COUNT` from `@/lib/landingMeta` (unchanged, already imported today); `CommitsResponse` from `@/lib/types` and `GET /api/commits` (Task 2); `OpsResponse`'s `recentLogs: LogEntry[]` field from the existing `GET /api/ops` route (already deployed, unmodified by this plan).
- Produces: nothing consumed elsewhere — `page.tsx` is a leaf route.

This task has no automated test (see Global Constraints). Its deliverable is verified by `tsc --noEmit`, `next build`, and a live browser check after deploy.

- [ ] **Step 1: Rewrite `web/app/page.tsx`**

Replace the entire file with:

```tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  DATA_SOURCE_COUNT,
  LAMBDA_COUNT,
  TEST_COUNT,
  MONTHLY_COST_USD,
  WEATHER_LOCATION_COUNT,
} from "@/lib/landingMeta";
import type { CommitsResponse, GithubCommit, LogEntry } from "@/lib/types";

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
    <svg width="26" height="14" viewBox="0 0 26 14" fill="none" stroke="currentColor" strokeWidth={2} className="text-border">
      <path d="M0 7h22M17 2l6 5-6 5" />
    </svg>
  );
}

function FeatureCard({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-6 py-[22px] flex flex-col gap-2">
      {icon}
      <span className="text-sm font-semibold text-textPrimary">{title}</span>
      <span className="text-[12.5px] leading-relaxed text-textSecondary">{description}</span>
    </div>
  );
}

function relativeTime(iso: string, now: Date = new Date()): string {
  const diffMs = now.getTime() - new Date(iso).getTime();
  const minutes = Math.max(0, Math.round(diffMs / 60000));
  if (minutes < 1) return "vừa xong";
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} giờ trước`;
  return `${Math.round(hours / 24)} ngày trước`;
}

function detectLogLevel(message: string): "ERROR" | "WARN" | "INFO" {
  const match = message.match(/\b(ERROR|WARN(?:ING)?|INFO)\b/);
  if (!match) return "INFO";
  return match[1] === "WARNING" ? "WARN" : (match[1] as "ERROR" | "WARN" | "INFO");
}

function logLevelColor(level: "ERROR" | "WARN" | "INFO"): string {
  if (level === "ERROR") return "text-error";
  if (level === "WARN") return "text-warning";
  return "text-accent";
}

function CommitsPanel({ commits }: { commits: GithubCommit[] }) {
  if (commits.length === 0) return null;
  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-4 flex flex-col gap-2.5">
      <span className="text-xs font-semibold text-textPrimary">Commit gần đây</span>
      <div className="flex flex-col gap-2.5">
        {commits.map((c) => (
          <a
            key={c.sha}
            href={c.htmlUrl}
            target="_blank"
            rel="noreferrer"
            className="flex flex-col gap-0.5 border-b border-border pb-2.5 last:border-0 last:pb-0"
          >
            <span className="text-[12px] text-textSecondary leading-snug">{c.message}</span>
            <span className="font-mono text-[10.5px] text-textMuted">
              {c.authorName} · {c.sha.slice(0, 7)} · {relativeTime(c.date)}
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}

export default function LandingPage() {
  const [commits, setCommits] = useState<GithubCommit[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);

  useEffect(() => {
    fetch("/api/commits")
      .then((res) => res.json().then((body) => ({ ok: res.ok, body })))
      .then(({ ok, body }: { ok: boolean; body: CommitsResponse }) => {
        if (ok) setCommits(body.commits);
      })
      .catch(() => {
        /* commits panel is secondary -- CommitsPanel hides itself when empty */
      });
  }, []);

  useEffect(() => {
    fetch("/api/ops")
      .then((res) => res.json().then((body) => ({ ok: res.ok, body })))
      .then(({ ok, body }) => {
        if (ok && Array.isArray(body?.recentLogs)) setLogs(body.recentLogs);
      })
      .catch(() => {
        /* log footer is secondary -- never block the landing page over it */
      });
  }, []);

  return (
    <div className="flex gap-4 p-9">
      <div className="flex-[2.6] flex flex-col gap-5">
        <section className="rounded-lg border border-border bg-surface px-10 py-12 flex flex-col items-center text-center gap-5">
          <span className="font-mono text-[11px] tracking-wide text-accent bg-accent/10 px-3.5 py-1.5 rounded-full">
            PORTFOLIO PROJECT · DATA ENGINEERING
          </span>
          <h1 className="max-w-3xl font-heading text-[40px] leading-[1.15] font-bold text-textPrimary">
            Pipeline dữ liệu real-time, serverless, chạy thật trên AWS
          </h1>
          <p className="max-w-xl text-[14.5px] leading-relaxed text-textSecondary">
            {DATA_SOURCE_COUNT} nguồn dị chủng đổ về S3 → Glue/Athena, cộng 2 kiến trúc RAG song song trên Bedrock —
            một pipeline cố định (CRAG) và một agent tự quyết định gọi tool. Toàn bộ hạ tầng bằng Terraform, deploy
            qua GitHub Actions với gate phê duyệt production.
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
        </section>

        <section className="grid grid-cols-4 gap-4">
          <div className="rounded-lg border border-border bg-surface px-4 py-4 flex flex-col items-center gap-1">
            <span className="font-mono text-xl text-textPrimary">{DATA_SOURCE_COUNT}</span>
            <span className="text-[11px] text-textMuted">nguồn dữ liệu</span>
          </div>
          <div className="rounded-lg border border-border bg-surface px-4 py-4 flex flex-col items-center gap-1">
            <span className="font-mono text-xl text-textPrimary">{LAMBDA_COUNT}</span>
            <span className="text-[11px] text-textMuted">Lambda serverless</span>
          </div>
          <div className="rounded-lg border border-border bg-surface px-4 py-4 flex flex-col items-center gap-1">
            <span className="font-mono text-xl text-textPrimary">{TEST_COUNT}</span>
            <span className="text-[11px] text-textMuted">test tự động</span>
          </div>
          <div className="rounded-lg border border-border bg-surface px-4 py-4 flex flex-col items-center gap-1">
            <span className="font-mono text-xl text-textPrimary">${MONTHLY_COST_USD.toFixed(0)}</span>
            <span className="text-[11px] text-textMuted">chi phí / tháng</span>
          </div>
        </section>

        <section id="architecture" className="rounded-lg border border-border bg-surface px-8 py-9 flex flex-col gap-6">
          <span className="text-center font-heading text-[17px] font-semibold text-textPrimary">
            Kiến trúc trong một dòng
          </span>
          <div className="flex items-center justify-center gap-3.5 flex-wrap">
            <div className="rounded-lg border border-border bg-bg px-4 py-3.5 flex flex-col items-center gap-1 w-[120px]">
              <span className="text-[11.5px] text-textPrimary">HN · News</span>
              <span className="text-[11.5px] text-textPrimary">Weather · Crypto</span>
              <span className="text-[11.5px] text-textPrimary">GitHub</span>
            </div>
            <ArrowIcon />
            <div className="rounded-lg border border-border bg-bg px-[18px] py-3.5 text-center w-[160px]">
              <span className="font-mono text-[11.5px] text-textPrimary">S3 raw → curated</span>
            </div>
            <ArrowIcon />
            <div className="rounded-lg border border-border bg-bg px-[18px] py-3.5 text-center w-[160px]">
              <span className="font-mono text-[11.5px] text-textPrimary">Glue Catalog + Athena</span>
            </div>
            <ArrowIcon />
            <div className="rounded-lg border border-accent bg-bg px-[18px] py-3.5 text-center w-[170px]">
              <span className="font-mono text-[11.5px] text-accent">RAG: CRAG + Agent</span>
            </div>
          </div>
        </section>

        <section id="features" className="grid grid-cols-2 gap-4">
          <FeatureCard
            icon={
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#06B6D4" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
              </svg>
            }
            title={`${DATA_SOURCE_COUNT} nguồn dữ liệu dị chủng`}
            description={`Hacker News, News API, thời tiết Open-Meteo (${WEATHER_LOCATION_COUNT} khu vực), giá crypto CoinGecko, GitHub trending — ingest mỗi 10-20 phút tuỳ nguồn.`}
          />
          <FeatureCard
            icon={
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#06B6D4" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
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
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#06B6D4" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
              </svg>
            }
            title="RAG kép: CRAG + Agentic"
            description="So sánh trực tiếp pipeline CRAG cố định với một agent thật tự gọi tool qua Bedrock Converse API."
          />
          <FeatureCard
            icon={
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#06B6D4" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
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

        <section className="flex flex-col items-center gap-4 py-4">
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
          <p className="mt-[6px] text-[11.5px] text-textMuted">Xây dựng để ứng tuyển vị trí Data Engineer Intern · 2026</p>
        </section>
      </div>

      <div className="flex-1 flex flex-col gap-4 min-h-0">
        <CommitsPanel commits={commits} />

        <div className="flex-1 rounded-lg border border-border bg-surface px-4 py-4 flex flex-col gap-2 min-h-0 overflow-auto">
          <span className="text-xs font-semibold text-textPrimary">Log gần đây</span>
          <div className="font-mono flex flex-col gap-1.5 text-[10.5px] text-textMuted">
            {logs.length === 0 && <span>Chưa có log trong 24h qua.</span>}
            {logs.map((log, i) => {
              const level = detectLogLevel(log.message);
              return (
                <span key={i}>
                  <span className={logLevelColor(level)}>{level}</span> {log.source}: {log.message}
                </span>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
```

Note what changed structurally from the previous version: the standalone `<header>` (brand + its own nav + "Xem demo"/"Mã nguồn" links) is removed entirely — the sidebar (Task 3) now provides brand and primary navigation for every route including `/`. The hero, stat tiles, architecture-flow diagram, feature grid, and tech-stack strip are all preserved with their exact existing real-data bindings, just re-flowed into a bordered-card main column. The new right rail adds the real commits panel (Task 2's `/api/commits`) and a real log-stream footer (existing `/api/ops`'s `recentLogs`).

- [ ] **Step 2: Verify the project typechecks and builds**

Run: `cd web && npx tsc --noEmit && npx next build`
Expected: both succeed with no errors.

- [ ] **Step 3: Run the full Vitest suite**

Run: `cd web && npx vitest run`
Expected: all tests pass (existing suite + Task 1's and Task 2's new tests), pristine output.

- [ ] **Step 4: Commit**

```bash
cd web && git add app/page.tsx
git commit -m "feat: rebuild landing page inside the shared sidebar shell with real commits and log panels"
```

---

## After all tasks: manual verification (part of this plan's final review, not a separate task)

- `cd web && npx vitest run` — full suite green.
- `cd web && npx tsc --noEmit && npx next build` — clean build.
- Local dev server (`npm run dev`), visit `/`: sidebar shows exactly 4 links (Showcase & Overview active), landing page renders inside the shell (no duplicate header), commits panel shows real recent commits from `coderuit3k/realtime-data-pipeline`, log panel shows real `recentLogs` from `/api/ops` (or its "chưa có log" empty state).
- Visit `/dashboard`, `/assistant`, `/catalog`, confirm the sidebar now shows the 4-item IA with the correct one highlighted active, and that none of these three pages' own content changed.
- Visit `/settings` and `/weather` directly by URL — confirm they still work (untouched), just no longer linked from the sidebar.
