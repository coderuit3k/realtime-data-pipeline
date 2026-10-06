"""Cross-encoder rerank through the Jina API, with a graceful fallback."""

import logging

import requests

from . import config
from .secrets import get_secret

logger = logging.getLogger(__name__)

JINA_RERANK_URL = "https://api.jina.ai/v1/rerank"
# Jina truncates each document to this many tokens (max_doc_length accepts 1-8192 on the v3
# models), so the text is sent whole. 30 candidates x 3000 stays under the 131k-token request cap.
MAX_DOC_TOKENS = 3000
RERANK_TIMEOUT_SECONDS = 5
# Results scoring below this are dropped. Jina's relevance_score is not a 0-1 probability (it can
# be negative) and only means something relative to the inputs it was calibrated on. The first
# value (0.15) came from six full-sentence questions over the un-normalized index. The agent
# actually sends short keyword queries over normalized text, which score lower (median top-1
# 0.24 over 34 real calls; relevant passages 0.09-0.44, clearly off-topic ones <= 0.075), and
# 0.15 cut relevant passages ("bitcoin etfs", "postgresql"). Normalization, query wording and
# which candidates retrieval returns all move these scores and were not separated, so re-check
# this against the "Jina rerank scores=" log lines whenever any of them changes.
RERANK_MIN_SCORE = 0.08


def rerank(query: str, docs: list[dict], top_n: int) -> list[dict]:
    """Return the top_n docs ordered by Jina's relevance score, minus any below RERANK_MIN_SCORE.

    Any failure (network, HTTP error, empty or malformed response) is logged and the first
    top_n docs are returned in their incoming (RRF) order, so a Jina outage never fails an answer.
    A successful response where nothing reaches RERANK_MIN_SCORE returns []: the knowledge base has
    nothing relevant, which must not be papered over with the unranked RRF docs.
    """
    if not docs:
        return []

    fallback = docs[:top_n]
    try:
        api_key = get_secret(config.JINA_SECRET_NAME)["api_key"]
        response = requests.post(
            JINA_RERANK_URL,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}"
            },
            json={
                "model": config.JINA_RERANK_MODEL,
                "query": query,
                "documents": [d.get("text") or "" for d in docs],
                "top_n": top_n,
                "max_doc_length": MAX_DOC_TOKENS,
                "return_documents": False,
            },
            timeout=RERANK_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        results = response.json()["results"]
        ranked = [{**docs[r["index"]], "score": r["relevance_score"]} for r in results]
    except Exception:
        logger.warning("Jina rerank failed, keeping RRF order", exc_info=True)
        return fallback

    if not ranked:
        return fallback  # an empty result list from Jina is a bad response, not "nothing relevant"
    kept = [d for d in ranked if d["score"] >= RERANK_MIN_SCORE]
    # One line per call so RERANK_MIN_SCORE can be tuned from real traffic in CloudWatch.
    logger.info(
        "Jina rerank scores=%s kept=%d/%d min_score=%s query=%r",
        [round(d["score"], 4) for d in ranked],
        len(kept),
        len(ranked),
        RERANK_MIN_SCORE,
        query[:80],
    )
    return kept
