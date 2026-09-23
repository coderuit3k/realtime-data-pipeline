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

// Real combined automated test count, verified 2026-09-23 AFTER this
// branch's sidebar/showcase redesign fix wave was applied -- that wave
// added 5 new vitest tests since the constant was last set: 2 in
// lib/github.test.ts for getRecentCommits, 2 in
// app/api/commits/route.test.ts, and 1 in lib/cloudwatchLogs.test.ts
// for the apiKey/api_key/token redaction added to queryRecentLogs.
// Those additions are themselves part of the real vitest suite this
// constant describes, so the count must include them, not an earlier
// snapshot taken before they existed:
//   .venv/bin/python -m pytest tests/ --collect-only -q   -> 73
//   cd web && npx vitest run                              -> 174 (38 files)
// 73 + 174 = 247. Both are real, currently-passing suites for this
// same project (Python pipeline + TypeScript web app).
export const TEST_COUNT = 247;

// Reused directly from opsMeta.ts's existing, already-cited
// COST_ESTIMATE_USD -- never re-derived separately.
export const MONTHLY_COST_USD = COST_ESTIMATE_USD;

// Real count of the 12 real Southern Vietnam weather locations --
// derived from weatherMeta.ts's WEATHER_LOCATION_NAMES (built for the
// Weather sub-project), never re-declared as a second hardcoded number.
export const WEATHER_LOCATION_COUNT = WEATHER_LOCATION_NAMES.length;
