# Catalog page — design spec

## Overview

Add a third real screen to the `web/` Next.js app: `/catalog`, showing the
5 curated tables in the AWS Glue Data Catalog that back this pipeline
(`hackernews_stories`, `news_articles`, `weather_observations`,
`crypto_prices`, `github_repos`). This is the first of 8 sub-projects
that bring the remaining mockup screens (Explorer, Catalog, Insights,
Ops, Cicd, Weather, Settings, Landing) to real, AWS-backed
implementations, matching the pattern already shipped for Dashboard and
RAG Assistant. Each sub-project gets its own spec → plan →
subagent-driven-development cycle; this document covers Catalog only.

Reference mockup: Design canvas
`https://claude.ai/artifact/Ccbcs7E8ZSsf4fUG5opm4W`, `project/Catalog.dc.html`.

## Non-goals

- No editing of tables/schema — read-only.
- No row-level browsing of table contents (that's the Explorer
  sub-project, next in the build order).
- No live row counts (`SELECT COUNT(*)`) — out of scope, adds Athena
  query cost/latency for a screen whose job is schema, not volume
  (volume is already Dashboard's job).

## Real data sources — verified against code

| Fact shown on screen | Source | Verified in |
|---|---|---|
| Table names, column names, column types | Live AWS Glue `GetTables` call | N/A — always live |
| S3 storage location per table | Live `StorageDescriptor.Location` field from the same Glue response | N/A — always live |
| Which tables feed the RAG knowledge base | Static classification, per-table | `rag/build_index.py:101-103` — only `hackernews`, `news`, `github` are read into the index |
| Ingestion cadence ("mỗi 10 phút") | Static, shared by all 5 sources | `infra/eventbridge.tf` — one `aws_cloudwatch_event_rule` at `var.ingestion_schedule` (default `rate(10 minutes)`) targets all 5 ingestion Lambdas |
| Per-column notes (e.g. "ép float khi ingest, tránh HIVE_BAD_DATA") | Static, per-column, only where verified | Example verified in `ingestion/crypto_ingestion.py:32-39` (explicit `float()` cast on CoinGecko's whole-dollar prices) |
| Source API per table (e.g. CoinGecko `/simple/price`) | Static | Each `ingestion/*.py` file's request URL |

Columns/tables without a verified note show no note — never a fabricated
one. The static facts (RAG classification, cadence, source API, verified
column notes) live in one new file, `web/lib/catalogMeta.ts`, so the
provenance is auditable in one place instead of scattered as inline
prose.

## Architecture

```
GET /api/catalog
  → web/lib/glue.ts: listCuratedTables()
      → AWS Glue GetTables(DatabaseName: ATHENA_DATABASE)
      → returns [{ name, columns: [{name, type}], location }]
  → merge each table with web/lib/catalogMeta.ts static entry
  → web/lib/types.ts: CatalogTable[]
  → NextResponse.json, Cache-Control: s-maxage=300 (schema changes rarely)
```

- `web/lib/glue.ts` (new) — `listCuratedTables(client, database)` wraps
  `GetTablesCommand`, maps Glue's `Table[]` shape (`StorageDescriptor.Columns`,
  `StorageDescriptor.Location`) into a small internal shape. Mirrors the
  existing `web/lib/athena.ts` style: one exported function per query,
  no class, no retry/pagination beyond what 5 tables ever need (Glue
  paginates at 100 results/page; 5 tables never triggers a second page,
  so no pagination loop is implemented).
- `web/lib/aws.ts` — add `getGlueClient()` singleton, same pattern as
  `getAthenaClient()`/`getCloudWatchClient()`.
- `web/lib/catalogMeta.ts` (new) — a `Record<string, CatalogTableMeta>`
  keyed by table name: `{ ragIndexed: boolean, sourceApi: string,
  ingestionLambda: string, cadence: string, columnNotes?:
  Record<string, string> }`. Pure data, no logic.
- `web/lib/types.ts` — add `CatalogTable`, `CatalogColumn`,
  `CatalogTableMeta` types.
- `web/app/api/catalog/route.ts` (new, GET) — calls `listCuratedTables`,
  merges with `catalogMeta`, returns `CatalogTable[]`. `ATHENA_DATABASE`
  (already a required env var for Athena) is reused as the Glue database
  name — no new environment variable. `export const maxDuration = 60;`
  for consistency with the other two API routes, though a 5-table
  `GetTables` call is expected to complete in well under a second.
- `web/app/catalog/page.tsx` (new, client component) — fetches
  `/api/catalog` on mount, renders the two-column layout from the
  mockup: left list of 5 tables (name, live column count, RAG/numeric
  badge), right detail panel for the selected table (badges, cadence +
  source-API caption, schema table with column/type/note, storage
  location footer). Selection state is local (`useState`), defaults to
  the first table.
- `web/components/NavBar.tsx` — add a `{ href: "/catalog", label: "Data Catalog" }`
  entry.

## Error handling

- Glue call fails (network, permissions, table not found) → route
  returns `{ error: "Không tải được Data Catalog, thử lại sau." }`,
  status 500, uncached — identical shape to the Dashboard/Assistant
  error responses.
- Table list arrives with a name not present in `catalogMeta` (e.g. a
  future table added to Terraform before this map is updated) → still
  rendered, with `ragIndexed` defaulting to `false` and no cadence/notes
  shown, rather than throwing. Schema is always shown regardless of
  whether static metadata exists.

## IAM

The manually-managed IAM user's policy (documented in
`infra/README.md`, created outside Terraform per the earlier Task 12
decision) needs two more actions added, scoped to the existing curated
database ARN:

```json
{
  "Sid": "GlueReadCuratedCatalog",
  "Effect": "Allow",
  "Action": ["glue:GetTables", "glue:GetTable"],
  "Resource": [
    "arn:aws:glue:<region>:<account-id>:catalog",
    "arn:aws:glue:<region>:<account-id>:database/realtime_data_pipeline_dev_curated",
    "arn:aws:glue:<region>:<account-id>:table/realtime_data_pipeline_dev_curated/*"
  ]
}
```

`infra/README.md`'s manual-setup script gets this statement added; the
user re-runs `put-user-policy` with their own credentials, same as the
original Task 12 workflow — the assistant does not touch IAM directly.

## Testing

- `web/lib/glue.test.ts` — unit tests mocking `GlueClient.send`,
  covering: normal mapping, a table missing `StorageDescriptor` (should
  not throw — location falls back to `""`), empty column list.
- `web/app/api/catalog/route.test.ts` — success path (merges live +
  static data correctly), Glue-throws path (500 + Vietnamese error
  message), unknown-table-not-in-catalogMeta path (defaults applied,
  no throw).
- No component tests for `page.tsx`, consistent with Dashboard/Assistant
  (manual live verification instead, per existing project convention).
- Live verification checklist after deploy: open `/catalog`, confirm
  all 5 real table names render, confirm selecting each table shows a
  schema whose column count matches `infra/glue.tf`'s column list for
  that table, confirm the storage-location footer shows the real S3
  bucket name (not a placeholder).

## Open assumptions

- `catalogMeta.ts`'s per-column notes will only be populated for
  columns with a verified rationale found during implementation (like
  the crypto float-cast example above); most columns will show no note.
  This is intentional, not a gap to fill later.
- The Glue database name equals `ATHENA_DATABASE`'s value — true today
  by construction (`infra/glue.tf`'s `aws_glue_catalog_database.curated`
  is the same object Athena queries against), and will keep being true
  unless the Athena/Glue split diverges in future infra work.
