"""Qdrant Cloud access for the RAG knowledge base: collection setup, upsert, hybrid search.

One collection holds every embedded document with two named vectors: `dense` (Bedrock Titan,
computed by the caller) and `sparse` (BM25, computed by Qdrant Cloud Inference from the text).
"""

import hashlib
import logging
import uuid

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
    """Upsert documents (id, source, title, url, text, embedding) in batches."""
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
                    "text_hash": text_hash(d["text"]),
                    "embed_model": config.BEDROCK_EMBED_MODEL_ID,
                },
            )
            for d in documents[start : start + batch_size]
        ]
        client.upsert(config.QDRANT_COLLECTION, points=points)


def hybrid_search(query: str, query_vector: list[float], candidates: int) -> list[dict]:
    """Dense and BM25 retrieval in one call, fused with Reciprocal Rank Fusion.

    BM25 matches exact terms only, so a question sharing no words with the documents gets an
    empty sparse list and the result is simply the dense ranking.
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
        limit=candidates,
        with_payload=True,
    )
    return [
        {
            "title": p.payload.get("title", ""),
            "url": p.payload.get("url", ""),
            "text": p.payload.get("text", ""),
            "source": p.payload.get("source", ""),
            "score": p.score,
        }
        for p in response.points
    ]
