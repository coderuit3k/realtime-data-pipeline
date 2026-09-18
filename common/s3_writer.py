import json
import os
import uuid
from datetime import datetime, timezone

import boto3

from . import config

_s3_client = None


def _client():
    global _s3_client
    if _s3_client is None:
        _s3_client = boto3.client("s3", region_name=config.AWS_REGION)
    return _s3_client


def build_key(source: str, ts: datetime) -> str:
    return (
        f"source={source}/year={ts:%Y}/month={ts:%m}/day={ts:%d}/hour={ts:%H}/"
        f"{ts:%Y%m%dT%H%M%S}-{uuid.uuid4().hex[:8]}.json"
    )


def write_records(source: str, records: list[dict]) -> str:
    """Writes records as newline-delimited JSON to the raw zone and returns the key.

    Falls back to a local file under ./local_output when DRY_RUN is set or no
    bucket is configured, so ingestion handlers can be exercised without AWS.
    """
    if not records:
        return ""

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
    path = os.path.join("local_output", key)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(body)
