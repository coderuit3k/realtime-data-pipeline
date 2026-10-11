"""Qdrant Cloud access for the RAG knowledge base: collection setup, upsert, hybrid search.

One collection holds every embedded document with two named vectors: `dense` (Bedrock Titan,
computed by the caller) and `sparse` (BM25, computed by Qdrant Cloud Inference from the text).
"""

import hashlib
import logging
import uuid
from datetime import datetime, timezone

from qdrant_client import QdrantClient, models

from . import config
from .secrets import get_secret

logger = logging.getLogger(__name__)

DENSE_VECTOR = "dense"
SPARSE_VECTOR = "sparse"
# amazon.titan-embed-text-v2:0 returns 1024 floats by default.
DENSE_SIZE = 1024
BM25_MODEL = "qdrant/bm25"
SCROLL_PAGE_SIZE = 1000
# Sources with embedded documents; search filters only accept these.
KB_SOURCES = ("hackernews", "news", "github")
# A 64-point upsert makes Qdrant Cloud Inference compute BM25 vectors, which can outlast the
# library's short default.
QDRANT_TIMEOUT_SECONDS = 60
# Fixed namespace: point ids must be identical on every run so an upsert updates in place.
_ID_NAMESPACE = uuid.UUID("5d1c3a2e-8f4b-4a6e-9c1d-2b7e0f3a9d10")

_client_instance = None


def _client() -> QdrantClient:
    """Created on first use and reused across warm Lambda invocations."""
    global _client_instance
    if _client_instance is None:
        secret = get_secret(config.QDRANT_SECRET_NAME)
        _client_instance = QdrantClient(
            url=secret["url"],
            api_key=secret["api_key"],
            cloud_inference=True,
            prefer_grpc=False,
            timeout=QDRANT_TIMEOUT_SECONDS,
        )
    return _client_instance


def point_id(source: str, doc_id: str) -> str:
    """Qdrant ids must be ints or UUIDs; the three sources have independent id spaces."""
    return str(uuid.uuid5(_ID_NAMESPACE, f"{source}:{doc_id}"))


def text_hash(text: str) -> str:
    """SHA-256 of the text, stored in the payload to detect edited documents."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def ensure_collection() -> None:
    """Create the collection if it does not exist yet; a no-op otherwise."""
    client = _client()
    if client.collection_exists(config.QDRANT_COLLECTION):
        return
    client.create_collection(
        collection_name=config.QDRANT_COLLECTION,
        vectors_config={
            DENSE_VECTOR: models.VectorParams(size=DENSE_SIZE, distance=models.Distance.COSINE)
        },
        # IDF is applied by Qdrant at query time, which is what makes the sparse side BM25-like.
        sparse_vectors_config={
            SPARSE_VECTOR: models.SparseVectorParams(modifier=models.Modifier.IDF)
        },
    )
    logger.info("Created Qdrant collection %s", config.QDRANT_COLLECTION)


def existing_hashes() -> dict[str, dict]:
    """Map point id to {"text_hash", "embed_model"} for every stored point (no vectors)."""
    client = _client()
    hashes: dict[str, dict] = {}
    offset = None
    while True:
        points, offset = client.scroll(
            collection_name=config.QDRANT_COLLECTION,
            limit=SCROLL_PAGE_SIZE,
            offset=offset,
            with_payload=["text_hash", "embed_model"],
            with_vectors=False,
        )
        for point in points:
            hashes[str(point.id)] = {
                "text_hash": point.payload.get("text_hash"),
                "embed_model": point.payload.get("embed_model"),
            }
        if offset is None:
            return hashes


def upsert_documents(documents: list[dict], batch_size: int = 64) -> None:
    """Upsert documents (id, source, title, url, text, published_date/ts, embedding) in batches."""
    client = _client()
    for start in range(0, len(documents), batch_size):
        points = [
            models.PointStruct(
                id=point_id(d["source"], d["id"]),
                vector={
                    DENSE_VECTOR: d["embedding"],
                    SPARSE_VECTOR: models.Document(text=d["text"], model=BM25_MODEL),
                },
                payload={
                    "doc_id": d["id"],
                    "source": d["source"],
                    "title": d["title"],
                    "url": d["url"],
                    "text": d["text"],
                    "published_date": d.get("published_date", ""),
                    "published_ts": d.get("published_ts", 0),
                    "text_hash": text_hash(d["text"]),
                    "embed_model": config.BEDROCK_EMBED_MODEL_ID,
                },
            )
            for d in documents[start : start + batch_size]
        ]
        client.upsert(config.QDRANT_COLLECTION, points=points)


def backfill_published_dates(dates_by_point_id: dict[str, tuple[str, int]]) -> int:
    """Set published_date/published_ts on points that lack them, without touching vectors.

    New documents already carry the fields via upsert, so this only ever touches points
    written before the fields existed. Returns the number of points updated; once every
    point has the fields it is a read-only no-op.
    """
    client = _client()
    missing: dict[str, tuple[str, int]] = {}
    offset = None
    while True:
        points, offset = client.scroll(
            collection_name=config.QDRANT_COLLECTION,
            limit=SCROLL_PAGE_SIZE,
            offset=offset,
            with_payload=["published_date"],
            with_vectors=False,
        )
        for point in points:
            if point.payload.get("published_date"):
                continue
            dates = dates_by_point_id.get(str(point.id))
            if dates and dates[0]:
                missing[str(point.id)] = dates
        if offset is None:
            break
    by_date: dict[tuple[str, int], list[str]] = {}
    for point_id_, dates in missing.items():
        by_date.setdefault(dates, []).append(point_id_)
    updated = 0
    for (date_str, ts), point_ids in by_date.items():
        for start in range(0, len(point_ids), SCROLL_PAGE_SIZE):
            batch = point_ids[start : start + SCROLL_PAGE_SIZE]
            client.set_payload(
                collection_name=config.QDRANT_COLLECTION,
                payload={"published_date": date_str, "published_ts": ts},
                points=batch,
            )
            updated += len(batch)
    if updated:
        logger.info("Backfilled published_date on %d points", updated)
    return updated


def build_search_filter(
    sources: list[str] | None = None, days_back: int | None = None
) -> models.Filter | None:
    """Qdrant filter for search_knowledge_base's optional sources/days_back arguments.

    Unknown sources are dropped and a non-positive days_back is ignored; returns None when
    nothing valid was given so the caller can skip filtering entirely.
    """
    conditions = []
    valid_sources = [s for s in (sources or []) if s in KB_SOURCES]
    if valid_sources:
        conditions.append(
            models.FieldCondition(key="source", match=models.MatchAny(any=valid_sources))
        )
    if isinstance(days_back, int) and not isinstance(days_back, bool) and days_back >= 1:
        since_ts = int(datetime.now(timezone.utc).timestamp()) - days_back * 86400
        conditions.append(
            models.FieldCondition(key="published_ts", range=models.Range(gte=since_ts))
        )
    if not conditions:
        return None
    return models.Filter(must=conditions)


def hybrid_search(
    query: str,
    query_vector: list[float],
    candidates: int,
    query_filter: models.Filter | None = None,
) -> list[dict]:
    """Dense and BM25 retrieval in one call, fused with Reciprocal Rank Fusion.

    BM25 matches exact terms only, so a question sharing no words with the documents gets an
    empty sparse list and the result is simply the dense ranking. query_filter (from
    build_search_filter) restricts the pool before fusion, so e.g. days_back=7 ranks the
    best of the last 7 days rather than cutting the global top-N afterwards.
    """
    response = _client().query_points(
        collection_name=config.QDRANT_COLLECTION,
        prefetch=[
            models.Prefetch(
                query=models.Document(text=query, model=BM25_MODEL),
                using=SPARSE_VECTOR,
                limit=candidates,
            ),
            models.Prefetch(query=query_vector, using=DENSE_VECTOR, limit=candidates),
        ],
        query=models.FusionQuery(fusion=models.Fusion.RRF),
        query_filter=query_filter,
        limit=candidates,
        with_payload=True,
    )
    return [
        {
            "title": p.payload.get("title", ""),
            "url": p.payload.get("url", ""),
            "text": p.payload.get("text", ""),
            "source": p.payload.get("source", ""),
            "published_date": p.payload.get("published_date", ""),
            "published_ts": p.payload.get("published_ts") or 0,
            "score": p.score,
        }
        for p in response.points
    ]
