"""Lambda: daily scan for keywords trending on GitHub, Hacker News and the news at once.

Results land in the curated zone as trend_events Parquet.
"""

import logging
import os
import uuid
from datetime import datetime, timezone

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


def build_detection_query(year: str, month: str, day: str) -> str:
    """Build the SQL finding keywords present in all three sources on the given day.

    Fixed, Lambda-authored SQL (no user/LLM input), so sql_guard isn't needed.
    Matches whole keyword tokens via UNNEST(split(...)), not substrings, and
    counts DISTINCT item ids because ingestion re-ingests the same story or
    article across its ~48 runs a day.
    """
    where = f"year='{year}' AND month='{month}' AND day='{day}' AND k <> ''"
    return f"""WITH gh AS (
  SELECT DISTINCT repo_id AS item_id, k AS keyword
  FROM github_repos
  CROSS JOIN UNNEST(split(keywords, ',')) AS t(k)
  WHERE {where}
),
hn AS (
  SELECT DISTINCT story_id AS item_id, k AS keyword
  FROM hackernews_stories
  CROSS JOIN UNNEST(split(keywords, ',')) AS t(k)
  WHERE {where}
),
news AS (
  SELECT DISTINCT article_id AS item_id, k AS keyword
  FROM news_articles
  CROSS JOIN UNNEST(split(keywords, ',')) AS t(k)
  WHERE {where}
)
SELECT
  gh.keyword,
  COUNT(DISTINCT gh.item_id) AS github_count,
  COUNT(DISTINCT hn.item_id) AS hn_count,
  COUNT(DISTINCT news.item_id) AS news_count
FROM gh
JOIN hn ON gh.keyword = hn.keyword
JOIN news ON gh.keyword = news.keyword
GROUP BY gh.keyword
HAVING COUNT(DISTINCT hn.item_id) >= {config.TREND_HN_MIN_STORIES}
   AND COUNT(DISTINCT news.item_id) >= {config.TREND_NEWS_MIN_ARTICLES}
ORDER BY (COUNT(DISTINCT hn.item_id) + COUNT(DISTINCT news.item_id)) DESC
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
    int here -- otherwise the Parquet columns would be written as strings.
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
    sql = build_detection_query(now.strftime("%Y"), now.strftime("%m"), now.strftime("%d"))

    rows, _truncated = athena.run_query(sql, max_rows=config.TREND_MAX_EVENTS_PER_DAY)
    key = write_trend_events(rows, event_date, now)

    logger.info("Detected %d trend event(s) for %s -> %s", len(rows), event_date, key)
    return {"statusCode": 200, "events_detected": len(rows), "s3_key": key}


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    print(lambda_handler({}, None))
