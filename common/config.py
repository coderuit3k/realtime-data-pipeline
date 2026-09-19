import os

AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")
RAW_BUCKET = os.environ.get("RAW_BUCKET", "")
CURATED_BUCKET = os.environ.get("CURATED_BUCKET", "")

NEWS_SECRET_NAME = os.environ.get("NEWS_SECRET_NAME", "data-pipeline/news-api")

# Hacker News' API is public and needs no key/auth.
HN_FEED = os.environ.get("HN_FEED", "newstories")  # or "topstories", "beststories"
HN_STORY_LIMIT = int(os.environ.get("HN_STORY_LIMIT", "50"))

NEWS_QUERY = os.environ.get("NEWS_QUERY", "cryptocurrency OR technology")
NEWS_PAGE_SIZE = int(os.environ.get("NEWS_PAGE_SIZE", "50"))
NEWS_LANGUAGE = os.environ.get("NEWS_LANGUAGE", "en")

# Open-Meteo needs no API key -- fixed list of locations tracked, not
# env-configurable (a list of dicts doesn't map cleanly to a single env var).
WEATHER_LOCATIONS = [
    {"name": "Ho Chi Minh City", "latitude": 10.7769, "longitude": 106.7009},
    {"name": "Vung Tau", "latitude": 10.4114, "longitude": 107.1362},
    {"name": "Bien Hoa (Dong Nai)", "latitude": 10.9574, "longitude": 106.8426},
    {"name": "Da Lat", "latitude": 11.9404, "longitude": 108.4583},
]

# CoinGecko's public /simple/price endpoint needs no API key. These are the
# coin ids it expects (its own naming, not ticker symbols) -- picked for
# overlap with what NEWS_QUERY and Hacker News discussions actually mention.
CRYPTO_COIN_IDS = ["bitcoin", "ethereum", "solana"]

# GitHub has no official "trending repos" API (github.com/trending is HTML-only,
# and scraping it risks breaking on any markup change or ToS friction). The
# Search API's repos-created-recently-sorted-by-stars is the standard honest
# proxy other trending trackers use instead -- same idea, a documented
# endpoint. Unauthenticated search calls are capped at 10/min; ingesting once
# per 10-minute schedule tick is well inside that.
GITHUB_TRENDING_DAYS = int(os.environ.get("GITHUB_TRENDING_DAYS", "7"))
GITHUB_TRENDING_LIMIT = int(os.environ.get("GITHUB_TRENDING_LIMIT", "20"))

# When true (or when RAW_BUCKET is unset), records are written under ./local_output
# instead of S3 -- lets the handlers run locally without any AWS resources.
DRY_RUN = os.environ.get("DRY_RUN", "false").lower() == "true"

# RAG (retrieve-and-generate over the curated zone via Bedrock).
BEDROCK_EMBED_MODEL_ID = os.environ.get("BEDROCK_EMBED_MODEL_ID", "amazon.titan-embed-text-v2:0")
# Newer Claude models require an inference profile ID (region-prefixed), not
# the bare model ID, for on-demand invocation.
BEDROCK_TEXT_MODEL_ID = os.environ.get(
    "BEDROCK_TEXT_MODEL_ID", "us.anthropic.claude-haiku-4-5-20251001-v1:0"
)
RAG_TOP_K = int(os.environ.get("RAG_TOP_K", "5"))
RAG_INDEX_KEY = os.environ.get("RAG_INDEX_KEY", "rag-index/index.json")

# Web search fallback for CRAG's "incorrect" branch (Tavily -- api.tavily.com).
TAVILY_SECRET_NAME = os.environ.get("TAVILY_SECRET_NAME", "data-pipeline/tavily-api")
