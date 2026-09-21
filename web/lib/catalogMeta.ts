import type { CatalogTableMeta } from "./types";

// Every fact here is verified against real source, per
// docs/superpowers/specs/2026-09-20-catalog-page-design.md's
// "Real data sources" table. Never add a fact that isn't traceable
// to code.
const CADENCE = "mỗi 10 phút"; // infra/eventbridge.tf: one shared rate(10 minutes) rule for hackernews/weather/crypto/github ingestion Lambdas
const NEWS_CADENCE = "mỗi 20 phút"; // infra/eventbridge.tf: news_ingestion_schedule, its own slower rule -- NewsAPI's free tier caps at 100 req/day

export const CATALOG_META: Record<string, CatalogTableMeta> = {
  hackernews_stories: {
    ragIndexed: true, // rag/build_index.py:101
    sourceApi: "Hacker News Firebase API",
    ingestionLambda: "hackernews-ingestion",
    cadence: CADENCE,
  },
  news_articles: {
    ragIndexed: true, // rag/build_index.py:102
    sourceApi: "NewsAPI /v2/everything",
    ingestionLambda: "news-ingestion",
    cadence: NEWS_CADENCE,
  },
  github_repos: {
    ragIndexed: true, // rag/build_index.py:103
    sourceApi: "GitHub Search API /search/repositories",
    ingestionLambda: "github-trending-ingestion",
    cadence: CADENCE,
  },
  weather_observations: {
    ragIndexed: false,
    sourceApi: "Open-Meteo forecast API",
    ingestionLambda: "weather-ingestion",
    cadence: CADENCE,
  },
  crypto_prices: {
    ragIndexed: false,
    sourceApi: "CoinGecko /simple/price",
    ingestionLambda: "crypto-ingestion",
    cadence: CADENCE,
    columnNotes: {
      // ingestion/crypto_ingestion.py:32-39 -- CoinGecko returns
      // whole-dollar prices as ints; explicit float() avoids Athena's
      // HIVE_BAD_DATA on a column typed double.
      price_usd: "ép float khi ingest (tránh HIVE_BAD_DATA vì CoinGecko trả số nguyên)",
    },
  },
};
