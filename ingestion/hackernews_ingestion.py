import logging
from datetime import datetime, timezone

import requests

from common import config
from common.s3_writer import write_records

logger = logging.getLogger()
logger.setLevel(logging.INFO)

HN_BASE_URL = "https://hacker-news.firebaseio.com/v0"


def normalize_story(item: dict) -> dict:
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


def fetch_item(item_id: int) -> dict | None:
    response = requests.get(f"{HN_BASE_URL}/item/{item_id}.json", timeout=10)
    response.raise_for_status()
    return response.json()


def fetch_new_stories(limit: int) -> list[dict]:
    response = requests.get(f"{HN_BASE_URL}/{config.HN_FEED}.json", timeout=10)
    response.raise_for_status()
    story_ids = response.json()[:limit]

    stories = []
    for story_id in story_ids:
        item = fetch_item(story_id)
        # Deleted/dead items come back as None; "job"/"comment"/"poll" show up
        # in some feeds too -- only "story" items match our schema.
        if item and item.get("type") == "story":
            stories.append(normalize_story(item))
    return stories


def lambda_handler(event, context):
    stories = fetch_new_stories(config.HN_STORY_LIMIT)
    key = write_records("hackernews", stories, "story_id")
    logger.info("Wrote %d records to %s", len(stories), key)
    return {"statusCode": 200, "records_ingested": len(stories), "s3_key": key}


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    print(lambda_handler({}, None))
