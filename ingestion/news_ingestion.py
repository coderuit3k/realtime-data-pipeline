"""Lambda: ingests articles matching config.NEWS_QUERY from NewsAPI."""

import logging
from datetime import datetime, timezone

import requests

from common import config
from common.s3_writer import write_records
from common.secrets import get_secret

logger = logging.getLogger()
logger.setLevel(logging.INFO)

NEWS_API_URL = "https://newsapi.org/v2/everything"


def normalize_article(article: dict) -> dict:
    """Map a NewsAPI article to the raw news record."""
    source = article.get("source") or {}
    return {
        # NewsAPI has no article id; the URL is the stable identifier.
        "article_id": article.get("url"),
        "source": "news",
        "provider": source.get("name"),
        "title": article.get("title"),
        "description": article.get("description"),
        "url": article.get("url"),
        "published_at": article.get("publishedAt"),
        "image_url": article.get("urlToImage") or "",
        "ingested_at": datetime.now(timezone.utc).isoformat(),
    }


def fetch_articles() -> list[dict]:
    """Newest-first page of articles: one call per run (free tier allows 100/day)."""
    api_key = get_secret(config.NEWS_SECRET_NAME)["api_key"]
    params = {
        "q": config.NEWS_QUERY,
        "language": config.NEWS_LANGUAGE,
        "pageSize": config.NEWS_PAGE_SIZE,
        "sortBy": "publishedAt",
    }
    # Send the key as a header, never in the query string: URLs end up in
    # exception messages and CloudWatch logs, headers normally don't.
    response = requests.get(NEWS_API_URL, params=params, headers={"X-Api-Key": api_key}, timeout=10)
    response.raise_for_status()
    payload = response.json()
    return [normalize_article(article) for article in payload.get("articles", [])]


def lambda_handler(event, context):
    """Scheduled entry point: fetch articles and write them to the raw zone."""
    articles = fetch_articles()
    key = write_records("news", articles, "article_id")
    logger.info("Wrote %d records to %s", len(articles), key)
    return {"statusCode": 200, "records_ingested": len(articles), "s3_key": key}


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    print(lambda_handler({}, None))
