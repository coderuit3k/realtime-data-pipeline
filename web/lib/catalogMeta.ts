import type { CatalogTableMeta } from "./types";

// Both EventBridge rules (shared ingestion and news) default to rate(30 minutes)
// in infra/eventbridge.tf. News has its own rule so it can be slowed down to
// respect NewsAPI's 100 req/day free tier without touching the others.
const CADENCE = "mỗi 30 phút";

/**
 * Hand-maintained facts Glue can't provide, keyed by Glue table name.
 * Every entry must be traceable to code (cited inline); don't add guesses.
 */
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
    cadence: CADENCE,
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
      // ingestion/crypto_ingestion.py: CoinGecko returns whole-dollar prices
      // as ints, which Athena rejects (HIVE_BAD_DATA) on a double column.
      price_usd: "ép float khi ingest (tránh HIVE_BAD_DATA vì CoinGecko trả số nguyên)",
    },
  },
};
