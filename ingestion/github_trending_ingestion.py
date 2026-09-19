import logging
from datetime import datetime, timedelta, timezone

import requests

from common import config
from common.s3_writer import write_records

logger = logging.getLogger()
logger.setLevel(logging.INFO)

GITHUB_SEARCH_URL = "https://api.github.com/search/repositories"
# GitHub rejects requests with no User-Agent header (403), even unauthenticated ones.
HEADERS = {"User-Agent": "realtime-data-pipeline", "Accept": "application/vnd.github+json"}


def normalize_repo(item: dict) -> dict:
    return {
        "repo_id": str(item.get("id")),
        "source": "github",
        "full_name": item.get("full_name") or "",
        "description": item.get("description") or "",
        "url": item.get("html_url") or "",
        "language": item.get("language") or "",
        "stars": item.get("stargazers_count"),
        "forks": item.get("forks_count"),
        "created_at": item.get("created_at"),
        "pushed_at": item.get("pushed_at"),
        "ingested_at": datetime.now(timezone.utc).isoformat(),
    }


def fetch_trending() -> list[dict]:
    since = datetime.now(timezone.utc) - timedelta(days=config.GITHUB_TRENDING_DAYS)
    cutoff = since.strftime("%Y-%m-%d")
    params = {
        "q": f"created:>{cutoff}",
        "sort": "stars",
        "order": "desc",
        "per_page": config.GITHUB_TRENDING_LIMIT,
    }
    response = requests.get(GITHUB_SEARCH_URL, params=params, headers=HEADERS, timeout=10)
    response.raise_for_status()
    return [normalize_repo(item) for item in response.json().get("items", [])]


def lambda_handler(event, context):
    repos = fetch_trending()
    key = write_records("github", repos)
    logger.info("Wrote %d records to %s", len(repos), key)
    return {"statusCode": 200, "records_ingested": len(repos), "s3_key": key}


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    print(lambda_handler({}, None))
