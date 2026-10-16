"""Lambda: daily scan for keywords bursting across GitHub, Hacker News and the news.

A keyword counts as trending when it appears in all three sources *today* and
today's mention count far exceeds its trailing baseline (burst detection), so
perennially popular keywords like "ai" don't win every single day. Results
land in the curated zone as trend_events Parquet.
"""

import logging
import os
import uuid
from datetime import datetime, timedelta, timezone

import boto3
import pandas as pd

from common import athena, config

logger = logging.getLogger()
logger.setLevel(logging.INFO)

_s3_client = None


def _s3():
    """Created on first use and reused across warm Lambda invocations."""
    global _s3_client
    if _s3_client is None:
        _s3_client = boto3.client("s3", region_name=config.AWS_REGION)
    return _s3_client


def _window_predicate(dates: list[datetime]) -> str:
    """OR of day-partition predicates covering every date in the window."""
    ors = " OR ".join(f"(year='{d:%Y}' AND month='{d:%m}' AND day='{d:%d}')" for d in dates)
    return f"({ors})"


def build_detection_query(target: datetime) -> str:
    """Build the SQL finding keywords bursting in all three sources on `target`.

    Window: the target day plus TREND_BASELINE_DAYS preceding days. Each
    source contributes per-(keyword, day) mention counts; a keyword qualifies
    when it appears in all three sources *today*, ranked by burst ratio:

        burst_ratio = today_total / (baseline_total + 1)

    The +1 is Laplace smoothing: brand-new keywords (zero baseline) score by
    raw today volume instead of dividing by zero, while perennial keywords
    ("ai") score near 1 and sink below real bursts. Fixed, Lambda-authored SQL
    (no user/LLM input), so sql_guard isn't needed. Matches whole keyword
    tokens via UNNEST(split(...)), not substrings, and counts DISTINCT item
    ids because ingestion re-ingests the same story or article ~48 times a day.
    """
    dates = [target - timedelta(days=i) for i in range(config.TREND_BASELINE_DAYS, -1, -1)]
    window = _window_predicate(dates)
    today = f"year='{target:%Y}' AND month='{target:%m}' AND day='{target:%d}'"
    return f"""WITH daily AS (
  SELECT k AS keyword, 'gh' AS src, year, month, day, COUNT(DISTINCT repo_id) AS n
  FROM github_repos
  CROSS JOIN UNNEST(split(keywords, ',')) AS t(k)
  WHERE {window} AND k <> ''
  GROUP BY k, year, month, day
  UNION ALL
  SELECT k AS keyword, 'hn' AS src, year, month, day, COUNT(DISTINCT story_id) AS n
  FROM hackernews_stories
  CROSS JOIN UNNEST(split(keywords, ',')) AS t(k)
  WHERE {window} AND k <> ''
  GROUP BY k, year, month, day
  UNION ALL
  SELECT k AS keyword, 'news' AS src, year, month, day, COUNT(DISTINCT article_id) AS n
  FROM news_articles
  CROSS JOIN UNNEST(split(keywords, ',')) AS t(k)
  WHERE {window} AND k <> ''
  GROUP BY k, year, month, day
),
scored AS (
  SELECT keyword, src,
    SUM(CASE WHEN {today} THEN n ELSE 0 END) AS today_n,
    SUM(CASE WHEN NOT ({today}) THEN n ELSE 0 END) AS baseline_n
  FROM daily
  GROUP BY keyword, src
)
SELECT keyword,
  SUM(today_n) AS today_total,
  SUM(baseline_n) AS baseline_total,
  SUM(today_n) / (SUM(baseline_n) + 1.0) AS burst_ratio,
  SUM(CASE WHEN src = 'gh' THEN today_n ELSE 0 END) AS github_count,
  SUM(CASE WHEN src = 'hn' THEN today_n ELSE 0 END) AS hn_count,
  SUM(CASE WHEN src = 'news' THEN today_n ELSE 0 END) AS news_count
FROM scored
GROUP BY keyword
HAVING COUNT(CASE WHEN today_n > 0 THEN 1 END) = 3
   AND SUM(CASE WHEN src = 'hn' THEN today_n ELSE 0 END) >= {config.TREND_HN_MIN_STORIES}
   AND SUM(CASE WHEN src = 'news' THEN today_n ELSE 0 END) >= {config.TREND_NEWS_MIN_ARTICLES}
ORDER BY burst_ratio DESC
LIMIT {config.TREND_MAX_EVENTS_PER_DAY}"""


def build_curated_key(ts: datetime) -> str:
    """Day-partitioned key; the random suffix keeps same-second writes apart."""
    return (
        f"source=trend_events/year={ts:%Y}/month={ts:%m}/day={ts:%d}/"
        f"{ts:%Y%m%dT%H%M%S}-{uuid.uuid4().hex[:8]}.parquet"
    )


def write_trend_events(rows: list[dict], event_date: str, now: datetime | None = None) -> str:
    """Write detected events as one Parquet file and return its key ("" if none).

    GetQueryResults returns every cell as a string, so the counts are cast to
    int (and burst_ratio to float) here -- otherwise the Parquet columns would
    be written as strings.
    """
    if not rows:
        return ""

    now = now or datetime.now(timezone.utc)
    records = [
        {
            "event_id": f"{row['keyword']}-{event_date}",
            "keyword": row["keyword"],
            "event_date": event_date,
            "github_count": int(row["github_count"]),
            "hn_count": int(row["hn_count"]),
            "news_count": int(row["news_count"]),
            "today_total": int(row["today_total"]),
            "baseline_total": int(row["baseline_total"]),
            "burst_ratio": float(row["burst_ratio"]),
            "detected_at": now.isoformat(),
        }
        for row in rows
    ]
    df = pd.DataFrame(records)

    key = build_curated_key(now)
    local_path = f"/tmp/{uuid.uuid4().hex}.parquet"
    df.to_parquet(local_path, engine="pyarrow", index=False)

    try:
        if config.DRY_RUN or not config.CURATED_BUCKET:
            dest = os.path.join("local_output_curated", key)
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            os.replace(local_path, dest)
            return key

        _s3().upload_file(local_path, config.CURATED_BUCKET, key)
        return key
    finally:
        if os.path.exists(local_path):
            os.remove(local_path)


def lambda_handler(event, context):
    """Daily entry point: detect today's (UTC) trend events and write them."""
    now = datetime.now(timezone.utc)
    event_date = now.strftime("%Y-%m-%d")
    sql = build_detection_query(now)

    rows, _truncated = athena.run_query(sql, max_rows=config.TREND_MAX_EVENTS_PER_DAY)
    key = write_trend_events(rows, event_date, now)

    logger.info("Detected %d trend event(s) for %s -> %s", len(rows), event_date, key)
    return {"statusCode": 200, "events_detected": len(rows), "s3_key": key}


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    print(lambda_handler({}, None))
