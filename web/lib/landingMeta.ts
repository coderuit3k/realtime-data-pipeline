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

// Real combined automated test count, recounted 2026-09-23 LAST, after
// every other change in the "Live Metrics & Ops" final-review fix wave
// (docs/superpowers/sdd/2026-09-23-live-metrics-ops/fix-wave-1) landed --
// this project previously shipped a bug where TEST_COUNT was set BEFORE
// a fix wave's own test-file changes were counted, so this constant is
// always recomputed last, from a fresh run, never carried over. Fix 7 of
// that wave changed lib/s3Metrics.test.ts's mock Values/Timestamps order
// (so the "latest by timestamp" test actually exercises that logic
// instead of trivially passing a "last element" implementation) but did
// not add or remove any test, so the vitest count is unchanged from the
// prior snapshot -- verified, not assumed, by rerunning both suites:
//   .venv/bin/python -m pytest tests/ --collect-only -q   -> 74
//   cd web && npx vitest run                              -> 178 (40 files)
// 74 + 178 = 252. Both are real, currently-passing suites for this same
// project (Python pipeline + TypeScript web app).
export const TEST_COUNT = 252;

// Reused directly from opsMeta.ts's existing, already-cited
// COST_ESTIMATE_USD -- never re-derived separately.
export const MONTHLY_COST_USD = COST_ESTIMATE_USD;

// Real count of the 12 real Southern Vietnam weather locations --
// derived from weatherMeta.ts's WEATHER_LOCATION_NAMES (built for the
// Weather sub-project), never re-declared as a second hardcoded number.
export const WEATHER_LOCATION_COUNT = WEATHER_LOCATION_NAMES.length;
