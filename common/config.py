"""Runtime settings, read once from env vars (set by Terraform) with local-dev defaults."""

import os

AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")
RAW_BUCKET = os.environ.get("RAW_BUCKET", "")
CURATED_BUCKET = os.environ.get("CURATED_BUCKET", "")

NEWS_SECRET_NAME = os.environ.get("NEWS_SECRET_NAME", "realtime-data-pipeline-dev/news-api")

# Hacker News' API is public: no key needed.
HN_FEED = os.environ.get("HN_FEED", "newstories")  # or "topstories", "beststories"
HN_STORY_LIMIT = int(os.environ.get("HN_STORY_LIMIT", "50"))

# Concurrent HTTP requests per ingestion run (one per HN story / weather
# location); the sequential loop this replaced took ~5-6s per run.
INGESTION_FETCH_WORKERS = int(os.environ.get("INGESTION_FETCH_WORKERS", "10"))

NEWS_QUERY = os.environ.get("NEWS_QUERY", "cryptocurrency OR technology")
NEWS_PAGE_SIZE = int(os.environ.get("NEWS_PAGE_SIZE", "50"))
NEWS_LANGUAGE = os.environ.get("NEWS_LANGUAGE", "en")

# Open-Meteo needs no API key. Hard-coded rather than env-configurable because
# a list of dicts doesn't map cleanly onto a single env var.
WEATHER_LOCATIONS = [
    {"name": "Tay Ninh", "latitude": 11.3100, "longitude": 106.0989},
    {"name": "Ho Chi Minh City", "latitude": 10.7769, "longitude": 106.7009},
    {"name": "Thu Dau Mot (Binh Duong)", "latitude": 10.9804, "longitude": 106.6519},
    {"name": "Long Xuyen (An Giang)", "latitude": 10.3860, "longitude": 105.4351},
    {"name": "Bien Hoa (Dong Nai)", "latitude": 10.9574, "longitude": 106.8426},
    {"name": "Can Tho", "latitude": 10.0452, "longitude": 105.7469},
    {"name": "My Tho (Tien Giang)", "latitude": 10.3600, "longitude": 106.3600},
    {"name": "Soc Trang", "latitude": 9.6003, "longitude": 105.9800},
    {"name": "Vung Tau", "latitude": 10.4114, "longitude": 107.1362},
    {"name": "Rach Gia (Kien Giang)", "latitude": 10.0124, "longitude": 105.0809},
    {"name": "Ca Mau", "latitude": 9.1769, "longitude": 105.1500},
    {"name": "Da Lat", "latitude": 11.9404, "longitude": 108.4583},
]

# CoinGecko's public /simple/price endpoint needs no API key. These are its own
# coin ids, not ticker symbols, picked to overlap with what NEWS_QUERY and
# Hacker News actually mention.
CRYPTO_COIN_IDS = ["bitcoin", "ethereum", "solana"]

# GitHub has no trending API (github.com/trending is HTML-only and fragile to
# scrape), so "trending" = repos created in the last N days, sorted by stars,
# via the documented Search API. Unauthenticated search is capped at 10
# calls/min; one call per scheduled run is well inside that.
GITHUB_TRENDING_DAYS = int(os.environ.get("GITHUB_TRENDING_DAYS", "7"))
GITHUB_TRENDING_LIMIT = int(os.environ.get("GITHUB_TRENDING_LIMIT", "20"))

GMAIL_SECRET_NAME = os.environ.get(
    "GMAIL_SECRET_NAME", "realtime-data-pipeline-dev/gmail-ingestion"
)
GMAIL_MESSAGE_LIMIT = int(os.environ.get("GMAIL_MESSAGE_LIMIT", "50"))
GMAIL_R2_BUCKET_NAME = os.environ.get("GMAIL_R2_BUCKET_NAME", "")
# DynamoDB table caching each Gmail message's classifier labels by message_id, so the same email
# (re-ingested every run) is only classified once. Empty disables the cache (local runs, tests).
GMAIL_LABELS_TABLE = os.environ.get("GMAIL_LABELS_TABLE", "")

# True (or RAW_BUCKET unset) writes records under ./local_output instead of S3,
# so the handlers run locally without any AWS resources.
DRY_RUN = os.environ.get("DRY_RUN", "false").lower() == "true"

# RAG (retrieve-and-generate over the curated zone via Bedrock).
BEDROCK_EMBED_MODEL_ID = os.environ.get("BEDROCK_EMBED_MODEL_ID", "amazon.titan-embed-text-v2:0")
# Newer Claude models need a region-prefixed inference profile ID, not the bare
# model ID, for on-demand invocation.
BEDROCK_TEXT_MODEL_ID = os.environ.get(
    "BEDROCK_TEXT_MODEL_ID", "us.anthropic.claude-haiku-4-5-20251001-v1:0"
)
RAG_TOP_K = int(os.environ.get("RAG_TOP_K", "5"))

# Question/answer cache (DynamoDB); an empty table name disables it.
RAG_MEMORY_TABLE = os.environ.get("RAG_MEMORY_TABLE", "")
RAG_MEMORY_TTL_SECONDS = int(os.environ.get("RAG_MEMORY_TTL_SECONDS", str(7 * 24 * 3600)))
RAG_MEMORY_PROMOTE_AFTER_HITS = int(os.environ.get("RAG_MEMORY_PROMOTE_AFTER_HITS", "2"))
# Parquet files read at once when rag/build_index.py scans the curated history. Sequential reads
# (~3,400 files) took longer than the Lambda's 300 s timeout.
RAG_READ_WORKERS = int(os.environ.get("RAG_READ_WORKERS", "10"))
# Bedrock embedding calls made at once (new documents are embedded in concurrent chunks).
RAG_EMBED_WORKERS = int(os.environ.get("RAG_EMBED_WORKERS", "10"))

# Hybrid search: Qdrant Cloud (dense + BM25 sparse, fused with RRF) and a Jina rerank on top.
QDRANT_SECRET_NAME = os.environ.get("QDRANT_SECRET_NAME", "realtime-data-pipeline-dev/qdrant")
QDRANT_COLLECTION = os.environ.get("QDRANT_COLLECTION", "datapulse-rag")
JINA_SECRET_NAME = os.environ.get("JINA_SECRET_NAME", "realtime-data-pipeline-dev/jina-api")
JINA_RERANK_MODEL = os.environ.get("JINA_RERANK_MODEL", "jina-reranker-v3.5")
# Candidates taken from each retriever and kept after RRF, before the rerank cuts to RAG_TOP_K.
RAG_CANDIDATES = int(os.environ.get("RAG_CANDIDATES", "30"))
# false skips the Jina call, so hybrid + RRF alone can be measured with the same code.
RAG_RERANK = os.environ.get("RAG_RERANK", "true").lower() == "true"

# Tavily web search: the agent's fallback when the knowledge base has nothing
# relevant.
TAVILY_SECRET_NAME = os.environ.get("TAVILY_SECRET_NAME", "realtime-data-pipeline-dev/tavily-api")

# Athena SQL tool for the agent, for aggregate questions get_crypto_prices /
# get_weather can't answer. Same workgroup/database as the public Data
# Explorer page (see infra/glue.tf).
ATHENA_WORKGROUP = os.environ.get("ATHENA_WORKGROUP", "")
ATHENA_DATABASE = os.environ.get("ATHENA_DATABASE", "")

# Trend Events (trends/trend_scan.py) -- daily cross-source keyword detection.
TREND_HN_MIN_STORIES = int(os.environ.get("TREND_HN_MIN_STORIES", "3"))
TREND_NEWS_MIN_ARTICLES = int(os.environ.get("TREND_NEWS_MIN_ARTICLES", "2"))
TREND_MAX_EVENTS_PER_DAY = int(os.environ.get("TREND_MAX_EVENTS_PER_DAY", "3"))
