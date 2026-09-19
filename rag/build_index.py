import json
import logging
from io import BytesIO

import boto3
import pandas as pd

from common import config

logger = logging.getLogger()
logger.setLevel(logging.INFO)

_s3_client = None
_bedrock_client = None


def _s3():
    global _s3_client
    if _s3_client is None:
        _s3_client = boto3.client("s3", region_name=config.AWS_REGION)
    return _s3_client


def _bedrock():
    global _bedrock_client
    if _bedrock_client is None:
        _bedrock_client = boto3.client("bedrock-runtime", region_name=config.AWS_REGION)
    return _bedrock_client


def embed_text(text: str) -> list[float]:
    response = _bedrock().invoke_model(
        modelId=config.BEDROCK_EMBED_MODEL_ID,
        body=json.dumps({"inputText": text[:8000]}),
    )
    return json.loads(response["body"].read())["embedding"]


def build_document(record: dict, source: str) -> dict:
    if source == "hackernews":
        text = f"{record.get('title') or ''} {record.get('text') or ''}".strip()
        return {
            "id": record["story_id"],
            "source": "hackernews",
            "title": record.get("title") or "",
            "url": record.get("url") or record.get("permalink") or "",
            "text": text,
        }

    if source == "github":
        text = f"{record.get('full_name') or ''} {record.get('description') or ''}".strip()
        return {
            "id": record["repo_id"],
            "source": "github",
            "title": record.get("full_name") or "",
            "url": record.get("url") or "",
            "text": text,
        }

    text = f"{record.get('title') or ''} {record.get('description') or ''}".strip()
    return {
        "id": record["article_id"],
        "source": "news",
        "title": record.get("title") or "",
        "url": record.get("url") or "",
        "text": text,
    }


def dedup_documents(documents: list[dict]) -> list[dict]:
    seen = set()
    deduped = []
    for doc in documents:
        if doc["id"] in seen:
            continue
        seen.add(doc["id"])
        deduped.append(doc)
    return deduped


def list_parquet_keys(bucket: str, prefix: str) -> list[str]:
    keys = []
    paginator = _s3().get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for obj in page.get("Contents", []):
            if obj["Key"].endswith(".parquet"):
                keys.append(obj["Key"])
    return keys


def read_parquet_records(bucket: str, key: str) -> list[dict]:
    response = _s3().get_object(Bucket=bucket, Key=key)
    df = pd.read_parquet(BytesIO(response["Body"].read()))
    return df.to_dict(orient="records")


def build_documents() -> list[dict]:
    bucket = config.CURATED_BUCKET
    documents = []
    sources = (
        ("hackernews", "source=hackernews/"),
        ("news", "source=news/"),
        ("github", "source=github/"),
    )
    for source, prefix in sources:
        for key in list_parquet_keys(bucket, prefix):
            for record in read_parquet_records(bucket, key):
                documents.append(build_document(record, source))
    return dedup_documents(documents)


def load_existing_index() -> dict[str, dict]:
    try:
        response = _s3().get_object(Bucket=config.CURATED_BUCKET, Key=config.RAG_INDEX_KEY)
    except _s3().exceptions.NoSuchKey:
        return {}

    payload = json.loads(response["Body"].read())
    # A changed embedding model invalidates every cached vector -- mixing
    # embeddings from two different models in one similarity search is wrong.
    if payload.get("model_id") != config.BEDROCK_EMBED_MODEL_ID:
        return {}
    return {doc["id"]: doc for doc in payload["documents"]}


def partition_by_cache(
    documents: list[dict], existing: dict[str, dict]
) -> tuple[list[dict], list[dict]]:
    """Splits into (already-embedded, needs-embedding) using the previous index
    as a cache -- a document only needs re-embedding if it's new or its text
    changed, so re-runs don't re-embed everything (Bedrock is billed per token)."""
    cached, needs_embedding = [], []
    for doc in documents:
        entry = existing.get(doc["id"])
        if entry is not None and entry.get("text") == doc["text"]:
            doc["embedding"] = entry["embedding"]
            cached.append(doc)
        else:
            needs_embedding.append(doc)
    return cached, needs_embedding


def lambda_handler(event, context):
    documents = [doc for doc in build_documents() if doc["text"]]
    existing = load_existing_index()
    cached_docs, needs_embedding = partition_by_cache(documents, existing)

    for doc in needs_embedding:
        doc["embedding"] = embed_text(doc["text"])

    all_docs = cached_docs + needs_embedding
    body = json.dumps({"model_id": config.BEDROCK_EMBED_MODEL_ID, "documents": all_docs})
    _s3().put_object(
        Bucket=config.CURATED_BUCKET,
        Key=config.RAG_INDEX_KEY,
        Body=body.encode("utf-8"),
        ContentType="application/json",
    )

    logger.info(
        "Indexed %d documents (%d newly embedded, %d from cache) to %s",
        len(all_docs), len(needs_embedding), len(cached_docs), config.RAG_INDEX_KEY,
    )
    return {
        "statusCode": 200,
        "documents_indexed": len(all_docs),
        "newly_embedded": len(needs_embedding),
        "cached": len(cached_docs),
        "s3_key": config.RAG_INDEX_KEY,
    }


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    print(lambda_handler({}, None))
