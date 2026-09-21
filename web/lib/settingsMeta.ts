import { WEATHER_LOCATION_NAMES } from "./weatherMeta";

export type DataSourceMeta = {
  id: string;
  name: string;
  detail: string;
  usesNewsSchedule: boolean;
};

// CRYPTO_COIN_IDS: verbatim from common/config.py.
const CRYPTO_COIN_IDS = ["bitcoin", "ethereum", "solana"];

// NEWS_QUERY default: common/config.py. GITHUB_TRENDING_DAYS/LIMIT:
// common/config.py (7 / 20). GitHub's real unauthenticated Search API
// rate limit (10 req/min) is documented by GitHub itself, not this
// repo's code -- ingestion/github_trending_ingestion.py calls
// GET /search/repositories, the Search endpoint this limit applies to.
export const DATA_SOURCES: DataSourceMeta[] = [
  {
    id: "hackernews",
    name: "Hacker News",
    detail: "newstories · top 50 · không cần API key",
    usesNewsSchedule: false,
  },
  {
    id: "news",
    name: "News API",
    detail: 'query="cryptocurrency OR technology"',
    usesNewsSchedule: true,
  },
  {
    id: "weather",
    name: "Weather (Open-Meteo)",
    detail: `${WEATHER_LOCATION_NAMES.length} khu vực · không cần API key · ${WEATHER_LOCATION_NAMES.join(", ")}`,
    usesNewsSchedule: false,
  },
  {
    id: "crypto",
    name: "Crypto (CoinGecko)",
    detail: `không cần API key · ${CRYPTO_COIN_IDS.join(", ")}`,
    usesNewsSchedule: false,
  },
  {
    id: "github",
    name: "GitHub Trending",
    detail: "created trong 7 ngày · top 20 · giới hạn 10 req/phút (GitHub Search API, unauthenticated)",
    usesNewsSchedule: false,
  },
];

export const SECRET_LABELS = ["news-api-key", "tavily-api-key"];
