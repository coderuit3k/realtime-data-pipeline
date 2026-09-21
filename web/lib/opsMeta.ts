import type { CostBreakdownEntry } from "./types";

export type PipelineLambda = { suffix: string; label: string };

// Suffixes match infra/lambda.tf's 6 aws_lambda_function resources
// outside infra/rag.tf (the RAG Lambdas are out of this page's scope).
export const PIPELINE_LAMBDAS: PipelineLambda[] = [
  { suffix: "hackernews-ingestion", label: "hackernews_ingestion" },
  { suffix: "news-ingestion", label: "news_ingestion" },
  { suffix: "weather-ingestion", label: "weather_ingestion" },
  { suffix: "crypto-ingestion", label: "crypto_ingestion" },
  { suffix: "github-trending-ingestion", label: "github_trending_ingestion" },
  { suffix: "transform", label: "transform" },
];

// Same figure already shown on the Dashboard page -- moved here so both
// pages read one source of truth instead of two separately-maintained
// copies of the same number.
export const COST_ESTIMATE_USD = 1.02;

// Sourced from infra/README.md's "## Cost & teardown" table. Deliberately
// NOT asserted to sum to COST_ESTIMATE_USD -- see this plan's Global
// Constraints for why that reconciliation doesn't hold and must not be
// forced.
export const COST_BREAKDOWN: CostBreakdownEntry[] = [
  { category: "Secrets Manager", monthlyUsd: 0.8 },
  { category: "CloudWatch alarms", monthlyUsd: 0.6 },
  { category: "Lambda + S3", monthlyUsd: 0 },
  { category: "Cost Explorer API", monthlyUsd: 0.3 },
];
