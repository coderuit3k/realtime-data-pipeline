import { DATA_SOURCES } from "./settingsMeta";
import { WEATHER_LOCATION_NAMES } from "./weatherMeta";
import { COST_ESTIMATE_USD } from "./opsMeta";

// Real count of the 5 real ingestion sources -- derived from
// settingsMeta.ts's DATA_SOURCES (built for the Settings sub-project),
// never re-declared as a second hardcoded number, so this can't drift
// from the array it describes.
export const DATA_SOURCE_COUNT = DATA_SOURCES.length;

// Real count of aws_lambda_function resources across this project's
// Terraform, verified 2026-09-23 via:
//   grep -n '^resource "aws_lambda_function"' infra/*.tf
// 6 in infra/lambda.tf (hackernews/news/weather/crypto/github ingestion
// + transform) + 2 in infra/rag.tf (rag_build_index, rag_agent -- CRAG's
// rag_query was retired, see docs/superpowers/specs/2026-09-23-single-
// agentic-rag-design.md) = 8.
export const LAMBDA_COUNT = 8;

// Real combined automated test count, verified 2026-09-23 AFTER the
// single-Agentic-RAG plan's deletions (tests/test_rag_query.py removed;
// web/lib/assistant.test.ts's CRAG-mode cases removed, 4 -> 2 tests) --
// recomputed from a fresh run, not carried over from an earlier snapshot:
//   .venv/bin/python -m pytest tests/ --collect-only -q   -> 59
//   cd web && npx vitest run                              -> 176 (40 files)
// 59 + 176 = 235 total. Both are real, currently-passing suites for this same
// project (Python pipeline + TypeScript web app).
export const TEST_COUNT = 235;

// Reused directly from opsMeta.ts's existing, already-cited
// COST_ESTIMATE_USD -- never re-derived separately.
export const MONTHLY_COST_USD = COST_ESTIMATE_USD;

// Real count of the 12 real Southern Vietnam weather locations --
// derived from weatherMeta.ts's WEATHER_LOCATION_NAMES (built for the
// Weather sub-project), never re-declared as a second hardcoded number.
export const WEATHER_LOCATION_COUNT = WEATHER_LOCATION_NAMES.length;
