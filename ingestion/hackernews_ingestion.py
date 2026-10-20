"""Lambda: ingests stories from a Hacker News feed (config.HN_FEED)."""

import logging
from datetime import datetime, timezone

import requests

from common import config
from common.http import get_with_retry, make_session, map_concurrently
from common.s3_writer import write_records

logger = logging.getLogger()
logger.setLevel(logging.INFO)

HN_BASE_URL = "https://hacker-news.firebaseio.com/v0"


def normalize_story(item: dict) -> dict:
    """Map an HN item to the raw hackernews record; self-posts have text but no url."""
    return {
        "story_id": str(item["id"]),
        "source": "hackernews",
        "title": item.get("title", ""),
        "text": item.get("text", "") or "",
        "author": item.get("by"),
        "score": item.get("score", 0),
        "num_comments": item.get("descendants", 0),
        "url": item.get("url") or "",
        "permalink": f"https://news.ycombinator.com/item?id={item['id']}",
        "created_at": datetime.fromtimestamp(item["time"], tz=timezone.utc).isoformat(),
        "ingested_at": datetime.now(timezone.utc).isoformat(),
    }


def fetch_item(session: requests.Session, item_id: int) -> dict | None:
    """Fetch one item; deleted/dead items come back as None.

    Transient failures (429/5xx, timeouts, dropped connections) are retried
    via get_with_retry; a persistent failure still raises and is isolated
    per-item by the caller.
    """
    response = get_with_retry(
        session, f"{HN_BASE_URL}/item/{item_id}.json", params=None, timeout=10
    )
    response.raise_for_status()
    return response.json()


def _fetch_item_safe(
    session: requests.Session, item_id: int
) -> tuple[int, dict | None, Exception | None]:
    """Fetch one item without ever raising; returns (item_id, item, error)."""
    try:
        return item_id, fetch_item(session, item_id), None
    except Exception as exc:
        return item_id, None, exc


def fetch_new_stories(limit: int) -> tuple[list[dict], list[int]]:
    """Fetch the feed's first `limit` ids, then each item concurrently.

    One bad item must not kill the batch: per-item failures are skipped (and
    reported) while the rest of the batch is still ingested. Only raises when
    *every* item fetch failed -- that means the HN API itself is down, and
    writing an empty file would silently look like a quiet day.

    Returns (stories, failed_item_ids), keeping the feed's order.
    """
    session = make_session(config.INGESTION_FETCH_WORKERS)
    response = get_with_retry(
        session, f"{HN_BASE_URL}/{config.HN_FEED}.json", params=None, timeout=10
    )
    response.raise_for_status()
    story_ids = response.json()[:limit]

    results = map_concurrently(
        lambda story_id: _fetch_item_safe(session, story_id),
        story_ids,
        config.INGESTION_FETCH_WORKERS,
    )
    failed_ids = [item_id for item_id, _item, exc in results if exc is not None]
    stories = [
        normalize_story(item)
        for _item_id, item, exc in results
        if exc is None and item and item.get("type") == "story"
    ]

    if not stories and failed_ids:
        first_exc = next(exc for _i, _it, exc in results if exc is not None)
        raise RuntimeError(
            f"All {len(failed_ids)} HN item fetch(es) failed; "
            "refusing to write an empty batch"
        ) from first_exc
    if failed_ids:
        logger.warning("Skipped %d failed HN item(s): %s", len(failed_ids), failed_ids)
    return stories, failed_ids


def lambda_handler(event, context):
    """Scheduled entry point: fetch stories and write them to the raw zone."""
    stories, failed_ids = fetch_new_stories(config.HN_STORY_LIMIT)
    key = write_records("hackernews", stories, "story_id")
    logger.info(
        "Wrote %d records to %s (%d item(s) skipped)", len(stories), key, len(failed_ids)
    )
    return {
        "statusCode": 200,
        "records_ingested": len(stories),
        "failed_items": failed_ids,
        "s3_key": key,
    }


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    print(lambda_handler({}, None))
