# Plan: bring the 5 remaining pages to visual parity (glass panels + icons + motion)

## Context

Two pages (Showcase & Overview, Live Metrics & Ops) already went through a visual-fidelity pass
(glass panels — `bg-surface/75 backdrop-blur-md` — plus glow accents) and a follow-up icons +
motion pass (hand-drawn inline SVG icons, hover-lift, pulsing status dots), both grounded in the
real Stitch "Phương án 1" mockups and both shipped/live-verified.

Five more real, live pages in this app never got either pass and still use the pre-fidelity
`bg-surface` flat panels with zero icons: `/assistant` (RAG Assistant — sidebar labels it "RAG
Comparison Studio", a stale label from before this project retired its CRAG pipeline; leaving that
label alone, it's a separate decision, not part of this plan), `/catalog` (Data Catalog — sidebar
labels it "Architecture & Lakehouse", but the live page is a much smaller Glue-table/schema
browser than that name implies; also not this plan's problem to fix), `/cicd` (CI/CD Pipeline),
`/explorer` (Data Explorer), `/insights` (Trending Insights).

The user confirmed (2026-09-24): bring all 5 to full parity with the two already-done pages —
glass panels, glow/border accents, hand-drawn icons, hover motion, `tabular-nums` on every numeric
span — not just a lighter icons-only bolt-on.

Two of these five pages (`/assistant`, `/catalog`) loosely correspond to real Stitch mockups
("Dual-RAG Comparison Studio" and "System Architecture & Lakehouse"), but both mockups describe
much bigger pages than what's actually live (the mockups model dual-CRAG-vs-Agent benchmarking and
a full infra/CI-CD/cost dashboard neither of which exist as real data sources for these routes).
Per this project's standing "everything must be real" rule, this plan does NOT invent new
sections or fabricate data to chase those mockups' scope — it only applies the same glass/icon/
motion treatment to each page's existing real content, the same as was done for the two pages that
already shipped.

## Global constraints (same as every prior task on this project)

- Visual/markup-only changes. Zero data-fetching, computation, or copy/content changes — every
  prop, API call, and piece of real data stays exactly as it is today.
- TypeScript strict; no new npm dependencies (no icon library/font — hand-drawn inline SVG only,
  `viewBox="0 0 24 24"`, `stroke` (currentColor or an explicit hex matching a design token),
  `strokeWidth={1.8}`, `strokeLinecap="round" strokeLinejoin="round"`, matching every icon this
  codebase has drawn so far); no new test infrastructure.
- Every `animate-ping`/`animate-pulse`/`animate-spin` usage needs `motion-reduce:animate-none`
  alongside it.
- Reuse this codebase's own existing icons verbatim wherever the same concept repeats (exact path
  data given per-task below) instead of redrawing a similar shape — keeps the icon language
  consistent app-wide.
- After every task, run and confirm clean:
  `cd /home/thanh/project/1/web && npx tsc --noEmit`
  `cd /home/thanh/project/1/web && npx next build`
  `cd /home/thanh/project/1/web && npx vitest run`
- Commit with a message ending in: `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`

## Icon reuse library (exact path data already live in this codebase)

Copy these verbatim (adjust only `width`/`height`/`stroke` color per call site as each task says):

- **Cloud** (`web/app/dashboard/page.tsx` weather icon): `<path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />`
- **Coin/cost** (`web/app/dashboard/page.tsx` crypto icon): `<circle cx="12" cy="12" r="9" /><path d="M14.5 9.5c0-1.1-1.1-2-2.5-2s-2.5.8-2.5 1.9c0 2.6 5 1.4 5 4 0 1.1-1.1 1.9-2.5 1.9s-2.5-.9-2.5-2" /><path d="M12 6.5v1M12 16v1" />`
- **Document** (`web/app/dashboard/page.tsx` Hacker News icon): `<path d="M8 3h6l4 4v13a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" /><path d="M14 3v4h4" />`
- **Newspaper** (`web/app/dashboard/page.tsx` News API icon): `<rect x="3" y="5" width="18" height="14" rx="1.5" /><path d="M7 9h10M7 12.5h10M7 16h6" />`
- **Git-branch** (`web/app/page.tsx` "IaC + CI/CD thật" FeatureCard icon): `<line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" />`
- **Clock** (`web/app/dashboard/page.tsx` "Độ trễ trung bình" KPI icon): `<circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" />`
- **Activity/pulse-line** (`web/app/dashboard/page.tsx` "Bản ghi hôm nay" KPI icon): `<path d="M2 12h4l2.5-7 4 14 2.5-7H22" />`
- **Layers** (`web/app/page.tsx` "nguồn dữ liệu" stat-tile icon): `<path d="M12 3 2 8l10 5 10-5-10-5Z" /><path d="M2 12l10 5 10-5" /><path d="M2 16l10 5 10-5" />`
- **Bolt** (`web/components/Sidebar.tsx` brand mark / `web/app/page.tsx` "Lambda" stat-tile icon): `<path d="M13 2 3 14h8l-1 8 10-12h-8l1-8z" />`
- **Shield-check** (`web/app/page.tsx` "test tự động" stat-tile icon): `<path d="M12 3l7 3v5c0 4.5-3 8-7 9-4-1-7-4.5-7-9V6l7-3Z" /><path d="m9 12 2 2 4-4" />`
- **Magnifying-glass** (`web/app/page.tsx` Glue/Athena architecture-node icon): `<circle cx="10.5" cy="10.5" r="6.5" /><path d="M20 20l-4.35-4.35" />`
- **Archive-box** (`web/app/page.tsx` S3 architecture-node icon): `<rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8" /><path d="M10 13h4" />`
- **Cloud+arrow** (`web/app/page.tsx` ingestion architecture-node icon): `<path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" /><path d="M12 8v7M9 12l3 3 3-3" />`
- **Agentic-RAG chat-bubble** (`web/app/page.tsx` "Agentic RAG thật" FeatureCard icon, indigo `#8B5CF6`): `<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />`
- **Trending-up** (`web/components/Sidebar.tsx` "Insights" legacy-nav icon): `<path d="M3 17 9 11 13 15 21 7M21 7h-6M21 7v6" />`

New icons this plan introduces (used once each, defined in the task that needs them):
- **Person** (chat user avatar): `<circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 4-6 8-6s8 2 8 6" />`
- **Checkmark** (CI/CD success stage): `<path d="M20 6 9 17l-5-5" />`
- **X-mark** (CI/CD failure/cancelled/skipped stage): `<path d="M18 6 6 18M6 6l12 12" />`
- **Partial-ring / spinner** (CI/CD in_progress stage, paired with `animate-spin`): `<path d="M21 12a9 9 0 1 1-9-9" />`
- **Bookmark** (Data Explorer "Truy vấn mẫu" panel icon): `<path d="M6 3h12v18l-6-4-6 4V3Z" />`
- **Table/grid** (Data Explorer "Kết quả" panel icon, Data Catalog "Schema" panel icon): `<rect x="3" y="4" width="18" height="16" rx="1.5" /><path d="M3 10h18M9 4v16" />`
- **Play triangle** (Data Explorer "Chạy" button, replacing the current `▶` text glyph): `<path d="M6 4l14 8-14 8V4Z" fill="currentColor" stroke="none" />` (this one is filled, not stroked — a play button reads better solid)
- **Venn/overlap** (Insights "GitHub Trending ↔ HN overlap" panel icon): `<circle cx="9" cy="12" r="6" /><circle cx="15" cy="12" r="6" />`
- **Database-table** (Data Catalog per-table sidebar icon): `<ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5" /><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />`

## Pre-flight conflict scan

| Task | Files touched | Shares with another task? |
|---|---|---|
| 1 | `web/app/assistant/page.tsx`, `web/components/ChatThread.tsx`, `web/components/ToolTrace.tsx` | None — these 2 components are only imported by `app/assistant/page.tsx` (verified via `grep -rl "ChatThread\|ToolTrace" web/app`). |
| 2 | `web/app/catalog/page.tsx` | None — disjoint file. |
| 3 | `web/app/cicd/page.tsx` | None — disjoint file. |
| 4 | `web/app/explorer/page.tsx` | None — disjoint file. |
| 5 | `web/app/insights/page.tsx` | None — disjoint file. |

All 5 tasks touch fully disjoint files and can be dispatched in any order (sequentially, per this
project's no-parallel-implementer convention). Every icon each task needs is either copied
verbatim from the reuse library above or a new one defined in that task — no task depends on
another task's output.

---

## Task 1: RAG Assistant (`/assistant`)

Files: `web/app/assistant/page.tsx`, `web/components/ChatThread.tsx`, `web/components/ToolTrace.tsx`

1. In `web/app/assistant/page.tsx`: change the main chat panel's wrapper class from
   `rounded-lg border border-border bg-surface p-6 flex flex-col gap-4` to
   `rounded-lg border border-border bg-surface/75 backdrop-blur-md p-6 flex flex-col gap-4`.
   Change the input row's wrapper from `border border-border rounded-xl px-3 py-2` to
   `border border-border rounded-xl px-3 py-2 transition-shadow focus-within:border-accent
   focus-within:shadow-glowCyan` (matches this project's real design-system spec, which documents
   exactly this cyan focus-ring treatment for input fields). Change the "Gửi" (send) button's
   class to add `transition-shadow hover:shadow-glowCyan` (matches every other primary CTA in this
   app).
2. In `web/components/ChatThread.tsx`: add a small circular avatar before each bubble.
   - Before the user bubble (`<div className="flex justify-end">`), add a `w-7 h-7 rounded-full
     bg-bg border border-border flex items-center justify-center text-textSecondary
     flex-shrink-0` span containing the **Person** icon (14px, `stroke="currentColor"`), placed
     immediately after the user bubble in the flex row (avatar on the right, since the row is
     `justify-end` — wrap both in a `flex items-end gap-2 justify-end` row so the avatar sits
     beside the bubble, not overlapping it).
   - Before the assistant bubble, add the same-shaped avatar but `border-secondary/40
     text-secondaryBright` containing the **Agentic-RAG chat-bubble** icon (14px,
     `stroke="currentColor"`, since this bubble IS the agent's real answer) — placed to the left
     of the bubble in a `flex items-end gap-2 justify-start` row.
   - Change the assistant bubble's hardcoded `bg-[#0F1728]` to `bg-surface/75 backdrop-blur-md`
     (glass treatment); leave the user bubble's `bg-[#1B2540]` exactly as-is (intentionally a
     distinct, non-glass "sent message" color, matching a normal chat UI convention — not part of
     this project's 4-tier surface hierarchy).
3. In `web/components/ToolTrace.tsx`: change the wrapper from `bg-surface p-5` to
   `bg-surface/75 backdrop-blur-md p-5`. Add the **Agentic-RAG chat-bubble** icon (16px, indigo
   `#8B5CF6`) immediately before the "Tool trace (agent tự quyết định)" label, in a
   `flex items-center gap-2` row wrapping the label.

Verify: `tsc --noEmit`, `next build`, `vitest run` all clean. No changes to `submit()`, the
`/api/assistant` call, or any prop/type in `AssistantResult`.

---

## Task 2: Data Catalog (`/catalog`)

File: `web/app/catalog/page.tsx`

1. Sidebar table-list panel: change wrapper from `border border-border bg-surface p-3.5` to
   `border border-border bg-surface/75 backdrop-blur-md p-3.5`. Add the **Database-table** icon
   (14px, `text-accent`) before each table's name span, in a `flex items-center gap-2` row
   (currently the button is `flex flex-col`; nest the icon+name in a new `flex items-center gap-2`
   row above the existing column/badge caption line).
2. Table detail header panel: change wrapper from `border border-border bg-surface px-5 py-5` to
   `border border-border bg-surface/75 backdrop-blur-md px-5 py-5 border-t-2 border-t-accent`.
   Add the **Database-table** icon (18px, `text-accent`) before the table name, matching the
   sidebar's icon.  For the `badgeLabel` pill: when `table.ragIndexed` is true, prefix it with a
   small green checkmark-in-circle (reuse the **Checkmark** path at 12px inside a `text-success`
   span); when false, leave the pill text-only (no icon) — it's an absence, not a status worth
   iconifying.
3. Schema panel: change wrapper from `border border-border bg-surface px-5 py-5` to
   `border border-border bg-surface/75 backdrop-blur-md px-5 py-5`. Add the **Table/grid** icon
   (16px, `text-accent`) before the "Schema" label, in a `flex items-center gap-2` row.
4. Add `tabular-nums` to the `{tables.length}` count in the page's subtitle and to the
   `{current.columns.length}` count in each sidebar row's caption.

Verify: `tsc --noEmit`, `next build`, `vitest run` all clean. No changes to `/api/catalog`, the
`badgeLabel` function's return values, or any table/column data.

---

## Task 3: CI/CD Pipeline (`/cicd`)

File: `web/app/cicd/page.tsx`

1. Pipeline-stages panel: change wrapper from `border border-border bg-surface px-6 py-5` to
   `border border-border bg-surface/75 backdrop-blur-md px-6 py-5`.
2. Inside each stage's numbered circle (`<div className={... ${colors.ring} ${colors.bg}}>`),
   replace the `<span>{i + 1}</span>` number with a status icon, sized to fit the existing
   `w-9 h-9` circle (use an inner `<svg width="16" height="16" ...>`), chosen by `stage.status`:
   - `"success"` → **Checkmark**, `stroke={colors.text}` (i.e. reuses the same `text-success`
     class already computed).
   - `"in_progress"` → **Partial-ring / spinner**, `stroke={colors.text}`, with the `<svg>`'s
     className including `animate-spin motion-reduce:animate-none` (a real, state-driven
     animation — this spins only while GitHub Actions reports the stage as actually running).
   - `"waiting"` → **Clock** (reuse from the icon library), `stroke={colors.text}`.
   - `"failure"` → **X-mark**, `stroke={colors.text}`.
   - `"cancelled"` or `"skipped"` → **X-mark**, `stroke={colors.text}` (already muted via
     `colors.text` in these cases).
   - default/fallback branch → keep the existing `{i + 1}` number (don't add an icon for a status
     this codebase's own `stageColor` function doesn't otherwise recognize).
3. The "Xem trên GitHub Actions để phê duyệt" link: add `transition-shadow hover:shadow-[0_0_12px_rgba(245,158,11,0.4)]`
   is NOT available as a token (there's no `glowWarning` boxShadow token in `tailwind.config.ts`)
   — instead just add `transition-opacity hover:opacity-90` (a safe, real, minimal hover
   affordance that needs no new token).
4. Recent-runs panel: change wrapper from `border border-border bg-surface px-5 py-5` to
   `border border-border bg-surface/75 backdrop-blur-md px-5 py-5`. Add
   `transition-colors hover:bg-bg/40` to each run row's wrapper div for a subtle hover highlight.
   Add `tabular-nums` to the `{run.branch} · {run.sha}` span and to the duration text inside the
   conclusion link.

Verify: `tsc --noEmit`, `next build`, `vitest run` all clean. No changes to `stageColor`,
`conclusionLabel`, `formatDuration`, or any data from `/api/cicd`.

---

## Task 4: Data Explorer (`/explorer`)

File: `web/app/explorer/page.tsx`

1. Sample-queries sidebar panel: change wrapper from `border border-border bg-surface p-4` to
   `border border-border bg-surface/75 backdrop-blur-md p-4`. Add the **Bookmark** icon (14px,
   `text-accent`) before the "Truy vấn mẫu" label, in a `flex items-center gap-2` row.
2. SQL editor panel: change wrapper from `border border-border bg-surface px-5 py-4` to
   `border border-border bg-surface/75 backdrop-blur-md px-5 py-4`. Replace the "Chạy" button's
   `▶ Chạy` text-glyph content with the **Play triangle** icon (14px, `fill="currentColor"
   stroke="none"`) followed by the text `Chạy` (keep `Đang chạy…` as plain text with no icon while
   `running` is true, matching the existing conditional). Add `transition-shadow
   hover:shadow-glowCyan` to the button's class (matches every other primary CTA in this app).
3. Results panel: change wrapper from `border border-border bg-surface px-5 py-4` to
   `border border-border bg-surface/75 backdrop-blur-md px-5 py-4`. Add the **Table/grid** icon
   (16px, `text-accent`) before the "Kết quả" label, in a `flex items-center gap-2` row.
4. Add `tabular-nums` to the meta line (`Quét {formatBytes(...)} · {...}s · {...} dòng`) and to
   every `<td>` cell's className in the results table.

Verify: `tsc --noEmit`, `next build`, `vitest run` all clean. No changes to `runQuery`, `loadSamples`,
or any query/result data.

---

## Task 5: Trending Insights (`/insights`)

File: `web/app/insights/page.tsx`

1. All 4 grid panels: change each wrapper from `border border-border bg-surface px-5 py-5` to
   `border border-border bg-surface/75 backdrop-blur-md px-5 py-5`.
2. Add one icon before each panel's header label, in a `flex items-center gap-2` row (14-16px,
   `text-accent` unless noted):
   - "Từ khoá nổi bật (HN + News)" → **Trending-up** icon.
   - "Crypto: mentions ↔ biến động giá" → **Coin/cost** icon.
   - "GitHub Trending ↔ HN overlap" → **Venn/overlap** icon.
   - "Thời tiết · N khu vực" → **Cloud** icon.
3. Range-toggle buttons ("Hôm nay" / "7 ngày"): add `transition-colors` to the existing className
   string (cheap hover/active-state smoothing, no new classes needed beyond the transition).
4. Add `tabular-nums` to: each keyword's `{k.mentions}` span; each crypto row's
   `{c.mentionCount} mentions` and `{c.change24hPct...}%` spans; each overlap row's
   `{o.overlapCount}` span; each weather card's `{w.temperatureC...}°C` and
   `độ ẩm {w.humidityPct...}%` text.

Verify: `tsc --noEmit`, `next build`, `vitest run` all clean. No changes to `load`, the `range`
state machine, or any data from `/api/insights`.

---

## After all tasks

Dispatch the final whole-branch review (most capable model), covering all 5 tasks' combined diff.
Focus areas specific to this plan: (1) icon reuse fidelity — every "reuse from the library" icon
should be byte-identical path data to its cited source, not a redrawn approximation; (2) the
`animate-spin` CI/CD spinner is the only new animation type this plan introduces — confirm its
`motion-reduce:animate-none` guard is present and that it only appears on the `in_progress`
branch; (3) real-data purity — confirm zero changes to any of the 5 pages' data-fetching,
computation, or copy across all 5 tasks combined. Then push directly to `main` (this project's
convention — no worktree, no PR) and live-verify all 5 pages in a browser afterward.
