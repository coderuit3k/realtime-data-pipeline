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
    source = article.get("source") or {}
    return {
        # NewsAPI has no stable article id, so the URL is used as one.
        "article_id": article.get("url"),
        "source": "news",
        "provider": source.get("name"),
        "title": article.get("title"),
        "description": article.get("description"),
        "url": article.get("url"),
        "published_at": article.get("publishedAt"),
        "ingested_at": datetime.now(timezone.utc).isoformat(),
    }


def fetch_articles() -> list[dict]:
    api_key = get_secret(config.NEWS_SECRET_NAME)["api_key"]
    params = {
        "q": config.NEWS_QUERY,
        "language": config.NEWS_LANGUAGE,
        "pageSize": config.NEWS_PAGE_SIZE,
        "sortBy": "publishedAt",
    }
    # The key travels in a header, never the query string -- a URL can end up
    # in an exception message or an access/CloudWatch log line, a header value
    # normally doesn't. NewsAPI supports this as a documented alternative to
    # the apiKey query param.
    response = requests.get(NEWS_API_URL, params=params, headers={"X-Api-Key": api_key}, timeout=10)
    response.raise_for_status()
    payload = response.json()
    return [normalize_article(article) for article in payload.get("articles", [])]


def lambda_handler(event, context):
    articles = fetch_articles()
    key = write_records("news", articles, "article_id")
    logger.info("Wrote %d records to %s", len(articles), key)
    return {"statusCode": 200, "records_ingested": len(articles), "s3_key": key}


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    print(lambda_handler({}, None))
