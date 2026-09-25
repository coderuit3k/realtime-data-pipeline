# Catalog Excel export — design spec

## Overview

Add a real "Xuất Excel" (export to Excel) feature to `/catalog`. Clicking
the button runs 5 real Athena queries (one per curated table), builds a
real `.xlsx` workbook with one sheet per table, uploads it to a real
Cloudflare R2 bucket the user already created (`excel`), and hands the
browser a short-lived presigned download URL. This is the first of two
independent sub-projects using the user's 2 real R2 buckets (`mail` and
`excel`) — this spec covers `excel` only; a real-email ingestion source
using the `mail` bucket is a separate, later sub-project.

## Goals

- A real, on-demand snapshot of all 5 curated Athena tables as one
  `.xlsx` file, downloadable from the live `/catalog` page.
- Reuse this codebase's existing Athena query machinery
  (`lib/athena.ts`'s `runAthenaQueryWithStats`/`parseAthenaRows`,
  already powering `/api/explorer/query`) rather than inventing a new
  query path.
- Real Cloudflare R2 write, using credentials the user creates and
  pastes into Vercel's env var UI — this assistant never generates or
  handles the R2 API token itself, same boundary as every AWS/Supabase
  credential in this project.

## Non-goals

- **No Terraform changes.** Both R2 buckets already exist (the user
  created them manually in the Cloudflare dashboard, outside this
  project's Terraform state, which is AWS-only). This is a pure
  application-level integration, the same way Supabase was added
  without a new Terraform provider.
- **No scheduled/automatic export.** Every export is triggered by a
  real click on `/catalog`; there is no EventBridge/cron path for this
  feature (that was considered and explicitly not chosen — see the
  brainstorming transcript this spec follows from).
- **No export history/listing UI.** Each click uploads a new
  timestamped object to R2 and returns a presigned URL for that one
  file; there is no page listing past exports. Out of scope for v1.
- **No unbounded table scan.** Each sheet is capped at `LIMIT 5000` rows
  per table — generous headroom over this project's real, low ingestion
  volume (every 30 minutes, 5 sources), but still a hard, predictable
  bound on Athena cost and file size.
- **The `mail` R2 bucket is untouched by this sub-project.**

## Architecture / data flow

1. User clicks "Xuất Excel" on `/catalog`.
2. Browser calls `POST /api/catalog/export` (no request body).
3. Route checks a real rate limit (`getExportLimiter()`, keyed by
   `clientIp(request)` — never a client-controlled session ID, per the
   real bypass this project already found and fixed once for the
   conversation-rate-limit route).
4. Route runs 5 real Athena queries in parallel, one per curated table:
   `SELECT * FROM <table> LIMIT 5000`, via the existing
   `getAthenaClient()` / `runAthenaQueryWithStats(client, sql)` /
   `parseAthenaRows(rows, mapRow)` helpers in `lib/athena.ts` — no new
   Athena-calling code, only new call sites.
5. Route builds one in-memory `.xlsx` workbook via
   `lib/excelExport.ts`'s `buildCatalogWorkbook(sheets)`, one sheet per
   table, headers taken verbatim from Athena's own returned column
   names (never hand-duplicated per-table column lists that could drift
   from the real Glue schema).
6. Route uploads the workbook buffer to the `excel` R2 bucket via
   `lib/r2.ts`'s `uploadAndPresign(client, bucket, key, body,
   contentType)`, key `exports/catalog-<ISO-timestamp-with-no-colons>.xlsx`,
   and generates a presigned `GET` URL valid for 10 minutes.
7. Route returns `{ url }` as JSON.
8. Browser navigates to `url`, downloading the file directly from R2 —
   not proxied through the Vercel function, so a large file never counts
   against that function's response-size/duration limits twice.
9. **All-or-nothing:** if any of the 5 queries or the R2 upload fails,
   the whole request fails with one clear error and nothing partial is
   ever uploaded — same pattern `/api/explorer/query` already uses for
   Athena failures (never leak raw AWS internals to the client; log the
   real error server-side, return a safe message).

## Components

### `web/lib/r2.ts` (new)

- Lazy `S3Client` singleton, same lazy-singleton-plus-`requiredEnv`
  shape as `lib/supabase.ts` and every client-getter in `lib/aws.ts`,
  constructed with:
  ```ts
  new S3Client({
    region: "auto",
    endpoint: `https://${requiredEnv("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: requiredEnv("R2_ACCESS_KEY_ID"),
      secretAccessKey: requiredEnv("R2_SECRET_ACCESS_KEY"),
    },
  })
  ```
  (R2's S3-compatible API accepts the standard `@aws-sdk/client-s3` and
  `@aws-sdk/s3-request-presigner` packages unmodified — verified against
  Cloudflare's own R2 S3-API documentation during brainstorming.)
- `getR2Client(): S3Client` — the lazy singleton getter.
- `uploadAndPresign(client: S3Client, bucket: string, key: string, body: Buffer, contentType: string, expiresInSeconds = 600): Promise<string>`
  — `PutObjectCommand` then `getSignedUrl(client, new GetObjectCommand(...), { expiresIn: expiresInSeconds })`.
  Takes the client as its first parameter (this codebase's established
  dependency-injection pattern, e.g. `common/s3_writer.py`'s
  `write_records`, `lib/conversations.ts`'s Supabase functions) so tests
  use a plain fake client object, never real R2 credentials.

### `web/lib/excelExport.ts` (new)

- `buildCatalogWorkbook(sheets: { name: string; columns: string[]; rows: (string | null)[][] }[]): Promise<Buffer>`
  using `exceljs` (new dependency) — one worksheet per entry, first row
  = `columns` as a header row, remaining rows written as-is. Pure
  function: no AWS/R2/network dependency, fully unit-testable with
  plain in-memory data.

### `web/app/api/catalog/export/route.ts` (new)

- `POST`, `export const maxDuration = 60` (existing convention for
  Athena-touching routes, matching `/api/explorer/query`).
- Rate-limits via a new `getExportLimiter()` in `lib/ratelimit.ts`
  (`Ratelimit.slidingWindow(3, "1 h")`, prefix `"export-ratelimit"` —
  tighter than Explorer's per-minute limit because this triggers 5 real
  Athena queries per call, not 1).
- The 5 table names come from a small local constant, not
  `CATALOG_META`'s keys directly, to keep this route's SQL independent
  of that file's display-only shape:
  `["hackernews_stories", "news_articles", "github_repos", "weather_observations", "crypto_prices"]`.
- On any thrown error, logs the real error server-side and returns the
  same non-leaking-AWS-internals safe message pattern as
  `/api/explorer/query`, HTTP 500 (400 is Explorer's choice for a
  user-supplied bad query; this route has no user-supplied SQL, so a
  failure here is always a server-side condition).

### `web/app/catalog/page.tsx` (modified)

- A new "Xuất Excel" button near the page header (next to the existing
  title/subtitle), hand-drawn inline SVG icon (a download-arrow glyph,
  matching this project's no-icon-library convention), disabled with a
  spinner state while the request is in flight, and a real error message
  shown inline on failure (e.g. rate-limited or Athena failure) rather
  than a silent console error — consistent with how other real actions
  in this app surface failure (e.g. Explorer's query error banner).
- On success: `window.location.href = url` (or an equivalent anchor
  click) to start the browser download from the presigned R2 URL.

### `web/.env.example` (modified)

Document 4 new variables, no values:

```
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_EXCEL_BUCKET_NAME=
```

The user creates the R2 API token themselves in the Cloudflare dashboard
(scoped to the `excel` bucket only, if R2's token scoping allows it) and
pastes the values into Vercel's env var UI — this assistant never
generates, requests, or handles these values directly, the same
boundary already established for every AWS and Supabase credential in
this project.

## Testing

- `lib/excelExport.test.ts`: `buildCatalogWorkbook` with plain
  in-memory `sheets` input — assert the returned buffer, when read back
  with `exceljs`, has the right sheet names, the right header row per
  sheet, and the right row count. No AWS/R2 mocking needed at all.
- `lib/r2.test.ts`: `uploadAndPresign` called with a fake client object
  exposing a `send` mock (same shape every other AWS-client test in
  this codebase already uses) — assert it calls `PutObjectCommand` with
  the right bucket/key/body/contentType and returns whatever
  `getSignedUrl` resolves to (mock the `@aws-sdk/s3-request-presigner`
  import).
- `app/api/catalog/export/route.test.ts`: mocks `getAthenaClient`,
  `runAthenaQueryWithStats`, `getR2Client`, and `uploadAndPresign`.
  Cases: rate-limited request returns 429 before any Athena call is
  made; a successful run returns `{ url }` and calls
  `uploadAndPresign` exactly once with a `.xlsx` content type; an
  Athena failure returns a safe error message (never the raw AWS
  error text) and never calls `uploadAndPresign`.
- No Python-side tests — this sub-project touches only `web/`.

## Review focus

- **A partially-failed export must never upload a corrupt/partial
  file** — covered by the all-or-nothing route test above (Athena
  failure ⇒ `uploadAndPresign` never called).
- **The rate limit must key on IP, not anything client-controlled** —
  this project already found and fixed exactly this bug once
  (conversation-rate-limit); the route test asserts `checkRateLimit`
  is called with `clientIp(request)`.
- **A table with zero rows this run must still produce a valid sheet**
  (header row only, no crash) — covered by an `excelExport.test.ts`
  case with an empty `rows` array for one sheet.
- **The presigned URL must expire** — `uploadAndPresign`'s test asserts
  `expiresIn` is actually passed through to `getSignedUrl`, not silently
  dropped.
- **No credential ever reaches the client bundle** — `lib/r2.ts` is
  imported only from the new server-only API route, never from
  `catalog/page.tsx` (a "use client" component); verified the same way
  `lib/supabase.ts`'s server-only boundary was verified for the
  conversations feature (type-only imports on the client side, no
  runtime import of the credential-touching module).
