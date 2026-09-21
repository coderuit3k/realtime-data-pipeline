# Sidebar Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the shared top `NavBar` with a left sidebar matching
the mockup exactly, across all 9 real dashboard-style pages, without
changing any of those pages' own content.

**Architecture:** A new `web/lib/health` real-data route feeding a new
`Sidebar` client component, wired into the shared root layout in place
of `NavBar`. Every existing page's own `page.tsx` is untouched.

**Tech Stack:** Next.js 15 App Router, TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-21-sidebar-nav-design.md`

## Global Constraints

- No changes to any of the 9 existing pages' own `page.tsx` files --
  only the shared layout wrapper (`web/app/layout.tsx`) and nav
  component change.
- The Landing page (`/`) keeps its current header, no sidebar -- matches
  the one mockup screen with no Sidebar import.
- Real data only: `sourcesHealthy` reuses the exact computation already
  in `web/app/api/dashboard/route.ts` (`sourceVolumes.filter(s =>
  s.records > 0).length`); `sourcesTotal` comes from
  `web/lib/settingsMeta.ts`'s real `DATA_SOURCES.length`, not a fresh
  hardcoded `5` -- and `dashboard/route.ts`'s own existing local
  `SOURCES_TOTAL = 5` constant is updated to the same shared source,
  removing a duplicate. `region`/`environment` come from the real
  `AWS_REGION` (existing) and `DEPLOY_ENVIRONMENT` (new) env vars.
- Two mockup colors recur across this app's real screens but have no
  existing Tailwind token: `#0E1626` (the sidebar's own distinct
  background, `project/Sidebar.dc.html`) and `#3D4874` (muted section
  labels/dividers -- also the exact color the Landing page's
  `ArrowIcon` already uses via `text-border`, an approximation accepted
  at the time since no better token existed; this plan adds the real
  token, `textFaint`, so this task uses it precisely -- not a
  retroactive fix to the already-shipped Landing page, which stays as
  it is). Add both to `tailwind.config.ts` as named tokens
  (`sidebarBg`, `textFaint`) rather than using raw hex in the
  component, matching this app's established "never raw hex, real
  tokens only" convention.
- A failed `/api/health` fetch must never block the sidebar's nav links
  from rendering -- the footer falls back to a plain "—", unlike every
  other page's fetch-failure pattern (which blocks the whole page with
  an error state), since navigation is infrastructure every page
  depends on.
- Error handling for `/api/health` otherwise matches the established
  convention: `console.error` + `{ error: "Không tải được trạng thái,
  thử lại sau." }` at 500, uncached. Cache-Control on success: `public,
  s-maxage=60, stale-while-revalidate=120`.

---

### Task 1: Real health endpoint + dedup the source-count constant

**Files:**
- Modify: `web/lib/types.ts`
- Create: `web/app/api/health/route.ts`
- Create: `web/app/api/health/route.test.ts`
- Modify: `web/app/api/dashboard/route.ts`
- Modify: `web/.env.example`
- Modify: `infra/README.md`

**Interfaces:**
- Consumes: `getAthenaClient`, `requiredEnv` (existing, `web/lib/aws.ts`);
  `runAthenaQuery`, `todayUtcParts`, `buildSourceVolumeQuery`,
  `parseAthenaRows` (existing, `web/lib/athena.ts`); `DATA_SOURCES`
  (existing, `web/lib/settingsMeta.ts`).
- Produces: `HealthResponse = { sourcesHealthy: number; sourcesTotal:
  number; region: string; environment: string }` (`web/lib/types.ts`).
  Task 2's `Sidebar` component consumes this exact shape from `GET
  /api/health`.

- [ ] **Step 1: Add the new type**

Add to the end of `web/lib/types.ts`:

```ts
export type HealthResponse = {
  sourcesHealthy: number;
  sourcesTotal: number;
  region: string;
  environment: string;
};
```

- [ ] **Step 2: Write the failing tests for the health route**

Create `web/app/api/health/route.test.ts`:

```ts
// web/app/api/health/route.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/aws", () => ({
  getAthenaClient: vi.fn(() => ({})),
  requiredEnv: vi.fn((name: string) => {
    if (name === "AWS_REGION") return "us-east-1";
    if (name === "DEPLOY_ENVIRONMENT") return "dev";
    throw new Error(`unexpected env var: ${name}`);
  }),
}));
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

beforeEach(() => {
  mockedRun.mockReset();
});

describe("GET /api/health", () => {
  it("returns real health counts and real region/environment", async () => {
    mockedRun.mockResolvedValue(
      athenaRows([
        ["hackernews", "10"],
        ["news", "0"],
        ["weather", "5"],
        ["crypto", "3"],
        ["github", "0"],
      ])
    );

    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      sourcesHealthy: 3,
      sourcesTotal: 5,
      region: "us-east-1",
      environment: "dev",
    });
  });

  it("returns 500 with a safe message when the query fails", async () => {
    mockedRun.mockRejectedValue(new Error("boom"));
    const response = await GET();
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("Không tải được trạng thái, thử lại sau.");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd web && npx vitest run app/api/health/route.test.ts`
Expected: FAIL -- module `./route` not found

- [ ] **Step 4: Implement the health route**

Create `web/app/api/health/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getAthenaClient, requiredEnv } from "@/lib/aws";
import { runAthenaQuery, todayUtcParts, buildSourceVolumeQuery, parseAthenaRows } from "@/lib/athena";
import { DATA_SOURCES } from "@/lib/settingsMeta";
import type { HealthResponse, SourceVolume } from "@/lib/types";

export const maxDuration = 60;

export async function GET() {
  try {
    const parts = todayUtcParts();
    const rows = await runAthenaQuery(getAthenaClient(), buildSourceVolumeQuery(parts));
    const sourceVolumes: SourceVolume[] = parseAthenaRows(rows, (cols) => ({
      source: cols[0] ?? "",
      records: Number(cols[1] ?? 0),
    }));
    const sourcesHealthy = sourceVolumes.filter((s) => s.records > 0).length;

    const response: HealthResponse = {
      sourcesHealthy,
      sourcesTotal: DATA_SOURCES.length,
      region: requiredEnv("AWS_REGION"),
      environment: requiredEnv("DEPLOY_ENVIRONMENT"),
    };

    return NextResponse.json(response, {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" },
    });
  } catch (error) {
    console.error("Health API failed", error);
    return NextResponse.json({ error: "Không tải được trạng thái, thử lại sau." }, { status: 500 });
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd web && npx vitest run app/api/health/route.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Dedup `dashboard/route.ts`'s source-count constant**

In `web/app/api/dashboard/route.ts`, add this import alongside the
existing ones:

```ts
import { DATA_SOURCES } from "@/lib/settingsMeta";
```

Remove the line `const SOURCES_TOTAL = 5;` entirely.

Change `sourcesTotal: SOURCES_TOTAL,` to `sourcesTotal:
DATA_SOURCES.length,`.

No other line in this file changes. `DATA_SOURCES.length` is `5`, the
exact same real value `SOURCES_TOTAL` held, so `web/app/api/dashboard/route.test.ts`
needs no changes -- its existing assertions already expect `5` and
still get `5`, now from a shared, non-duplicated source. Confirm this
by reading `web/app/api/dashboard/route.test.ts` before and after this
change: it should be untouched.

- [ ] **Step 7: Add the new env var to `.env.example`**

Add to the end of `web/.env.example`:

```
# Real deployment environment name, matching Terraform's own
# `environment` variable (infra/variables.tf, default "dev") -- backs
# the sidebar's real "region · environment" status label.
DEPLOY_ENVIRONMENT=dev
```

- [ ] **Step 8: Add the new env var to `infra/README.md`**

Add one line to the "Web app environment variables" list (the same
section that already lists `NEWS_SECRET_NAME`/`TAVILY_SECRET_NAME`):

```markdown
- `DEPLOY_ENVIRONMENT` -- real deployment environment name (matches Terraform's `environment` variable, e.g. `dev`); backs the sidebar's status footer
```

- [ ] **Step 9: Run the full test suite to confirm nothing else broke**

Run: `cd web && npx vitest run`
Expected: PASS, all files including the new one, same total count as
before plus 2 new tests (dashboard's own test count unchanged)

- [ ] **Step 10: Commit**

```bash
git add web/lib/types.ts web/app/api/health/route.ts web/app/api/health/route.test.ts web/app/api/dashboard/route.ts web/.env.example infra/README.md
git commit -m "Add GET /api/health, dedup dashboard's source-count constant"
```

---

### Task 2: Sidebar component + layout wiring

**Files:**
- Modify: `web/tailwind.config.ts`
- Create: `web/components/Sidebar.tsx`
- Delete: `web/components/NavBar.tsx`
- Modify: `web/app/layout.tsx`

**Interfaces:**
- Consumes: `HealthResponse` (Task 1, `web/lib/types.ts`). Fetches `GET
  /api/health` (Task 1) at runtime.
- Produces: nothing (final content task -- Task 3 only deploys and
  verifies).

This task has no dedicated automated test (project convention: no
component tests for pages/layout components). Verified manually in
Task 3 after deploy.

- [ ] **Step 1: Add the 2 new color tokens**

In `web/tailwind.config.ts`, the `theme.extend.colors` object currently
reads exactly:

```ts
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
```

Add these 2 entries after `error: "#F0576B",` (before the closing
`},`), no other line changes:

```ts
        sidebarBg: "#0E1626",
        textFaint: "#3D4874",
```

- [ ] **Step 2: Create the Sidebar component**

Create `web/components/Sidebar.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { HealthResponse } from "@/lib/types";

type NavLink = { href: string; label: string; icon: ReactNode };

const ANALYTICS_LINKS: NavLink[] = [
  {
    href: "/dashboard",
    label: "Tổng quan",
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
    label: "RAG Assistant",
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
      </svg>
    ),
  },
  {
    href: "/explorer",
    label: "Data Explorer",
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="m7 9 3 3-3 3M13 15h4" />
      </svg>
    ),
  },
  {
    href: "/catalog",
    label: "Data Catalog",
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M3 10h18M9 4v16" />
      </svg>
    ),
  },
  {
    href: "/insights",
    label: "Insights",
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 17 9 11 13 15 21 7M21 7h-6M21 7v6" />
      </svg>
    ),
  },
  {
    href: "/weather",
    label: "Weather",
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d="M17.5 19H9a7 7 0 1 1 6.71-9h.79a4.5 4.5 0 1 1 0 9z" />
      </svg>
    ),
  },
];

const OPS_LINKS: NavLink[] = [
  {
    href: "/ops",
    label: "Ops & Monitoring",
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
      </svg>
    ),
  },
  {
    href: "/cicd",
    label: "CI/CD",
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <line x1="6" y1="3" x2="6" y2="15" />
        <circle cx="18" cy="6" r="3" />
        <circle cx="6" cy="18" r="3" />
        <path d="M18 9a9 9 0 0 1-9 9" />
      </svg>
    ),
  },
  {
    href: "/settings",
    label: "Settings",
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <line x1="4" y1="6" x2="20" y2="6" />
        <circle cx="9" cy="6" r="2" />
        <line x1="4" y1="12" x2="20" y2="12" />
        <circle cx="15" cy="12" r="2" />
        <line x1="4" y1="18" x2="20" y2="18" />
        <circle cx="9" cy="18" r="2" />
      </svg>
    ),
  },
];

function SidebarLink({ link, active }: { link: NavLink; active: boolean }) {
  return (
    <Link
      href={link.href}
      className={`flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] ${
        active ? "bg-accent/[0.12] text-accent font-semibold" : "text-textSecondary font-medium"
      }`}
    >
      {link.icon}
      <span>{link.label}</span>
    </Link>
  );
}

export default function Sidebar() {
  const pathname = usePathname();
  const [health, setHealth] = useState<HealthResponse | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((res) => res.json().then((body) => ({ ok: res.ok, body })))
      .then(({ ok, body }) => {
        if (ok) setHealth(body);
      })
      .catch(() => {
        /* decorative status only -- never block the sidebar's nav links */
      });
  }, []);

  if (pathname === "/") return null;

  return (
    <aside className="w-[240px] flex-shrink-0 bg-sidebarBg border-r border-border flex flex-col px-[18px] py-5 gap-4 overflow-y-auto">
      <div className="flex items-center gap-2.5 px-1.5">
        <svg
          width="26"
          height="26"
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
        <div className="flex flex-col">
          <span className="font-heading text-base font-bold text-textPrimary">DataPulse</span>
          <span className="font-mono text-[10px] text-textMuted">realtime-pipeline</span>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <span className="font-mono text-[10px] text-textFaint tracking-wide px-3 pt-1.5 pb-0.5">PHÂN TÍCH</span>
        {ANALYTICS_LINKS.map((link) => (
          <SidebarLink key={link.href} link={link} active={pathname === link.href} />
        ))}
      </div>

      <div className="flex flex-col gap-1">
        <span className="font-mono text-[10px] text-textFaint tracking-wide px-3 pt-1.5 pb-0.5">VẬN HÀNH</span>
        {OPS_LINKS.map((link) => (
          <SidebarLink key={link.href} link={link} active={pathname === link.href} />
        ))}
      </div>

      <div className="mt-auto flex flex-col gap-2.5">
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface border border-border">
          <span className="w-[7px] h-[7px] rounded-full bg-success flex-shrink-0" />
          <span className="font-mono text-[11px] text-textSecondary">
            {health ? `${health.sourcesHealthy}/${health.sourcesTotal} nguồn OK` : "—"}
          </span>
        </div>
        <div className="px-3 font-mono text-[10px] text-textFaint">{health ? `${health.region} · ${health.environment}` : "—"}</div>
      </div>
    </aside>
  );
}
```

- [ ] **Step 3: Delete NavBar**

Delete `web/components/NavBar.tsx` entirely (`git rm
web/components/NavBar.tsx`).

- [ ] **Step 4: Update the root layout**

In `web/app/layout.tsx`, change the import from:

```ts
import { NavBar } from "@/components/NavBar";
```

to:

```ts
import Sidebar from "@/components/Sidebar";
```

Change the `<body>` content from:

```tsx
      <body>
        <NavBar />
        {children}
      </body>
```

to:

```tsx
      <body>
        <div className="flex min-h-screen">
          <Sidebar />
          <main className="flex-1 overflow-auto">{children}</main>
        </div>
      </body>
```

No other line in this file changes.

- [ ] **Step 5: Run the full test suite and typecheck**

Run: `cd web && npx vitest run && npx tsc --noEmit`
Expected: all tests PASS (this task adds no new tests -- count
unchanged from Task 1), tsc clean (no output)

- [ ] **Step 6: Commit**

```bash
git add web/tailwind.config.ts web/components/Sidebar.tsx web/components/NavBar.tsx web/app/layout.tsx
git commit -m "Replace top NavBar with a real left sidebar, matching the mockup"
```

---

### Task 3: Deploy and live-verify

**Files:** none (no code changes -- this task pushes and verifies).

**Interfaces:**
- Consumes: nothing new -- no new AWS resource, no new IAM grant. Only a
  new Vercel env var (`DEPLOY_ENVIRONMENT`), added by the user before
  the push, same manual pattern as every prior credential this session.
- Produces: nothing (final task).

- [ ] **Step 1: Ask the user to add the new Vercel env var**

Tell the user: add `DEPLOY_ENVIRONMENT` as a Vercel project environment
variable, with the real value matching their `terraform.tfvars`'s
`environment` variable (`dev` by default -- confirm against their own
file if they've customized it). Wait for confirmation before
proceeding -- this must happen before the push in Step 2, so the very
first deploy already has it.

- [ ] **Step 2: Push and wait for the deploy gate**

```bash
git push origin main
```

Wait for the GitHub Actions "Deploy" workflow. This push is web-app-code
only (no `.tf` changes), so `Terraform Plan` should show no
infrastructure changes; `apply` will still wait on the `environment:
production` approval gate as usual. Report the run URL and wait for
approval before proceeding.

- [ ] **Step 3: Live-verify**

```bash
curl -s https://realtime-data-pipeline.vercel.app/api/health | python3 -m json.tool
for path in dashboard assistant catalog explorer insights ops cicd weather settings; do
  echo "=== /$path ==="
  curl -s -o /dev/null -w "%{http_code}\n" "https://realtime-data-pipeline.vercel.app/$path"
done
curl -s -o /dev/null -w "/ -> %{http_code}\n" https://realtime-data-pipeline.vercel.app/
```

Confirm: `/api/health` returns real, plausible `sourcesHealthy` (0-5),
`sourcesTotal: 5`, `region: "us-east-1"`, and the real
`DEPLOY_ENVIRONMENT` value just set. All 9 routes and `/` return `200`.
For at least 2 of the 9 routes, fetch the raw HTML and confirm the
sidebar is present with the correct link highlighted (`grep -o
'class="[^"]*text-accent[^"]*"[^>]*>[^<]*<' ` near each page's own real
label) and the real health/region text appears in the footer. Confirm
`/`'s raw HTML has no `<aside` element (the sidebar never renders
there), matching Task 2's `if (pathname === "/") return null;`.
