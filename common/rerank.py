"""Cross-encoder rerank through the Jina API, with a graceful fallback."""

import logging

import requests

from . import config
from .secrets import get_secret

logger = logging.getLogger(__name__)

JINA_RERANK_URL = "https://api.jina.ai/v1/rerank"
# About 300 tokens per document: keeps 30 candidates near 9k tokens per question.
MAX_DOC_CHARS = 1000
RERANK_TIMEOUT_SECONDS = 5


def rerank(query: str, docs: list[dict], top_n: int) -> list[dict]:
    """Return the top_n docs ordered by Jina's relevance score.

    Any failure (network, HTTP error, empty or malformed response) is logged and the first
    top_n docs are returned in their incoming (RRF) order, so a Jina outage never fails an answer.
    """
    if not docs:
        return []

    fallback = docs[:top_n]
    try:
        api_key = get_secret(config.JINA_SECRET_NAME)["api_key"]
        response = requests.post(
            JINA_RERANK_URL,
            headers={"Authorization": f"Bearer {api_key}"},
            json={
                "model": config.JINA_RERANK_MODEL,
                "query": query,
                "documents": [(d.get("text") or "")[:MAX_DOC_CHARS] for d in docs],
                "top_n": top_n,
            },
            timeout=RERANK_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        results = response.json()["results"]
        ranked = [{**docs[r["index"]], "score": r["relevance_score"]} for r in results]
    except Exception:
        logger.warning("Jina rerank failed, keeping RRF order", exc_info=True)
        return fallback

    return ranked or fallback
