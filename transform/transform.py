"""Transform Lambda: turns a raw NDJSON batch into a cleaned, keyword-tagged Parquet file.

Triggered by S3 object-created events on the raw bucket; writes to the curated bucket
under the same source=/year=/month=/day= partition layout that the Glue tables expect.
"""

import json
import logging
import os
import re
import uuid
from collections import Counter
from datetime import date, datetime, timezone
from urllib.parse import unquote_plus

import boto3
import pandas as pd

from common import config, email_label_cache, email_labels
from common.text_normalize import ENGLISH_STOPWORDS as STOPWORDS
from common.text_normalize import normalize_text

logger = logging.getLogger()
logger.setLevel(logging.INFO)

_s3_client = None
_bedrock_client = None


def _client():
    """Lazily create the S3 client so importing this module (e.g. in tests) needs no AWS."""
    global _s3_client
    if _s3_client is None:
        _s3_client = boto3.client("s3", region_name=config.AWS_REGION)
    return _s3_client


def _bedrock():
    """Lazily create the Bedrock runtime client."""
    global _bedrock_client
    if _bedrock_client is None:
        _bedrock_client = boto3.client("bedrock-runtime", region_name=config.AWS_REGION)
    return _bedrock_client


def extract_keywords(text: str, top_n: int = 5) -> list[str]:
    """Regex + stopword keyword extraction; the fallback when the LLM path fails."""
    words = re.findall(r"[a-zA-Z]{4,}", (text or "").lower())
    words = [w for w in words if w not in STOPWORDS]
    return [word for word, _ in Counter(words).most_common(top_n)]


def build_keyword_prompt(texts: list[str]) -> str:
    """Build one numbered prompt for the whole batch (one Bedrock call, not one per record)."""
    items = "\n".join(f"[{i + 1}] {text[:300]}" for i, text in enumerate(texts))
    return (
        "For each numbered item below, extract up to 5 short topical keywords "
        "(lowercase, comma-separated, no generic filler words). Respond with ONLY "
        'a JSON array of objects -- {"i": <item number>, "keywords": "a, b, c"} -- '
        "one per item, using the item's own [N] number as \"i\" (skip an item "
        "instead of guessing if its text is empty/unclear). No other text.\n\n"
        f"{items}"
    )


def parse_keyword_response(raw: str, expected_count: int) -> list[list[str] | None]:
    """Map the model's JSON reply back to input order, keyed by each entry's "i".

    Matching on "i" rather than position means a skipped or bad entry can only leave
    that one item as None (for a per-item regex fallback); it can never shift keywords
    onto the wrong record.
    """
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\n|\n```$", "", cleaned)
    entries = json.loads(cleaned)
    if not isinstance(entries, list):
        raise ValueError(f"Expected a JSON array, got: {entries!r}")

    by_index: dict[int, list[str]] = {}
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        i = entry.get("i")
        if not isinstance(i, int) or not (1 <= i <= expected_count):
            continue
        keywords = entry.get("keywords") or ""
        by_index[i] = [kw.strip().lower() for kw in keywords.split(",") if kw.strip()]

    return [by_index.get(i + 1) for i in range(expected_count)]


def extract_keywords_llm(texts: list[str]) -> list[list[str]]:
    """Extract keywords for a batch with one Bedrock call; raises if the call or parse fails."""
    if not texts:
        return []
    response = _bedrock().invoke_model(
        modelId=config.BEDROCK_TEXT_MODEL_ID,
        body=json.dumps(
            {
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 1500,
                "messages": [{"role": "user", "content": build_keyword_prompt(texts)}],
            }
        ),
    )
    body = json.loads(response["body"].read())
    keyword_lists = parse_keyword_response(body["content"][0]["text"], len(texts))
    # Fill only the items the model skipped, keeping its output for the rest.
    return [
        kws if kws is not None else extract_keywords(texts[i])
        for i, kws in enumerate(keyword_lists)
    ]


def record_text(record: dict, source: str) -> str:
    """Return the free-text fields of a record that keywords are extracted from."""
    if source == "hackernews":
        return f"{record.get('title') or ''} {record.get('text') or ''}".strip()
    if source == "github":
        return f"{record.get('full_name') or ''} {record.get('description') or ''}".strip()
    if source == "gmail":
        return f"{record.get('subject') or ''} {record.get('snippet') or ''}".strip()
    return f"{record.get('title') or ''} {record.get('description') or ''}".strip()


def attach_keywords(records: list[dict], source: str) -> list[dict]:
    """Set record["keywords"] in place; any LLM failure degrades to regex, never fails the batch."""
    texts = [record_text(r, source) for r in records]
    try:
        keyword_lists = extract_keywords_llm(texts)
    except Exception:
        logger.exception("LLM keyword extraction failed, falling back to regex")
        keyword_lists = [extract_keywords(text) for text in texts]

    for record, keywords in zip(records, keyword_lists):
        record["keywords"] = keywords
    return records


def classify_emails_llm(emails: list[dict], today: date) -> list[dict | None]:
    """Label a batch of emails with one Bedrock call; raises if the call or the parse fails.

    An item the model skipped comes back as None, never as a guessed label.
    """
    if not emails:
        return []
    response = _bedrock().invoke_model(
        modelId=config.BEDROCK_TEXT_MODEL_ID,
        body=json.dumps(
            {
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 4000,
                "messages": [
                    {"role": "user", "content": email_labels.build_label_prompt(emails, today)}
                ],
            }
        ),
    )
    body = json.loads(response["body"].read())
    return email_labels.parse_label_response(body["content"][0]["text"], len(emails))


def attach_email_labels(records: list[dict], today: date | None = None) -> list[dict]:
    """Set the six label keys on every record; never raises.

    The same email arrives in every ingestion run, so labels are read from the DynamoDB cache and
    only the emails missing there go to Bedrock. A failed lookup, call or write degrades to NULL
    labels for the affected emails (not cached, so the next run retries) and never fails the batch.
    """
    if not records:
        return records
    today = today or datetime.now(timezone.utc).date()
    message_ids = [r["message_id"] for r in records]

    try:
        cached = email_label_cache.get_cached_labels(message_ids)
    except Exception:
        logger.exception("Gmail label cache read failed, classifying every email")
        cached = {}

    missing = [r for r in records if r["message_id"] not in cached]
    fresh: dict[str, dict] = {}
    if missing:
        try:
            labels = classify_emails_llm(missing, today)
            fresh = {r["message_id"]: label for r, label in zip(missing, labels) if label}
        except Exception:
            logger.exception("Gmail classification failed, leaving labels empty")
    if fresh:
        try:
            email_label_cache.put_labels(fresh)
        except Exception:
            logger.exception("Gmail label cache write failed")

    for record in records:
        label = cached.get(record["message_id"]) or fresh.get(record["message_id"]) or {}
        for field in email_labels.LABEL_FIELDS:
            record[field] = label.get(field)
    return records


def dedup_records(records: list[dict], id_field: str) -> list[dict]:
    """Drop records whose id_field repeats, keeping the first occurrence."""
    seen = set()
    deduped = []
    for record in records:
        key = record.get(id_field)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(record)
    return deduped


def clean_hackernews_record(record: dict) -> dict:
    """Return a copy with None/whitespace text fields normalised to stripped strings."""
    cleaned = dict(record)
    cleaned["title"] = (cleaned.get("title") or "").strip()
    cleaned["text"] = (cleaned.get("text") or "").strip()
    return cleaned


def clean_news_record(record: dict) -> dict:
    """Return a copy with None/whitespace text fields normalised to stripped strings."""
    cleaned = dict(record)
    cleaned["title"] = (cleaned.get("title") or "").strip()
    cleaned["description"] = (cleaned.get("description") or "").strip()
    return cleaned


def clean_weather_record(record: dict) -> dict:
    """Return a copy with the location name normalised to a stripped string."""
    cleaned = dict(record)
    cleaned["location"] = (cleaned.get("location") or "").strip()
    return cleaned


def clean_crypto_record(record: dict) -> dict:
    """Return a copy with the coin id normalised to a stripped string."""
    cleaned = dict(record)
    cleaned["coin_id"] = (cleaned.get("coin_id") or "").strip()
    return cleaned


def clean_github_record(record: dict) -> dict:
    """Return a copy with None/whitespace text fields normalised to stripped strings."""
    cleaned = dict(record)
    cleaned["full_name"] = (cleaned.get("full_name") or "").strip()
    cleaned["description"] = (cleaned.get("description") or "").strip()
    return cleaned


def clean_gmail_record(record: dict) -> dict:
    """Return a copy with None/whitespace text fields normalised to stripped strings."""
    cleaned = dict(record)
    cleaned["subject"] = (cleaned.get("subject") or "").strip()
    cleaned["from_address"] = (cleaned.get("from_address") or "").strip()
    cleaned["snippet"] = (cleaned.get("snippet") or "").strip()
    return cleaned


# Free-text columns that are stored normalized (see common/text_normalize.py). full_name is an
# identifier used in joins, and gmail is private and not indexed, so neither is touched.
NORMALIZED_COLUMNS = {
    "hackernews": ("title", "text"),
    "news": ("title", "description"),
    "github": ("description",),
}


def normalize_text_columns(records: list[dict], source: str) -> list[dict]:
    """Normalize the source's free-text columns in place; keywords must already be attached."""
    for record in records:
        for column in NORMALIZED_COLUMNS.get(source, ()):
            record[column] = normalize_text(record.get(column))
    return records


def transform_records(source: str, records: list[dict]) -> list[dict]:
    """Clean, dedup on the source's id field, and tag keywords; raises on an unknown source."""
    if source == "hackernews":
        cleaned = dedup_records([clean_hackernews_record(r) for r in records], "story_id")
        return normalize_text_columns(attach_keywords(cleaned, source), source)
    elif source == "news":
        cleaned = dedup_records([clean_news_record(r) for r in records], "article_id")
        return normalize_text_columns(attach_keywords(cleaned, source), source)
    elif source == "weather":
        # Numeric readings have no text to extract from; an empty "keywords" column
        # keeps write_parquet source-agnostic.
        cleaned = dedup_records([clean_weather_record(r) for r in records], "weather_id")
        for record in cleaned:
            record["keywords"] = []
        return cleaned
    elif source == "crypto":
        cleaned = dedup_records([clean_crypto_record(r) for r in records], "price_id")
        for record in cleaned:
            record["keywords"] = []
        return cleaned
    elif source == "github":
        cleaned = dedup_records([clean_github_record(r) for r in records], "repo_id")
        return normalize_text_columns(attach_keywords(cleaned, source), source)
    elif source == "gmail":
        cleaned = dedup_records([clean_gmail_record(r) for r in records], "message_id")
        return attach_email_labels(attach_keywords(cleaned, source))
    else:
        raise ValueError(f"Unknown source: {source}")


# Losing more than 80% of a batch to dedup usually means an upstream API changed shape
# (e.g. the id field came back empty for every record, collapsing them onto one key),
# not genuine duplicates. The minimum batch size rules out small-sample noise; for
# batches under 6 records only the zero-output check can actually fire.
DUPLICATE_COLLAPSE_MIN_RAW_RECORDS = 3
DUPLICATE_COLLAPSE_RATE_THRESHOLD = 0.8


def detect_data_quality_issues(raw_records: list[dict], cleaned_records: list[dict]) -> list[str]:
    """Source-agnostic before/after count checks; returns alert reasons (empty if none)."""
    raw_count = len(raw_records)
    cleaned_count = len(cleaned_records)

    if raw_count == 0:
        return []

    if cleaned_count == 0:
        return [f"zero output records from {raw_count} raw record(s)"]

    if raw_count >= DUPLICATE_COLLAPSE_MIN_RAW_RECORDS:
        collapse_rate = (raw_count - cleaned_count) / raw_count
        if collapse_rate > DUPLICATE_COLLAPSE_RATE_THRESHOLD:
            return [
                f"{collapse_rate:.0%} of {raw_count} raw record(s) collapsed to "
                f"{cleaned_count} after cleaning/dedup"
            ]

    return []


def source_from_key(key: str) -> str:
    """Read the source name from a raw key's leading "source=<name>/" partition."""
    match = re.match(r"source=([^/]+)/", key)
    if not match:
        raise ValueError(f"Cannot determine source from key: {key}")
    return match.group(1)


def decode_s3_event_key(key: str) -> str:
    """Undo the URL-encoding S3 event notifications apply to keys ("=" -> "%3D", " " -> "+")."""
    return unquote_plus(key)


def read_ndjson(bucket: str, key: str) -> list[dict]:
    """Read a newline-delimited JSON object from S3, skipping blank lines."""
    body = _client().get_object(Bucket=bucket, Key=key)["Body"].read().decode("utf-8")
    return [json.loads(line) for line in body.splitlines() if line.strip()]


def build_curated_key(source: str, ts: datetime) -> str:
    """Hive-partitioned curated key; the random suffix keeps same-second writes distinct."""
    return (
        f"source={source}/year={ts:%Y}/month={ts:%m}/day={ts:%d}/"
        f"{ts:%Y%m%dT%H%M%S}-{uuid.uuid4().hex[:8]}.parquet"
    )


def write_parquet(records: list[dict], source: str) -> str:
    """Write records as Parquet to the curated bucket (or local_output_curated/ in dry runs).

    Returns the curated key, or "" when there is nothing to write.
    """
    if not records:
        return ""

    df = pd.DataFrame(records)
    # Stored as a comma-joined string because the Glue/Athena schema declares
    # keywords as a string column, not an array.
    df["keywords"] = df["keywords"].apply(lambda kw: ",".join(kw) if isinstance(kw, list) else kw)
    # Label columns get explicit types: an all-NULL column would otherwise be written as a
    # typeless column, and Athena would see the schema flip between files.
    for column in ("category", "urgency", "deadline", "job_stage", "company"):
        if column in df.columns:
            df[column] = df[column].astype("string")
    if "needs_reply" in df.columns:
        df["needs_reply"] = df["needs_reply"].astype("boolean")

    key = build_curated_key(source, datetime.now(timezone.utc))
    # /tmp is the only writable path in Lambda.
    local_path = f"/tmp/{uuid.uuid4().hex}.parquet"
    df.to_parquet(local_path, engine="pyarrow", index=False)

    try:
        if config.DRY_RUN or not config.CURATED_BUCKET:
            dest = os.path.join("local_output_curated", key)
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            os.replace(local_path, dest)
            return key

        _client().upload_file(local_path, config.CURATED_BUCKET, key)
        return key
    finally:
        if os.path.exists(local_path):
            os.remove(local_path)


def lambda_handler(event, context):
    """Transform every raw object in an S3 event batch and log any data-quality alerts."""
    results = []
    for record in event.get("Records", []):
        bucket = record["s3"]["bucket"]["name"]
        key = decode_s3_event_key(record["s3"]["object"]["key"])
        source = source_from_key(key)

        raw_records = read_ndjson(bucket, key)
        cleaned = transform_records(source, raw_records)

        # The DATA_QUALITY_ALERT prefix is what the CloudWatch metric filter matches.
        for issue in detect_data_quality_issues(raw_records, cleaned):
            logger.warning("DATA_QUALITY_ALERT source=%s reason=%s", source, issue)

        curated_key = write_parquet(cleaned, source)

        logger.info(
            "Transformed %d -> %d records from %s to %s",
            len(raw_records), len(cleaned), key, curated_key,
        )
        results.append(
            {"source": source, "input_key": key, "output_key": curated_key, "records": len(cleaned)}
        )

    return {"statusCode": 200, "results": results}
