import { buildSourceVolumeQuery, partitionWhere, type TodayParts } from "./athena";
import type { SampleQueryGroup } from "./types";

export function buildSampleQueryGroups(parts: TodayParts): SampleQueryGroup[] {
  const { year, month, day } = parts;
  const where = partitionWhere(parts);

  return [
    {
      label: "Tương quan",
      queries: [
        {
          id: "crypto-mentions",
          label: "Crypto mentions ↔ giá",
          sql: `SELECT c.coin_id, c.price_usd, c.change_24h_pct,
       (SELECT COUNT(*) FROM (
          SELECT keywords FROM news_articles WHERE year='${year}' AND month='${month}' AND day='${day}'
          UNION ALL
          SELECT keywords FROM hackernews_stories WHERE year='${year}' AND month='${month}' AND day='${day}'
        ) mentions WHERE POSITION(c.coin_id IN mentions.keywords) > 0) AS mention_count
FROM crypto_prices c
WHERE c.year='${year}' AND c.month='${month}' AND c.day='${day}'
ORDER BY c.observed_at DESC`,
        },
        {
          id: "github-hn-overlap",
          label: "GitHub ↔ HN keyword overlap",
          sql: `SELECT DISTINCT g.full_name, g.language, h.title, h.score
FROM github_repos g
CROSS JOIN UNNEST(split(g.keywords, ',')) AS t(gk)
JOIN hackernews_stories h
  ON gk <> '' AND POSITION(gk IN h.keywords) > 0
WHERE g.year='${year}' AND g.month='${month}' AND g.day='${day}'
  AND h.year='${year}' AND h.month='${month}' AND h.day='${day}'
LIMIT 20`,
        },
      ],
    },
    {
      label: "Xu hướng từ khoá",
      queries: [
        {
          id: "top-keywords-hn",
          label: "Top từ khoá HN hôm nay",
          sql: `SELECT k AS keyword, COUNT(*) AS mentions
FROM hackernews_stories
CROSS JOIN UNNEST(split(keywords, ',')) AS t(k)
${where} AND k <> ''
GROUP BY k
ORDER BY mentions DESC
LIMIT 10`,
        },
        {
          id: "top-keywords-news",
          label: "Top từ khoá News hôm nay",
          sql: `SELECT k AS keyword, COUNT(*) AS mentions
FROM news_articles
CROSS JOIN UNNEST(split(keywords, ',')) AS t(k)
${where} AND k <> ''
GROUP BY k
ORDER BY mentions DESC
LIMIT 10`,
        },
      ],
    },
    {
      label: "Khối lượng & mới nhất",
      queries: [
        {
          id: "volume-by-source",
          label: "Volume theo nguồn/ngày",
          sql: buildSourceVolumeQuery(parts),
        },
        {
          id: "latest-weather",
          label: "Weather mới nhất theo khu vực",
          sql: `SELECT location, temperature_c, humidity_pct, wind_speed_kmh, observed_at
FROM weather_observations
${where}
ORDER BY observed_at DESC
LIMIT 20`,
        },
        {
          id: "trending-repos",
          label: "Trending repos hôm nay",
          sql: `SELECT full_name, language, stars, forks, pushed_at
FROM github_repos
${where}
ORDER BY stars DESC
LIMIT 20`,
        },
      ],
    },
    {
      label: "Xếp hạng",
      queries: [
        {
          id: "hn-authors-by-score",
          label: "Tác giả HN theo tổng điểm",
          sql: `SELECT author, COUNT(*) AS stories, SUM(score) AS total_score
FROM hackernews_stories
${where}
GROUP BY author
ORDER BY total_score DESC
LIMIT 10`,
        },
        {
          id: "github-stars-ranking",
          label: "Repo GitHub nhiều sao nhất",
          sql: `SELECT full_name, stars, forks, language
FROM (
  SELECT full_name, stars, forks, language,
         ROW_NUMBER() OVER (PARTITION BY repo_id ORDER BY ingested_at DESC) AS rn
  FROM github_repos
  ${where}
) ranked
WHERE rn = 1
ORDER BY stars DESC
LIMIT 20`,
        },
        {
          id: "crypto-market-cap-ranking",
          label: "Crypto: vốn hoá & khối lượng",
          sql: `SELECT coin_id, market_cap_usd, volume_24h_usd
FROM (
  SELECT coin_id, market_cap_usd, volume_24h_usd,
         ROW_NUMBER() OVER (PARTITION BY coin_id ORDER BY observed_at DESC) AS rn
  FROM crypto_prices
  ${where}
) ranked
WHERE rn = 1
ORDER BY market_cap_usd DESC`,
        },
        {
          id: "hn-most-controversial",
          label: "Story HN gây tranh cãi nhất",
          sql: `SELECT title, score, num_comments, author,
  CAST(num_comments AS DOUBLE) / score AS comments_per_score
FROM hackernews_stories
${where} AND score >= 10
ORDER BY comments_per_score DESC
LIMIT 10`,
        },
      ],
    },
  ];
}
