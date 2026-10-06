"""Build-index Lambda (nightly): embeds curated HN/news/GitHub records into Qdrant Cloud.

Each document becomes one Qdrant point with a Titan dense vector and a BM25 sparse vector
(computed by Qdrant). Documents already stored with the same text and embedding model are skipped,
so a re-run only embeds new or changed ones. Weather and crypto are numeric and are read by the
agent's own tools instead of being embedded.
"""

import json
import logging
from io import BytesIO

import boto3
import pandas as pd
from botocore.config import Config

from common import config, qdrant_store
from common.http import map_concurrently
from common.text_normalize import normalize_text

logger = logging.getLogger()
logger.setLevel(logging.INFO)

_s3_client = None
_bedrock_client = None


def _s3():
    """Lazily create the S3 client so importing this module needs no AWS."""
    global _s3_client
    if _s3_client is None:
        _s3_client = boto3.client("s3", region_name=config.AWS_REGION)
    return _s3_client


def _bedrock():
    """Lazily create the Bedrock runtime client."""
    global _bedrock_client
    if _bedrock_client is None:
        # Adaptive retries make Bedrock throttling slow the concurrent embedding down instead
        # of failing the run.
        _bedrock_client = boto3.client(
            "bedrock-runtime",
            region_name=config.AWS_REGION,
            config=Config(retries={"max_attempts": 8, "mode": "adaptive"}),
        )
    return _bedrock_client


def embed_text(text: str) -> list[float]:
    """Embed text with the configured Bedrock model, truncated to stay under its input limit."""
    response = _bedrock().invoke_model(
        modelId=config.BEDROCK_EMBED_MODEL_ID,
        body=json.dumps({"inputText": text}),
    )
    return json.loads(response["body"].read())["embedding"]


def build_document(record: dict, source: str) -> dict:
    """Map a curated record to the index's common {id, source, title, url, text} shape.

    Text is normalized here as well as in the transform Lambda (normalize_text is idempotent), so
    the indexed text is normalized even for curated files written before that change.
    """
    if source == "hackernews":
        title = normalize_text(record.get("title"))
        text = f"{title} {normalize_text(record.get('text'))}".strip()
        return {
            "id": record["story_id"],
            "source": "hackernews",
            "title": title,
            "url": record.get("url") or record.get("permalink") or "",
            "text": text,
        }

    if source == "github":
        full_name = record.get("full_name") or ""
        text = f"{normalize_text(full_name)} {normalize_text(record.get('description'))}".strip()
        return {
            "id": record["repo_id"],
            "source": "github",
            "title": full_name,
            "url": record.get("url") or "",
            "text": text,
        }

    title = normalize_text(record.get("title"))
    text = f"{title} {normalize_text(record.get('description'))}".strip()
    return {
        "id": record["article_id"],
        "source": "news",
        "title": title,
        "url": record.get("url") or "",
        "text": text,
    }


def dedup_documents(documents: list[dict]) -> list[dict]:
    """Keep the first document per (source, id): the same item is re-ingested across many runs,
    and the three sources have independent id spaces."""
    seen = set()
    deduped = []
    for doc in documents:
        key = (doc["source"], doc["id"])
        if key in seen:
            continue
        seen.add(key)
        deduped.append(doc)
    return deduped


def list_parquet_keys(bucket: str, prefix: str) -> list[str]:
    """List every .parquet key under prefix, following S3 pagination."""
    keys = []
    paginator = _s3().get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for obj in page.get("Contents", []):
            if obj["Key"].endswith(".parquet"):
                keys.append(obj["Key"])
    return keys


def read_parquet_records(bucket: str, key: str) -> list[dict]:
    """Load one Parquet object from S3 as a list of row dicts."""
    response = _s3().get_object(Bucket=bucket, Key=key)
    df = pd.read_parquet(BytesIO(response["Body"].read()))
    return df.to_dict(orient="records")


def build_documents() -> list[dict]:
    """Scan the full curated history of every text source and return deduped documents."""
    bucket = config.CURATED_BUCKET
    documents = []
    sources = (
        ("hackernews", "source=hackernews/"),
        ("news", "source=news/"),
        ("github", "source=github/"),
    )
    for source, prefix in sources:
        # Each file is reduced to small document dicts inside its worker, so only those (not
        # every raw DataFrame) are held in memory at once.
        per_file = map_concurrently(
            lambda key, source=source: [
                build_document(record, source) for record in read_parquet_records(bucket, key)
            ],
            list_parquet_keys(bucket, prefix),
            config.RAG_READ_WORKERS,
        )
        for file_documents in per_file:
            documents.extend(file_documents)
    return dedup_documents(documents)


UPSERT_BATCH = 64
# Stop embedding with this much Lambda time left, so the upsert and the response still finish.
TIME_BUFFER_MS = 30_000


def partition_changed(
    documents: list[dict], existing: dict[str, dict]
) -> tuple[list[dict], list[dict]]:
    """Split into (unchanged, needs_embedding) by comparing text hash and embedding model.

    Bedrock bills per embedded token, so only new or edited documents, or all of them after an
    embedding-model change (vectors from different models are not comparable), are embedded.
    """
    unchanged, needs_embedding = [], []
    for doc in documents:
        stored = existing.get(qdrant_store.point_id(doc["source"], doc["id"]))
        current = {
            "text_hash": qdrant_store.text_hash(doc["text"]),
            "embed_model": config.BEDROCK_EMBED_MODEL_ID,
        }
        (unchanged if stored == current else needs_embedding).append(doc)
    return unchanged, needs_embedding


def _has_time_left(context) -> bool:
    return context is None or context.get_remaining_time_in_millis() > TIME_BUFFER_MS


def lambda_handler(event, context):
    """Upsert new or changed documents into Qdrant; stop early if Lambda time runs low.

    Documents are embedded concurrently in chunks and each chunk is upserted before the next
    starts, so a run that ends early (time) keeps its progress and the next run continues.
    """
    documents = [doc for doc in build_documents() if doc["text"]]
    qdrant_store.ensure_collection()
    unchanged, needs_embedding = partition_changed(documents, qdrant_store.existing_hashes())

    chunk_size = UPSERT_BATCH * 2
    embedded = 0
    for start in range(0, len(needs_embedding), chunk_size):
        if not _has_time_left(context):
            break
        chunk = needs_embedding[start : start + chunk_size]
        vectors = map_concurrently(
            lambda doc: embed_text(doc["text"]), chunk, config.RAG_EMBED_WORKERS
        )
        for doc, vector in zip(chunk, vectors):
            doc["embedding"] = vector
        qdrant_store.upsert_documents(chunk)
        embedded += len(chunk)

    remaining = len(needs_embedding) - embedded
    logger.info(
        "Indexed %d documents (%d newly embedded, %d unchanged, %d remaining) into %s",
        len(documents), embedded, len(unchanged), remaining, config.QDRANT_COLLECTION,
    )
    return {
        "statusCode": 200,
        "documents_seen": len(documents),
        "newly_embedded": embedded,
        "unchanged": len(unchanged),
        "remaining": remaining,
        "collection": config.QDRANT_COLLECTION,
    }


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    print(lambda_handler({}, None))
