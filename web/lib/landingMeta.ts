import { DATA_SOURCES } from "./settingsMeta";
import { WEATHER_LOCATION_NAMES } from "./weatherMeta";
import { COST_ESTIMATE_USD } from "./opsMeta";

// Landing-page stats. Derive from the source arrays wherever possible so the
// numbers can't drift; the two hardcoded counts below must be re-measured,
// never adjusted by hand.

export const DATA_SOURCE_COUNT = DATA_SOURCES.length;

// Lambda functions in Terraform (last checked 2026-10-02):
//   grep -n '^resource "aws_lambda_function"' infra/*.tf
// 7 in lambda.tf + 2 in rag.tf + 1 in trends.tf. Deliberately larger than
// DATA_SOURCE_COUNT: gmail_ingestion is not yet a UI-facing source, and
// trend_scan derives from existing sources rather than adding one.
export const LAMBDA_COUNT = 10;

// Python + web test totals (last checked 2026-10-02):
//   .venv/bin/python -m pytest tests/ --collect-only -q   -> 177
//   cd web && npx vitest run                              -> 275
export const TEST_COUNT = 452;

export const MONTHLY_COST_USD = COST_ESTIMATE_USD;

export const WEATHER_LOCATION_COUNT = WEATHER_LOCATION_NAMES.length;
