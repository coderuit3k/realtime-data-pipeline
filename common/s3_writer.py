"""Writes ingested records to the raw S3 zone as Hive-partitioned NDJSON."""

import json
import logging
import os
import uuid
from datetime import datetime, timezone

import boto3

from . import config

logger = logging.getLogger(__name__)

_s3_client = None


def _client():
    """Created on first use and reused across warm Lambda invocations."""
    global _s3_client
    if _s3_client is None:
        _s3_client = boto3.client("s3", region_name=config.AWS_REGION)
    return _s3_client


def build_key(source: str, ts: datetime) -> str:
    """Hive-style partitions for Glue/Athena; the random suffix keeps same-second runs apart."""
    return (
        f"source={source}/year={ts:%Y}/month={ts:%m}/day={ts:%d}/hour={ts:%H}/"
        f"{ts:%Y%m%dT%H%M%S}-{uuid.uuid4().hex[:8]}.json"
    )


def _dedupe(records: list[dict], key_field: str) -> list[dict]:
    """Drop records whose key_field value was already seen; the first occurrence wins."""
    seen = set()
    deduped = []
    for record in records:
        value = record[key_field]
        if value in seen:
            continue
        seen.add(value)
        deduped.append(record)

    dropped = len(records) - len(deduped)
    if dropped:
        logger.info("Dropped %d duplicate record(s) by %s", dropped, key_field)
    return deduped


def write_records(source: str, records: list[dict], key_field: str) -> str:
    """Write records as NDJSON to the raw zone and return the key ("" if none).

    Duplicates within this batch (same key_field) are dropped first so one API
    response's repeats never reach S3; repeats across runs are not deduped
    here. Writes under ./local_output instead when DRY_RUN is set or no bucket
    is configured, so handlers run without AWS.
    """
    if not records:
        return ""

    records = _dedupe(records, key_field)
    ts = datetime.now(timezone.utc)
    key = build_key(source, ts)
    body = "\n".join(json.dumps(r, ensure_ascii=False) for r in records)

    if config.DRY_RUN or not config.RAW_BUCKET:
        _write_local(key, body)
        return key

    _client().put_object(
        Bucket=config.RAW_BUCKET,
        Key=key,
        Body=body.encode("utf-8"),
        ContentType="application/x-ndjson",
    )
    return key


def _write_local(key: str, body: str) -> None:
    """Mirror the S3 key layout under ./local_output for dry runs."""
    path = os.path.join("local_output", key)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(body)
