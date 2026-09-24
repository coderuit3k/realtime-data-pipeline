# Visual Fidelity Pass: Showcase & Overview + Live Metrics & Ops Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raise the visual fidelity of the two already-shipped Stitch "Phương án 1" (Terminal Obsidian) pages — Showcase & Overview (`/`) and Live Metrics & Ops (`/dashboard`) — to match the real, already-authored Terminal Obsidian design system's glassmorphism, layered surfaces, and live-status glow treatments, which the current implementation only partially applied (flat single-tier surfaces, no blur, no glow, a plain-text status label instead of a pulsing live indicator). No new data, no new API calls, no destructive-action UI — every number on screen stays exactly as real as it is today.

**Architecture:** Pure presentation-layer change. Extend `web/tailwind.config.ts` with the design system's real surface tiers and glow shadows (already fully specified in this project's Stitch design system, not invented here); add one new small shared component (`LiveBadge`) using only Tailwind's built-in `animate-ping`; apply the new classes to existing components and the two pages. No new files beyond `LiveBadge.tsx`; no changes to any `/api/*` route, any `lib/*.ts` data function, or any type.

**Tech Stack:** Next.js 15, TypeScript, Tailwind CSS (existing setup, extended not replaced).

**Spec:** No separate spec file — this is a visual-only refinement of already-shipped, already-specified pages (the "brief" is the real Terminal Obsidian `designMd` already fetched from this project's Stitch project during brainstorming, plus the two real Stitch mockup screenshots for these pages), scoped directly in chat per the frontend-design skill's plan-then-build process.

## Global Constraints

- No new fabricated data anywhere. Every visual element must render real data already available from existing API responses — this plan does not add a sparkline/mini-chart to KPI cards, since no real historical time-series data is currently exposed by any API (adding one would require new backend work, out of scope for a visual-only pass).
- No destructive-action UI is (re)introduced. The existing read-only "Liên kết nhanh" links and lack of any Trigger/Flush button stay exactly as they are.
- No new environment variables, no new AWS calls, no new Terraform.
- `web/lib/*.ts`, all `/api/*` route files, and all `.test.ts` files are untouched by every task in this plan — this is a pure `web/tailwind.config.ts` + `.tsx` component/page styling change.
- No component-rendering test infrastructure is added (this repo has none, `environment: "node"` — unchanged by this plan). Verification is `tsc --noEmit`, `next build`, and a live/local visual check (screenshot comparison against the real Stitch mockup), not new `.test.tsx` files.
- Color semantics from the real design system are followed, not invented: cyan (`accent`, `#06B6D4`/`#4CD7F6` bright) is reserved for realtime data-flow/telemetry elements; indigo (`secondary`, `#6366F1`/`#8B5CF6` bright) is reserved for generative-AI/RAG/agent elements; emerald (`success`, `#10B981`) is reserved for live/healthy status. The current landing page's "Agentic RAG" architecture-flow node and feature card use cyan today — this plan corrects them to indigo, since the design system explicitly reserves indigo for "RAG indexing pipelines, and cognitive agent monitors," not cyan.

---

### Task 1: Design tokens — extend `web/tailwind.config.ts`

**Files:**
- Modify: `web/tailwind.config.ts`

**Interfaces:**
- Produces: new Tailwind color tokens (`surfaceHigh`, `surfaceHighest`, `accentBright`, `secondaryBright`, `borderStrong`) and `boxShadow` tokens (`glowCyan`, `glowIndigo`, `glowEmerald`, `glassPanel`) — every later task consumes these by class name (`bg-surfaceHigh`, `shadow-glowCyan`, etc.). Nothing existing is renamed or removed, so no existing class name anywhere in the codebase breaks.

- [ ] **Step 1: Extend the color and boxShadow theme**

Replace the entire `theme.extend` object in `web/tailwind.config.ts`:

```ts
      colors: {
        bg: "#0B0F17",
        surface: "#111827",
        surfaceHigh: "#1C2028",
        surfaceHighest: "#262A33",
        border: "rgba(255, 255, 255, 0.08)",
        borderStrong: "rgba(255, 255, 255, 0.12)",
        accent: "#06B6D4",
        accentBright: "#4CD7F6",
        secondary: "#6366F1",
        secondaryBright: "#8B5CF6",
        textPrimary: "#DFE2EE",
        textSecondary: "#BCC9CD",
        textMuted: "#869397",
        success: "#10B981",
        warning: "#F59E0B",
        error: "#EF4444",
        sidebarBg: "#0A0E16",
        textFaint: "#3D494C",
      },
      boxShadow: {
        glowCyan: "0 0 16px rgba(6, 182, 212, 0.4)",
        glowIndigo: "0 0 14px rgba(99, 102, 241, 0.4)",
        glowEmerald: "0 0 12px rgba(16, 185, 129, 0.35)",
        glassPanel: "0 8px 32px rgba(0, 0, 0, 0.5)",
      },
      fontFamily: {
        heading: ["var(--font-inter)"],
        body: ["var(--font-inter)"],
        mono: ["var(--font-jetbrains-mono)"],
      },
```

(This is the exact same block as today, with `surfaceHigh`, `surfaceHighest`, `accentBright`, `secondaryBright`, `borderStrong` added to `colors`, and a new `boxShadow` block added alongside the existing `fontFamily` block — nothing removed.)

- [ ] **Step 2: Verify**

Run: `cd web && npx tsc --noEmit && npx next build`
Expected: both clean — this step only adds new theme tokens, so nothing existing should break. `next build`'s Tailwind JIT compile is the real check that the new token names are valid.

- [ ] **Step 3: Commit**

```bash
cd web && git add tailwind.config.ts
git commit -m "feat: add surface-tier and glow design tokens (Terminal Obsidian design system)"
```

---

### Task 2: Shared components — glass panels, live-status pulse, chart glow

**Files:**
- Create: `web/components/LiveBadge.tsx`
- Modify: `web/components/KpiCard.tsx`
- Modify: `web/components/SourceVolumeChart.tsx`
- Modify: `web/components/ActivityFeed.tsx`
- Modify: `web/components/Sidebar.tsx`

**Interfaces:**
- Produces: `LiveBadge({ status: "ok" | "error" | "idle", label?: string })` — a small pill combining a status dot with a real `animate-ping` pulse ring when `status === "ok"` (the only state that should visually read as "live"). Task 4 imports this to replace `dashboard/page.tsx`'s plain-text `statusLabel`/`statusColor` treatment.
- `KpiCard`'s prop signature is unchanged (`label`, `value`, `hint`, `hintColor`) — only its internal markup/classes change, so every existing call site (`app/dashboard/page.tsx`'s three `<KpiCard .../>` calls) keeps working with no edits.

- [ ] **Step 1: Create `LiveBadge`**

Create `web/components/LiveBadge.tsx`:

```tsx
type LiveBadgeProps = {
  status: "ok" | "error" | "idle";
  label?: string;
};

const STATUS_CONFIG = {
  ok: { dot: "bg-success", text: "text-success", pulse: true, defaultLabel: "OK" },
  error: { dot: "bg-error", text: "text-error", pulse: false, defaultLabel: "LỖI" },
  idle: { dot: "bg-textMuted", text: "text-textMuted", pulse: false, defaultLabel: "CHƯA CHẠY" },
} as const;

export function LiveBadge({ status, label }: LiveBadgeProps) {
  const config = STATUS_CONFIG[status];
  return (
    <span className={`inline-flex items-center gap-1.5 font-mono text-[10.5px] tracking-wide ${config.text}`}>
      <span className="relative flex h-1.5 w-1.5">
        {config.pulse && (
          <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${config.dot} opacity-75`} />
        )}
        <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${config.dot} ${config.pulse ? "shadow-glowEmerald" : ""}`} />
      </span>
      {label ?? config.defaultLabel}
    </span>
  );
}
```

- [ ] **Step 2: Give `KpiCard` a glass panel and tabular numerals**

Replace `web/components/KpiCard.tsx` entirely:

```tsx
type KpiCardProps = {
  label: string;
  value: string;
  hint?: string;
  hintColor?: "success" | "muted";
};

export function KpiCard({ label, value, hint, hintColor = "muted" }: KpiCardProps) {
  return (
    <div className="rounded-lg border border-border bg-surface/75 backdrop-blur-md p-5 flex flex-col gap-2">
      <span className="text-xs text-textSecondary">{label}</span>
      <span className="font-mono tabular-nums text-2xl text-textPrimary">{value}</span>
      {hint && (
        <span className={`text-xs ${hintColor === "success" ? "text-success" : "text-textMuted"}`}>
          {hint}
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Give `SourceVolumeChart` a glass panel and a glowing gradient bar fill**

Replace `web/components/SourceVolumeChart.tsx` entirely:

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
    <div className="rounded-lg border border-border bg-surface/75 backdrop-blur-md p-6 flex flex-col gap-4">
      <span className="text-sm font-semibold text-textPrimary">Khối lượng theo nguồn (hôm nay)</span>
      <div className="flex items-end gap-6 h-40">
        {sourceVolumes.map((s) => (
          <div key={s.source} className="flex flex-col items-center gap-2 flex-1 h-full">
            <span className="font-mono tabular-nums text-xs text-textSecondary">{s.records}</span>
            <div className="w-full flex-1 flex items-end">
              <div
                className="w-full rounded-t bg-gradient-to-t from-accent to-accentBright shadow-glowCyan"
                style={{ height: `${(s.records / max) * 100}%` }}
              />
            </div>
            <span className="text-xs text-textMuted">{LABELS[s.source] ?? s.source}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Give `ActivityFeed` a glass panel**

Replace `web/components/ActivityFeed.tsx` entirely:

```tsx
import type { ActivityItem } from "@/lib/types";

export function ActivityFeed({ items }: { items: ActivityItem[] }) {
  return (
    <div className="rounded-lg border border-border bg-surface/75 backdrop-blur-md p-6 flex flex-col gap-3">
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

- [ ] **Step 5: Sidebar polish — glass surface, glowing active state, pulsing health pip**

In `web/components/Sidebar.tsx`, make three targeted edits (do not rewrite the whole file — the `NAV_LINKS`/`LEGACY_LINKS` arrays and all link hrefs/labels/icons stay exactly as they are).

Replace the `SidebarLink` function:

```tsx
function SidebarLink({ link, active }: { link: NavLink; active: boolean }) {
  return (
    <Link
      href={link.href}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] border ${
        active
          ? "bg-accent/[0.12] text-accent font-semibold border-accent/30 shadow-glowCyan"
          : "text-textSecondary font-medium border-transparent"
      }`}
    >
      {link.icon}
      <span>{link.label}</span>
    </Link>
  );
}
```

Replace the `statusDotColor` function:

```tsx
function statusDotColor(health: HealthResponse | null): { dot: string; pulse: boolean } {
  if (!health) return { dot: "bg-textMuted", pulse: false };
  return health.sourcesHealthy === health.sourcesTotal
    ? { dot: "bg-success", pulse: true }
    : { dot: "bg-warning", pulse: false };
}
```

Replace the health-status pill's markup at the bottom of the `<aside>` (the block currently reading `<div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface border border-border">...`):

```tsx
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface/75 backdrop-blur-md border border-border">
          <span className="relative flex h-[7px] w-[7px] flex-shrink-0">
            {statusDotColor(health).pulse && (
              <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${statusDotColor(health).dot} opacity-75`} />
            )}
            <span className={`relative inline-flex h-[7px] w-[7px] rounded-full ${statusDotColor(health).dot} ${statusDotColor(health).pulse ? "shadow-glowEmerald" : ""}`} />
          </span>
          <span className="font-mono text-[11px] text-textSecondary">
            {health ? `${health.sourcesHealthy}/${health.sourcesTotal} nguồn OK` : "—"}
          </span>
        </div>
```

Also change the `<aside>` element's own class from `bg-sidebarBg` to keep `bg-sidebarBg` (unchanged — the sidebar's own base tier is already correct per the design system's `surface-container-lowest`) — no change needed there, just confirm it during self-review.

- [ ] **Step 6: Verify**

Run: `cd web && npx tsc --noEmit && npx next build`
Expected: both clean.

- [ ] **Step 7: Commit**

```bash
cd web && git add components/LiveBadge.tsx components/KpiCard.tsx components/SourceVolumeChart.tsx components/ActivityFeed.tsx components/Sidebar.tsx
git commit -m "feat: glass panels, glow accents, and a real pulsing live-status badge for shared components"
```

---

### Task 3: Apply fidelity pass to Showcase & Overview (`web/app/page.tsx`)

**Files:**
- Modify: `web/app/page.tsx`

**Interfaces:** None new — consumes Task 1's Tailwind tokens only, by class name.

- [ ] **Step 1: Replace the entire file**

Replace `web/app/page.tsx` entirely:

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

function FeatureCard({ icon, title, description, accent = "cyan" }: { icon: ReactNode; title: string; description: string; accent?: "cyan" | "indigo" }) {
  return (
    <div
      className={`rounded-lg border bg-surface/75 backdrop-blur-md px-6 py-[22px] flex flex-col gap-2 ${
        accent === "indigo" ? "border-secondary/25" : "border-border"
      }`}
    >
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
    <div className="rounded-lg border border-border bg-surface/75 backdrop-blur-md px-4 py-4 flex flex-col gap-2.5">
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
  const [logs, setLogs] = useState<LogEntry[] | null>(null);
  const [logsError, setLogsError] = useState(false);

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
        if (ok && Array.isArray(body?.recentLogs)) {
          setLogs(body.recentLogs);
        } else {
          setLogsError(true);
        }
      })
      .catch(() => {
        setLogsError(true);
      });
  }, []);

  return (
    <div className="flex gap-4 p-9">
      <div className="flex-[2.6] min-w-0 flex flex-col gap-5">
        <section className="rounded-lg border border-border bg-surface/75 backdrop-blur-md px-10 py-12 flex flex-col items-center text-center gap-5">
          <span className="font-mono text-[11px] tracking-wide text-accent bg-accent/10 px-3.5 py-1.5 rounded-full">
            PORTFOLIO PROJECT · DATA ENGINEERING
          </span>
          <h1 className="max-w-3xl font-heading text-[40px] leading-[1.15] font-bold text-textPrimary">
            Pipeline dữ liệu real-time, serverless, chạy thật trên AWS
          </h1>
          <p className="max-w-xl text-[14.5px] leading-relaxed text-textSecondary">
            {DATA_SOURCE_COUNT} nguồn dị chủng đổ về S3 → Glue/Athena, cộng một pipeline Agentic RAG thật trên Bedrock —
            tự quyết định gọi tool truy xuất dữ liệu đã ingest hoặc tìm trên web. Toàn bộ hạ tầng bằng Terraform,
            deploy qua GitHub Actions với gate phê duyệt production.
          </p>
          <div className="flex gap-3 mt-1.5">
            <Link
              href="/dashboard"
              className="rounded-lg bg-accent px-6 py-3 text-[13.5px] font-semibold text-bg transition-shadow hover:shadow-glowCyan"
            >
              Xem demo nội bộ →
            </Link>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-border px-6 py-3 text-[13.5px] text-textPrimary transition-colors hover:border-borderStrong"
            >
              Xem trên GitHub
            </a>
          </div>
        </section>

        <section className="grid grid-cols-4 gap-4">
          <div className="rounded-lg border-t-2 border-t-accent border border-border bg-surface/75 backdrop-blur-md px-4 py-4 flex flex-col items-center gap-1">
            <span className="font-mono tabular-nums text-xl text-textPrimary">{DATA_SOURCE_COUNT}</span>
            <span className="text-[11px] text-textMuted">nguồn dữ liệu</span>
          </div>
          <div className="rounded-lg border-t-2 border-t-accent border border-border bg-surface/75 backdrop-blur-md px-4 py-4 flex flex-col items-center gap-1">
            <span className="font-mono tabular-nums text-xl text-textPrimary">{LAMBDA_COUNT}</span>
            <span className="text-[11px] text-textMuted">Lambda serverless</span>
          </div>
          <div className="rounded-lg border-t-2 border-t-accent border border-border bg-surface/75 backdrop-blur-md px-4 py-4 flex flex-col items-center gap-1">
            <span className="font-mono tabular-nums text-xl text-textPrimary">{TEST_COUNT}</span>
            <span className="text-[11px] text-textMuted">test tự động</span>
          </div>
          <div className="rounded-lg border-t-2 border-t-accent border border-border bg-surface/75 backdrop-blur-md px-4 py-4 flex flex-col items-center gap-1">
            <span className="font-mono tabular-nums text-xl text-textPrimary">${MONTHLY_COST_USD.toFixed(0)}</span>
            <span className="text-[11px] text-textMuted">chi phí / tháng</span>
          </div>
        </section>

        <section id="architecture" className="rounded-lg border border-border bg-surface/75 backdrop-blur-md px-8 py-9 flex flex-col gap-6">
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
            <div className="rounded-lg border border-secondary bg-bg px-[18px] py-3.5 text-center w-[170px] shadow-glowIndigo">
              <span className="font-mono text-[11.5px] text-secondaryBright">Agentic RAG</span>
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
            accent="indigo"
            icon={
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#8B5CF6" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
              </svg>
            }
            title="Agentic RAG thật"
            description="Agent tự quyết định gọi tool search_knowledge_base hoặc search_web (Tavily) qua Bedrock Converse API, không phải pipeline retrieve → generate cố định."
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
                className="font-mono text-[11px] px-3 py-1.5 rounded-lg bg-surface/75 backdrop-blur-md border border-border text-textSecondary"
              >
                {tech}
              </span>
            ))}
          </div>
          <p className="mt-[6px] text-[11.5px] text-textMuted">Xây dựng để ứng tuyển vị trí Data Engineer Intern · 2026</p>
        </section>
      </div>

      <div className="flex-1 min-w-0 flex flex-col gap-4 min-h-0">
        <CommitsPanel commits={commits} />

        <div className="flex-1 rounded-lg border border-border bg-surface/75 backdrop-blur-md px-4 py-4 flex flex-col gap-2 min-h-0 overflow-auto">
          <span className="text-xs font-semibold text-textPrimary">Log gần đây</span>
          <div className="font-mono flex flex-col gap-1.5 text-[10.5px] text-textMuted">
            {logs === null && !logsError && <span>Đang tải log…</span>}
            {logsError && <span>Không tải được log.</span>}
            {logs !== null && logs.length === 0 && <span>Chưa có log trong 24h qua.</span>}
            {logs !== null &&
              logs.map((log, i) => {
                const level = detectLogLevel(log.message);
                return (
                  <span key={i} className="break-all">
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

What changed from the shipped version, and why: every `bg-surface` panel became `bg-surface/75 backdrop-blur-md` (real glassmorphism, matching the design system's Surface 1 spec, not a flat color); the primary CTA and GitHub link gained real hover transitions (`hover:shadow-glowCyan`, `hover:border-borderStrong`); the 4 stat tiles gained a `border-t-2 border-t-accent` top accent hairline (a real structural device the design system's card spec calls for, not decoration — the mockup's KPI tiles use this same top-edge treatment); every numeric value gained `tabular-nums` so digits don't jitter on re-render; the "Agentic RAG" architecture-flow node and its matching feature card switched from cyan to indigo (`border-secondary`, `text-secondaryBright`, `shadow-glowIndigo`), correcting a semantic-color mismatch against the design system, which reserves indigo specifically for RAG/agent elements and cyan for realtime data-flow elements. No text content, no data source, and no destructive action changed.

- [ ] **Step 2: Verify**

Run: `cd web && npx tsc --noEmit && npx next build`
Expected: both clean.

- [ ] **Step 3: Commit**

```bash
cd web && git add app/page.tsx
git commit -m "feat: visual fidelity pass on Showcase & Overview (glass panels, glow, indigo RAG accent)"
```

---

### Task 4: Apply fidelity pass to Live Metrics & Ops (`web/app/dashboard/page.tsx`)

**Files:**
- Modify: `web/app/dashboard/page.tsx`

**Interfaces:**
- Consumes: `LiveBadge` from `@/components/LiveBadge` (Task 2).

- [ ] **Step 1: Replace the entire file**

Replace `web/app/dashboard/page.tsx` entirely:

```tsx
"use client";

import { useEffect, useState } from "react";
import { KpiCard } from "@/components/KpiCard";
import { SourceVolumeChart } from "@/components/SourceVolumeChart";
import { ActivityFeed } from "@/components/ActivityFeed";
import { LiveBadge } from "@/components/LiveBadge";
import type { DashboardResponse, CostResponse } from "@/lib/types";

// sourceId matches lib/settingsMeta.ts's DATA_SOURCES ids and
// lib/athena.ts's buildSourceVolumeQuery source values. lambdaLabel
// matches lib/opsMeta.ts's PIPELINE_LAMBDAS labels -- NOT a
// `${sourceId}_ingestion` string pattern, since github's real label is
// "github_trending_ingestion", not "github_ingestion".
const SOURCES: { sourceId: string; label: string; lambdaLabel: string }[] = [
  { sourceId: "hackernews", label: "Hacker News", lambdaLabel: "hackernews_ingestion" },
  { sourceId: "news", label: "News API", lambdaLabel: "news_ingestion" },
  { sourceId: "weather", label: "Weather", lambdaLabel: "weather_ingestion" },
  { sourceId: "crypto", label: "Crypto", lambdaLabel: "crypto_ingestion" },
  { sourceId: "github", label: "GitHub Trending", lambdaLabel: "github_trending_ingestion" },
];

function relativeTime(iso: string | null, now: Date = new Date()): string {
  if (!iso) return "chưa có dữ liệu";
  const diffMs = now.getTime() - new Date(iso).getTime();
  const minutes = Math.max(0, Math.round(diffMs / 60000));
  if (minutes < 1) return "vừa xong";
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.round(minutes / 60);
  return `${hours} giờ trước`;
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

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cost, setCost] = useState<CostResponse | null>(null);

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

  useEffect(() => {
    fetch("/api/cost")
      .then((res) => res.json().then((body) => ({ ok: res.ok, body })))
      .then(({ ok, body }) => {
        if (ok && typeof body?.monthToDateCostUsd === "number") setCost(body);
      })
      .catch(() => {
        /* cost is secondary -- never block the page over it */
      });
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
      <div className="p-9 grid grid-cols-3 gap-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-24 rounded-lg border border-border bg-surface/75 backdrop-blur-md animate-pulse" />
        ))}
      </div>
    );
  }

  const avgLatencyMs = (() => {
    const withDuration = data.lambdaHealth.filter((r) => r.avgDurationMs !== null);
    if (withDuration.length === 0) return null;
    return Math.round(withDuration.reduce((sum, r) => sum + (r.avgDurationMs ?? 0), 0) / withDuration.length);
  })();

  const healthBySource = new Map(data.lambdaHealth.map((r) => [r.functionLabel, r]));
  const volumeBySource = new Map(data.sourceVolumes.map((s) => [s.source, s.records]));
  const maxCost = Math.max(1, ...data.costBreakdown.map((c) => c.monthlyUsd));

  return (
    <div className="p-9 flex flex-col gap-5">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-textPrimary">Live Metrics & Ops</h1>
        <p className="mt-1.5 text-sm text-textSecondary">
          {data.sourcesHealthy}/{data.sourcesTotal} nguồn OK · EventBridge {data.schedule.scheduleExpression}{" "}
          <span className={data.schedule.enabled ? "text-success" : "text-error"}>
            {data.schedule.enabled ? "ENABLED" : "DISABLED"}
          </span>{" "}
          · {data.alarmsTotal} CloudWatch alarm
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <KpiCard label="Bản ghi hôm nay" value={String(data.recordsToday)} />
        <KpiCard
          label="Độ trễ trung bình"
          value={avgLatencyMs === null ? "—" : `${avgLatencyMs}ms`}
          hint="6 Lambda, 24h"
        />
        <KpiCard label="Chi phí tháng này" value={cost ? `$${cost.monthToDateCostUsd.toFixed(2)}` : "—"} hint="đến hôm nay" />
      </div>

      <div className="grid grid-cols-[1.4fr_1fr] gap-4">
        <SourceVolumeChart sourceVolumes={data.sourceVolumes} />
        <ActivityFeed items={data.recentActivity} />
      </div>

      <div className="rounded-lg border border-border bg-surface/75 backdrop-blur-md px-5 py-4 flex flex-col gap-3">
        <span className="text-[13px] font-semibold text-textPrimary">Realtime Ingestion Streams (5 nguồn dị chủng)</span>
        <span className="text-[10.5px] text-textMuted">
          ● OK nghĩa là Lambda chạy không lỗi -- một nguồn có thể OK nhưng ghi 0 bản ghi hôm nay nếu không có dữ liệu mới.
        </span>
        <div className="grid grid-cols-5 gap-3">
          {SOURCES.map(({ sourceId, label, lambdaLabel }) => {
            const health = healthBySource.get(lambdaLabel);
            const records = volumeBySource.get(sourceId) ?? 0;
            return (
              <div key={sourceId} className="rounded-lg border border-border bg-surfaceHigh px-3 py-3 flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-textPrimary">{label}</span>
                <LiveBadge status={health?.status ?? "idle"} />
                <span className="font-mono tabular-nums text-[11px] text-textSecondary">{records} bản ghi hôm nay</span>
                <span className="font-mono tabular-nums text-[10.5px] text-textMuted">
                  {health?.avgDurationMs === null || health?.avgDurationMs === undefined ? "—" : `${health.avgDurationMs}ms`} ·{" "}
                  {relativeTime(health?.lastInvocationAt ?? null)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-lg border border-border bg-surface/75 backdrop-blur-md px-5 py-4 flex flex-col gap-3">
          <span className="text-[13px] font-semibold text-textPrimary">Lakehouse Storage</span>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-[11px] text-textSecondary">S3 raw</span>
              <span className="font-mono tabular-nums text-sm text-textPrimary">{formatBytes(data.rawStorage.sizeBytes)}</span>
              <span className="font-mono tabular-nums text-[10.5px] text-textMuted">
                {data.rawStorage.objectCount === null ? "—" : `${data.rawStorage.objectCount} object`}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[11px] text-textSecondary">S3 curated</span>
              <span className="font-mono tabular-nums text-sm text-textPrimary">{formatBytes(data.curatedStorage.sizeBytes)}</span>
              <span className="font-mono tabular-nums text-[10.5px] text-textMuted">
                {data.curatedStorage.objectCount === null ? "—" : `${data.curatedStorage.objectCount} object`}
              </span>
            </div>
          </div>
          <div className="flex flex-col gap-1 pt-1 border-t border-border">
            <span className="text-[11px] text-textSecondary">Athena avg query time (24h)</span>
            <span className="font-mono tabular-nums text-sm text-textPrimary">
              {data.athenaAvgQueryMs === null ? "chưa có query trong 24h" : `${data.athenaAvgQueryMs}ms`}
            </span>
          </div>
          <div className="flex flex-col gap-1 pt-1 border-t border-border">
            <span className="text-[11px] text-textSecondary">Partition projection</span>
            <span className="font-mono text-[10.5px] text-textMuted">
              year/month/day, integer projection (Glue Catalog, infra/glue.tf)
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="rounded-lg border-t-2 border-t-warning border border-border bg-surface/75 backdrop-blur-md px-5 py-4 flex flex-col gap-2">
            <span className="text-[13px] font-semibold text-textPrimary">CloudWatch Alarms</span>
            <span className="font-mono tabular-nums text-xl text-textPrimary">
              {data.alarmsBreaching} / {data.alarmsTotal} <span className="text-xs text-textMuted">breaching</span>
            </span>
          </div>
          <div className="rounded-lg border border-border bg-surface/75 backdrop-blur-md px-5 py-4 flex flex-col gap-2 min-h-0 overflow-auto">
            <span className="text-xs font-semibold text-textPrimary">Log gần đây</span>
            <div className="font-mono flex flex-col gap-1.5 text-[10.5px] text-textMuted">
              {data.recentLogs.length === 0 && <span>Chưa có log trong 24h qua.</span>}
              {data.recentLogs.map((log, i) => {
                const level = detectLogLevel(log.message);
                return (
                  <span key={i} className="break-all">
                    <span className={logLevelColor(level)}>{level}</span> {log.source}: {log.message}
                  </span>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-lg border border-border bg-surface/75 backdrop-blur-md px-5 py-4 flex flex-col gap-2.5">
          <span className="text-xs font-semibold text-textPrimary">Chi phí theo hạng mục</span>
          <div className="flex flex-col gap-2">
            {data.costBreakdown.map((c) => (
              <div key={c.category} className="flex items-center gap-2">
                <span className="w-[110px] text-[11px] text-textSecondary">{c.category}</span>
                <div className="flex-grow h-1.5 rounded bg-border">
                  <div className="h-full rounded bg-gradient-to-r from-accent to-accentBright" style={{ width: `${(c.monthlyUsd / maxCost) * 100}%` }} />
                </div>
                <span className="font-mono tabular-nums text-[10.5px] text-textMuted">${c.monthlyUsd.toFixed(2)}</span>
              </div>
            ))}
          </div>
          <span className="text-[10.5px] text-textMuted">
            4 hạng mục có giá cụ thể nhất -- ước tính tĩnh/tháng từ infra/README.md, không phải số liệu Cost Explorer theo thời gian thực. Xem infra/README.md.
          </span>
        </div>

        <div className="rounded-lg border border-border bg-surface/75 backdrop-blur-md px-5 py-4 flex flex-col gap-2.5">
          <span className="text-xs font-semibold text-textPrimary">Liên kết nhanh</span>
          <div className="flex flex-col gap-2">
            <a
              href="https://console.aws.amazon.com/cloudwatch/home#alarmsV2:"
              target="_blank"
              rel="noreferrer"
              className="text-[12px] text-accent transition-colors hover:text-accentBright"
            >
              CloudWatch Alarms Console →
            </a>
            <a
              href="https://console.aws.amazon.com/athena/home#/query-editor"
              target="_blank"
              rel="noreferrer"
              className="text-[12px] text-accent transition-colors hover:text-accentBright"
            >
              Athena Query Editor →
            </a>
            <a
              href="https://github.com/coderuit3k/realtime-data-pipeline/actions"
              target="_blank"
              rel="noreferrer"
              className="text-[12px] text-accent transition-colors hover:text-accentBright"
            >
              GitHub Actions →
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
```

What changed from the shipped version, and why: every panel gained the same real glassmorphism (`bg-surface/75 backdrop-blur-md`) as Task 3, for one consistent visual language across both pages; the per-source health grid's plain-text `● OK`/`● Lỗi` labels are replaced by the real `LiveBadge` component (a genuine pulsing indicator for the `ok` state, matching the design system's "Live Status Badge" spec), and each source card's background moved from the flat `bg-bg` to the new `bg-surfaceHigh` elevated tier so it visually nests inside its parent glass panel; the CloudWatch Alarms card gained a `border-t-2 border-t-warning` top accent (alarms are a warning-semantic element, matching the design system's amber "latency degradations/pipeline bottlenecks" color); the cost-breakdown bars gained the same cyan gradient fill as the landing page's real chart; the three external quick-links gained a real hover color transition. No number, no API call, and no destructive control changed.

- [ ] **Step 2: Verify**

Run: `cd web && npx tsc --noEmit && npx next build`
Expected: both clean.

- [ ] **Step 3: Commit**

```bash
cd web && git add app/dashboard/page.tsx
git commit -m "feat: visual fidelity pass on Live Metrics & Ops (glass panels, live-status pulse, glow)"
```

---

## After all tasks: manual verification (part of this plan's final review, not a separate task)

- `cd web && npx tsc --noEmit && npx next build` — clean.
- `cd web && npx vitest run` — unaffected, still passing (this plan touches no `.ts`/`.test.ts` file).
- Local dev server or live site: visit `/` and `/dashboard`, confirm glassmorphism panels render visibly (translucent + blurred, not flat), the `LiveBadge` on a healthy source genuinely pulses, the "Agentic RAG" architecture node and feature card are indigo (not cyan), and no data value or link changed from what's live today.
- Screenshot both pages and compare side by side against the real Stitch "Phương án 1" mockup screenshots for Showcase & Overview and Live Ops & Metrics Dashboard, per the frontend-design skill's own critique step — note any remaining visible gap for a possible follow-up pass, but do not block merging this plan on achieving literal pixel-identity, since some mockup elements (sparkline charts with no real historical data source, a countdown timer with no real "next scheduled run" field exposed by any API) are deliberately not reproduced per this plan's Global Constraints.
