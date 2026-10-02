import { partitionPredicateAny, type TodayParts } from "./athena";

// Insights SQL builders. Each takes the day partitions to cover (today or the
// last 7 days) so Athena prunes partitions instead of scanning whole tables.
// Tables are append-only snapshots, so "latest" queries dedupe with
// ROW_NUMBER() per entity rather than reading every snapshot.

/** Top 6 keywords across HN and news combined. */
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

/** Latest price per coin plus how many HN/news keyword lists mention it (substring match). */
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

/** Top 6 GitHub repo keywords that also appear in HN stories, by number of distinct repos. */
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

/** Top 6 languages by repo snapshot count (repos with no language excluded). */
export function buildGithubLanguagesQuery(partsList: TodayParts[]): string {
  const where = partitionPredicateAny(partsList);
  return `SELECT language, COUNT(*) AS repo_count
FROM github_repos
WHERE (${where}) AND language <> ''
GROUP BY language
ORDER BY repo_count DESC
LIMIT 6`;
}

/** Highest-scoring HN story; falls back to the HN permalink for text posts with no URL. */
export function buildHnSpotlightQuery(partsList: TodayParts[]): string {
  const where = partitionPredicateAny(partsList);
  return `SELECT title, score, num_comments, author, COALESCE(NULLIF(url, ''), permalink) AS link
FROM hackernews_stories
WHERE ${where}
ORDER BY score DESC
LIMIT 1`;
}

/** Top 6 repos by stars, using each repo's latest snapshot. */
export function buildGithubStarsQuery(partsList: TodayParts[]): string {
  const where = partitionPredicateAny(partsList);
  return `SELECT full_name, stars, forks, language, avatar_url
FROM (
  SELECT full_name, stars, forks, language, avatar_url,
         ROW_NUMBER() OVER (PARTITION BY repo_id ORDER BY ingested_at DESC) AS rn
  FROM github_repos
  WHERE ${where}
) ranked
WHERE rn = 1
ORDER BY stars DESC
LIMIT 6`;
}

/** Coins by market cap, using each coin's latest observation. */
export function buildCryptoRankingQuery(partsList: TodayParts[]): string {
  const where = partitionPredicateAny(partsList);
  return `SELECT coin_id, market_cap_usd, volume_24h_usd
FROM (
  SELECT coin_id, market_cap_usd, volume_24h_usd,
         ROW_NUMBER() OVER (PARTITION BY coin_id ORDER BY observed_at DESC) AS rn
  FROM crypto_prices
  WHERE ${where}
) ranked
WHERE rn = 1
ORDER BY market_cap_usd DESC`;
}

/**
 * HN story with the highest comments-to-score ratio. The score >= 10 floor stops
 * tiny stories (score 1, 3 comments -> 3.0) from outranking real discussions.
 */
export function buildHnControversialQuery(partsList: TodayParts[]): string {
  const where = partitionPredicateAny(partsList);
  return `SELECT title, score, num_comments, author, COALESCE(NULLIF(url, ''), permalink) AS link
FROM hackernews_stories
WHERE (${where}) AND score >= 10
ORDER BY CAST(num_comments AS DOUBLE) / score DESC
LIMIT 1`;
}

/** Latest reading per location; takes a single day because it is always "now", whatever the range. */
export function buildWeatherSnapshotQuery(parts: TodayParts): string {
  const where = partitionPredicateAny([parts]);
  return `SELECT location, temperature_c, humidity_pct, weather_code
FROM (
  SELECT location, temperature_c, humidity_pct, weather_code,
         ROW_NUMBER() OVER (PARTITION BY location ORDER BY observed_at DESC) AS rn
  FROM weather_observations
  WHERE ${where}
) ranked
WHERE rn = 1
ORDER BY location`;
}

/** Newest article that has an image, for the visual spotlight card. */
export function buildNewsSpotlightQuery(partsList: TodayParts[]): string {
  const where = partitionPredicateAny(partsList);
  return `SELECT title, provider, url, image_url, published_at
FROM news_articles
WHERE (${where}) AND image_url <> ''
ORDER BY published_at DESC
LIMIT 1`;
}
