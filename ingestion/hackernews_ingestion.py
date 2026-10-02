"""Lambda: ingests stories from a Hacker News feed (config.HN_FEED)."""

import logging
from datetime import datetime, timezone

import requests

from common import config
from common.http import make_session, map_concurrently
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
    """Fetch one item; deleted/dead items come back as None."""
    response = session.get(f"{HN_BASE_URL}/item/{item_id}.json", timeout=10)
    response.raise_for_status()
    return response.json()


def fetch_new_stories(limit: int) -> list[dict]:
    """Fetch the feed's first `limit` ids, then each item concurrently (one request per id)."""
    session = make_session(config.INGESTION_FETCH_WORKERS)
    response = session.get(f"{HN_BASE_URL}/{config.HN_FEED}.json", timeout=10)
    response.raise_for_status()
    story_ids = response.json()[:limit]

    items = map_concurrently(
        lambda story_id: fetch_item(session, story_id), story_ids, config.INGESTION_FETCH_WORKERS
    )
    # Feeds also carry deleted/dead items (None) and job/comment/poll entries;
    # only "story" items match the schema.
    return [normalize_story(item) for item in items if item and item.get("type") == "story"]


def lambda_handler(event, context):
    """Scheduled entry point: fetch stories and write them to the raw zone."""
    stories = fetch_new_stories(config.HN_STORY_LIMIT)
    key = write_records("hackernews", stories, "story_id")
    logger.info("Wrote %d records to %s", len(stories), key)
    return {"statusCode": 200, "records_ingested": len(stories), "s3_key": key}


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    print(lambda_handler({}, None))
