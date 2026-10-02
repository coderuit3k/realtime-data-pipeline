import type { CostBreakdownEntry } from "./types";

export type PipelineLambda = { suffix: string; label: string };

// Function-name suffixes (after the ALARM_NAME_PREFIX) of the pipeline Lambdas
// in infra/lambda.tf. RAG, trend and gmail Lambdas are intentionally excluded.
export const PIPELINE_LAMBDAS: PipelineLambda[] = [
  { suffix: "hackernews-ingestion", label: "hackernews_ingestion" },
  { suffix: "news-ingestion", label: "news_ingestion" },
  { suffix: "weather-ingestion", label: "weather_ingestion" },
  { suffix: "crypto-ingestion", label: "crypto_ingestion" },
  { suffix: "github-trending-ingestion", label: "github_trending_ingestion" },
  { suffix: "transform", label: "transform" },
];

// Estimated monthly cost; the single source for every page that shows it.
export const COST_ESTIMATE_USD = 1.02;

// From infra/README.md's "Cost & teardown" table. It intentionally does not
// sum to COST_ESTIMATE_USD; don't "fix" either number to make them match.
export const COST_BREAKDOWN: CostBreakdownEntry[] = [
  { category: "Secrets Manager", monthlyUsd: 0.8 },
  { category: "CloudWatch alarms", monthlyUsd: 0.6 },
  { category: "Lambda + S3", monthlyUsd: 0 },
  { category: "Cost Explorer API", monthlyUsd: 0.3 },
];
