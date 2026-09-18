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
