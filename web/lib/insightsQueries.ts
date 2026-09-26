import { partitionPredicateAny, type TodayParts } from "./athena";

export function buildTopKeywordsQuery(partsList: TodayParts[]): string {
  const hnWhere = partitionPredicateAny(partsList);
  const newsWhere = partitionPredicateAny(partsList);
  return `SELECT k AS keyword, COUNT(*) AS mentions
FROM (
  SELECT keywords FROM hackernews_stories WHERE ${hnWhere}
  UNION ALL
  SELECT keywords FROM news_articles WHERE ${newsWhere}
) combined
CROSS JOIN UNNEST(split(keywords, ',')) AS t(k)
WHERE k <> ''
GROUP BY k
ORDER BY mentions DESC
LIMIT 6`;
}

export function buildCryptoMentionsQuery(partsList: TodayParts[]): string {
  const cryptoWhere = partitionPredicateAny(partsList, "c");
  const hnWhere = partitionPredicateAny(partsList);
  const newsWhere = partitionPredicateAny(partsList);
  return `SELECT coin_id, price_usd, change_24h_pct, mention_count
FROM (
  SELECT
    c.coin_id, c.price_usd, c.change_24h_pct,
    ROW_NUMBER() OVER (PARTITION BY c.coin_id ORDER BY c.observed_at DESC) AS rn,
    (SELECT COUNT(*) FROM (
       SELECT keywords FROM hackernews_stories WHERE ${hnWhere}
       UNION ALL
       SELECT keywords FROM news_articles WHERE ${newsWhere}
     ) m WHERE POSITION(c.coin_id IN m.keywords) > 0) AS mention_count
  FROM crypto_prices c
  WHERE ${cryptoWhere}
) ranked
WHERE rn = 1
ORDER BY coin_id`;
}

export function buildGithubHnOverlapQuery(partsList: TodayParts[]): string {
  const githubWhere = partitionPredicateAny(partsList, "g");
  const hnWhere = partitionPredicateAny(partsList, "h");
  return `SELECT gk AS keyword, COUNT(DISTINCT g.full_name) AS overlap_count
FROM github_repos g
CROSS JOIN UNNEST(split(g.keywords, ',')) AS t(gk)
JOIN hackernews_stories h
  ON gk <> '' AND POSITION(gk IN h.keywords) > 0
WHERE (${githubWhere})
  AND (${hnWhere})
GROUP BY gk
ORDER BY overlap_count DESC
LIMIT 6`;
}

export function buildGithubLanguagesQuery(partsList: TodayParts[]): string {
  const where = partitionPredicateAny(partsList);
  return `SELECT language, COUNT(*) AS repo_count
FROM github_repos
WHERE (${where}) AND language <> ''
GROUP BY language
ORDER BY repo_count DESC
LIMIT 6`;
}

export function buildHnSpotlightQuery(partsList: TodayParts[]): string {
  const where = partitionPredicateAny(partsList);
  return `SELECT title, score, num_comments, author, COALESCE(NULLIF(url, ''), permalink) AS link
FROM hackernews_stories
WHERE ${where}
ORDER BY score DESC
LIMIT 1`;
}

export function buildWeatherSnapshotQuery(parts: TodayParts): string {
  const where = partitionPredicateAny([parts]);
  return `SELECT location, temperature_c, humidity_pct
FROM (
  SELECT location, temperature_c, humidity_pct,
         ROW_NUMBER() OVER (PARTITION BY location ORDER BY observed_at DESC) AS rn
  FROM weather_observations
  WHERE ${where}
) ranked
WHERE rn = 1
ORDER BY location`;
}
