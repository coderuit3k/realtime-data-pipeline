-- Sample Athena queries against the curated zone.
-- Run in the Athena console (workgroup "<project>-analytics", database
-- "<project>_curated"), or one query at a time via the CLI, e.g.:
--   aws athena start-query-execution \
--     --work-group "realtime-data-pipeline-dev-analytics" \
--     --query-execution-context Database=realtime_data_pipeline_dev_curated \
--     --query-string "SELECT keywords, COUNT(*) AS mentions FROM hackernews_stories GROUP BY keywords ORDER BY mentions DESC LIMIT 20"

-- 1. Top Hacker News keywords today
SELECT keywords, COUNT(*) AS mentions
FROM hackernews_stories
WHERE year = '2026' AND month = '09' AND day = '18'
GROUP BY keywords
ORDER BY mentions DESC
LIMIT 20;

-- 2. Top News API keywords today
SELECT keywords, COUNT(*) AS mentions
FROM news_articles
WHERE year = '2026' AND month = '09' AND day = '18'
GROUP BY keywords
ORDER BY mentions DESC
LIMIT 20;

-- 3. Hacker News stories with the most discussion (by comment count)
SELECT title, score, num_comments, url, created_at
FROM hackernews_stories
WHERE year = '2026' AND month = '09'
ORDER BY num_comments DESC
LIMIT 10;

-- 4. Correlate social buzz vs. real news: individual keywords appearing in
-- BOTH Hacker News stories and News API articles on the same day (keywords
-- is a comma-joined top-5 list per record, so split + UNNEST to compare
-- at the individual-keyword level rather than the whole list).
WITH hn_kw AS (
    SELECT story_id, TRIM(kw) AS keyword
    FROM hackernews_stories
    CROSS JOIN UNNEST(split(keywords, ',')) AS t(kw)
    WHERE year = '2026' AND month = '09' AND day = '18'
),
news_kw AS (
    SELECT article_id, TRIM(kw) AS keyword
    FROM news_articles
    CROSS JOIN UNNEST(split(keywords, ',')) AS t(kw)
    WHERE year = '2026' AND month = '09' AND day = '18'
)
SELECT
    hn_kw.keyword,
    COUNT(DISTINCT hn_kw.story_id) AS hn_mentions,
    COUNT(DISTINCT news_kw.article_id) AS news_mentions
FROM hn_kw
JOIN news_kw ON hn_kw.keyword = news_kw.keyword
GROUP BY hn_kw.keyword
ORDER BY hn_mentions + news_mentions DESC
LIMIT 20;

-- 5. Daily volume per source (useful for a monitoring dashboard)
SELECT 'hackernews' AS source, year, month, day, COUNT(*) AS records
FROM hackernews_stories
GROUP BY year, month, day
UNION ALL
SELECT 'news' AS source, year, month, day, COUNT(*) AS records
FROM news_articles
GROUP BY year, month, day
UNION ALL
SELECT 'weather' AS source, year, month, day, COUNT(*) AS records
FROM weather_observations
GROUP BY year, month, day
UNION ALL
SELECT 'crypto' AS source, year, month, day, COUNT(*) AS records
FROM crypto_prices
GROUP BY year, month, day
UNION ALL
SELECT 'github' AS source, year, month, day, COUNT(*) AS records
FROM github_repos
GROUP BY year, month, day
ORDER BY year, month, day;

-- 6. Latest weather reading per tracked location
SELECT location, temperature_c, humidity_pct, precipitation_mm, wind_speed_kmh, observed_at
FROM weather_observations
WHERE year = '2026' AND month = '09' AND day = '19'
ORDER BY observed_at DESC
LIMIT 20;

-- 7. Latest price per tracked coin
SELECT coin_id, price_usd, change_24h_pct, market_cap_usd, observed_at
FROM crypto_prices
WHERE year = '2026' AND month = '09' AND day = '19'
ORDER BY observed_at DESC
LIMIT 20;

-- 8. Correlate crypto mentions (HN + News keywords) against that coin's
-- same-day price change -- the actual point of adding crypto as a source:
-- does social/news buzz about a coin line up with it actually moving?
WITH mentions AS (
    SELECT TRIM(kw) AS keyword, COUNT(*) AS mention_count
    FROM (
        SELECT keywords FROM hackernews_stories
        WHERE year = '2026' AND month = '09' AND day = '19'
        UNION ALL
        SELECT keywords FROM news_articles
        WHERE year = '2026' AND month = '09' AND day = '19'
    )
    CROSS JOIN UNNEST(split(keywords, ',')) AS t(kw)
    GROUP BY TRIM(kw)
)
SELECT c.coin_id, c.price_usd, c.change_24h_pct, COALESCE(m.mention_count, 0) AS mention_count
FROM crypto_prices c
LEFT JOIN mentions m ON m.keyword = c.coin_id
WHERE c.year = '2026' AND c.month = '09' AND c.day = '19'
ORDER BY c.observed_at DESC;

-- 9. Top trending GitHub repos today (proxy: created in the last N days,
-- sorted by stars -- see github_trending_ingestion.py for why there's no
-- official "trending" API to call instead)
SELECT full_name, language, stars, forks, keywords, pushed_at
FROM github_repos
WHERE year = '2026' AND month = '09' AND day = '19'
ORDER BY stars DESC
LIMIT 20;

-- 10. Individual keywords appearing in BOTH trending GitHub repos and
-- Hacker News stories on the same day -- is what's trending on GitHub also
-- what HN is discussing?
WITH gh_kw AS (
    SELECT repo_id, TRIM(kw) AS keyword
    FROM github_repos
    CROSS JOIN UNNEST(split(keywords, ',')) AS t(kw)
    WHERE year = '2026' AND month = '09' AND day = '19'
),
hn_kw AS (
    SELECT story_id, TRIM(kw) AS keyword
    FROM hackernews_stories
    CROSS JOIN UNNEST(split(keywords, ',')) AS t(kw)
    WHERE year = '2026' AND month = '09' AND day = '19'
)
SELECT
    gh_kw.keyword,
    COUNT(DISTINCT gh_kw.repo_id) AS github_mentions,
    COUNT(DISTINCT hn_kw.story_id) AS hn_mentions
FROM gh_kw
JOIN hn_kw ON gh_kw.keyword = hn_kw.keyword
GROUP BY gh_kw.keyword
ORDER BY github_mentions + hn_mentions DESC
LIMIT 20;
