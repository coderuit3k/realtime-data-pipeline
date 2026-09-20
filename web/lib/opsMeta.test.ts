import { describe, expect, it } from "vitest";
import { PIPELINE_LAMBDAS, COST_ESTIMATE_USD, COST_BREAKDOWN } from "./opsMeta";

describe("PIPELINE_LAMBDAS", () => {
  it("has exactly the 6 real Lambda suffixes from infra/lambda.tf", () => {
    expect(PIPELINE_LAMBDAS.map((l) => l.suffix)).toEqual([
      "hackernews-ingestion",
      "news-ingestion",
      "weather-ingestion",
      "crypto-ingestion",
      "github-trending-ingestion",
      "transform",
    ]);
  });

  it("labels match the mockup's Python module names", () => {
    expect(PIPELINE_LAMBDAS.map((l) => l.label)).toEqual([
      "hackernews_ingestion",
      "news_ingestion",
      "weather_ingestion",
      "crypto_ingestion",
      "github_trending_ingestion",
      "transform",
    ]);
  });
});

describe("COST_ESTIMATE_USD", () => {
  it("is the same value already used on the Dashboard page", () => {
    expect(COST_ESTIMATE_USD).toBe(1.02);
  });
});

describe("COST_BREAKDOWN", () => {
  it("has the 3 real categories cited in infra/README.md's cost table", () => {
    expect(COST_BREAKDOWN).toEqual([
      { category: "Secrets Manager", monthlyUsd: 0.8 },
      { category: "CloudWatch alarms", monthlyUsd: 0.6 },
      { category: "Lambda + S3", monthlyUsd: 0 },
    ]);
  });
});
