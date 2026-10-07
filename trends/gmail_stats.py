"""Lambda: aggregates the Gmail labels into one privacy-safe JSON file for the web app.

Counts and dates only: no subject, sender, snippet or company ever goes into the output, because
the web app is public. Runs Athena against the Gmail database (ATHENA_DATABASE is set to it).
"""

import json
import logging
from datetime import date, datetime, timedelta, timezone

import boto3

from common import athena, config, email_labels

logger = logging.getLogger()
logger.setLevel(logging.INFO)

STATS_KEY = "gmail_stats/latest.json"
WINDOW_DAYS = 14
# One row per (day, category) at most: 14 days x (5 categories + unclassified), with headroom.
MAX_ROWS = 200

_s3_client = None


def _s3():
    """Created on first use and reused across warm Lambda invocations."""
    global _s3_client
    if _s3_client is None:
        _s3_client = boto3.client("s3", region_name=config.AWS_REGION)
    return _s3_client


def build_stats_query(today: date, window_days: int = WINDOW_DAYS) -> str:
    """SQL counting DISTINCT emails per received day and category over the window.

    Fixed, Lambda-authored SQL. gmail_ingestion re-ingests the newest emails every run, so one
    email sits in many rows: it is collapsed to one row per message_id first. Partitions are by
    ingestion day; an email received in the window was ingested on or after its received day, so
    scanning the same window of partitions covers it.
    """
    start = today - timedelta(days=window_days - 1)
    return f"""WITH per_email AS (
  SELECT message_id,
         max(category) AS category,
         max(urgency) AS urgency,
         bool_or(needs_reply) AS needs_reply,
         max(deadline) AS deadline,
         min(substr(received_at, 1, 10)) AS received_date
  FROM gmail_messages
  WHERE concat(year, month, day) BETWEEN '{start:%Y%m%d}' AND '{today:%Y%m%d}'
  GROUP BY message_id
)
SELECT received_date,
       coalesce(category, 'unclassified') AS category,
       count(*) AS emails,
       count_if(needs_reply) AS needs_reply,
       count_if(urgency = 'high') AS urgent,
       count_if(deadline IS NOT NULL AND deadline <> '' AND deadline >= '{today:%Y-%m-%d}')
         AS with_deadline
FROM per_email
WHERE received_date >= '{start:%Y-%m-%d}'
GROUP BY 1, 2
ORDER BY 1"""


def build_stats(
    rows: list[dict], today: date, now: datetime, window_days: int = WINDOW_DAYS
) -> dict:
    """Fold the query rows into the JSON the web app reads. Only known columns are used."""
    days = [(today - timedelta(days=n)).isoformat() for n in range(window_days - 1, -1, -1)]
    per_day = {day: 0 for day in days}
    by_category = {category: 0 for category in email_labels.CATEGORIES}
    totals = {"emails": 0, "needsReply": 0, "urgent": 0, "withDeadline": 0, "unclassified": 0}

    for row in rows:
        day = row.get("received_date")
        if day not in per_day:
            continue
        category = row.get("category")
        count = int(row.get("emails") or 0)
        if category == "unclassified":
            totals["unclassified"] += count
        elif category in by_category:
            by_category[category] += count
        else:
            continue
        per_day[day] += count
        totals["emails"] += count
        totals["needsReply"] += int(row.get("needs_reply") or 0)
        totals["urgent"] += int(row.get("urgent") or 0)
        totals["withDeadline"] += int(row.get("with_deadline") or 0)

    return {
        "generatedAt": now.isoformat(),
        "windowDays": window_days,
        "totals": totals,
        "byCategory": by_category,
        "perDay": [{"date": day, "total": per_day[day]} for day in days],
    }


def lambda_handler(event, context):
    """Scheduled entry point: rebuild the stats file. A failure keeps the previous file."""
    now = datetime.now(timezone.utc)
    rows, _truncated = athena.run_query(build_stats_query(now.date()), max_rows=MAX_ROWS)
    stats = build_stats(rows, now.date(), now)
    _s3().put_object(
        Bucket=config.CURATED_BUCKET,
        Key=STATS_KEY,
        Body=json.dumps(stats),
        ContentType="application/json",
    )
    logger.info("Wrote Gmail stats for %d email(s) to %s", stats["totals"]["emails"], STATS_KEY)
    return {"statusCode": 200, "emails": stats["totals"]["emails"], "s3_key": STATS_KEY}


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    print(lambda_handler({}, None))
