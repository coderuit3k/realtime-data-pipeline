import { WEATHER_LOCATION_NAMES } from "./weatherMeta";

export type DataSourceMeta = {
  id: string;
  name: string;
  detail: string;
  usesNewsSchedule: boolean;
};

// Mirrors of Python config with no runtime cross-check: keep in sync with
// common/config.py by hand.
const CRYPTO_COIN_IDS = ["bitcoin", "ethereum", "solana"];

// Display metadata for the 5 UI-facing ingestion sources. Details come from
// common/config.py (NEWS_QUERY, GITHUB_TRENDING_DAYS=7, GITHUB_TRENDING_LIMIT=20);
// the 10 req/min figure is GitHub's documented unauthenticated Search API limit.
// `usesNewsSchedule` marks sources driven by the separate news EventBridge rule.
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

// Display names only; order must match SECRET_ENV_NAMES in app/api/settings/route.ts.
export const SECRET_LABELS = ["news-api-key", "tavily-api-key", "qdrant-cloud", "jina-api-key"];
