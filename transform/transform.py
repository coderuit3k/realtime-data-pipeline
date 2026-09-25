import json
import logging
import os
import re
import uuid
from collections import Counter
from datetime import datetime, timezone
from urllib.parse import unquote_plus

import boto3
import pandas as pd

from common import config

logger = logging.getLogger()
logger.setLevel(logging.INFO)

_s3_client = None
_bedrock_client = None

STOPWORDS = {
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "is", "are", "was", "were", "this", "that", "these", "those",
    "with", "it", "its", "as", "be", "been", "being", "by", "from",
    "has", "have", "had", "having", "not", "no", "nor", "will", "would",
    "can", "could", "shall", "should", "may", "might", "must", "do",
    "does", "did", "doing", "than", "then", "there", "here", "when",
    "where", "which", "while", "who", "whom", "whose", "why", "how",
    "what", "about", "above", "after", "again", "against", "all", "am",
    "any", "because", "before", "below", "between", "both", "each",
    "few", "further", "he", "her", "hers", "him", "himself", "his",
    "into", "just", "me", "more", "most", "my", "myself", "once",
    "only", "other", "our", "ours", "out", "over", "own", "same", "she",
    "so", "some", "such", "that", "their", "theirs", "them",
    "themselves", "they", "through", "too", "under", "until", "up",
    "very", "we", "you", "your", "yours", "yourself", "yourselves",
    "i", "if", "off", "down", "during", "second", "third", "first",
    "many", "much", "one", "two", "three", "also", "still", "even",
    "now", "get", "gets", "got", "like", "make", "makes", "made",
    "new", "way", "back", "using", "used", "use", "says", "said",
}


def _client():
    global _s3_client
    if _s3_client is None:
        _s3_client = boto3.client("s3", region_name=config.AWS_REGION)
    return _s3_client


def _bedrock():
    global _bedrock_client
    if _bedrock_client is None:
        _bedrock_client = boto3.client("bedrock-runtime", region_name=config.AWS_REGION)
    return _bedrock_client


def extract_keywords(text: str, top_n: int = 5) -> list[str]:
    """Regex + stopword fallback -- used when the LLM extraction below fails."""
    words = re.findall(r"[a-zA-Z]{4,}", (text or "").lower())
    words = [w for w in words if w not in STOPWORDS]
    return [word for word, _ in Counter(words).most_common(top_n)]


def build_keyword_prompt(texts: list[str]) -> str:
    items = "\n".join(f"[{i + 1}] {text[:300]}" for i, text in enumerate(texts))
    return (
        "For each numbered item below, extract up to 5 short topical keywords "
        "(lowercase, comma-separated, no generic filler words). Respond with ONLY "
        "a JSON array of strings -- one comma-separated keyword string per item, "
        "in the same order, no other text.\n\n"
        f"{items}"
    )


def parse_keyword_response(raw: str, expected_count: int) -> list[list[str]]:
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\n|\n```$", "", cleaned)
    keyword_strings = json.loads(cleaned)
    if not isinstance(keyword_strings, list) or len(keyword_strings) != expected_count:
        raise ValueError(f"Expected {expected_count} keyword strings, got: {keyword_strings!r}")
    return [[kw.strip().lower() for kw in ks.split(",") if kw.strip()] for ks in keyword_strings]


def extract_keywords_llm(texts: list[str]) -> list[list[str]]:
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
    return parse_keyword_response(body["content"][0]["text"], len(texts))


def record_text(record: dict, source: str) -> str:
    if source == "hackernews":
        return f"{record.get('title') or ''} {record.get('text') or ''}".strip()
    if source == "github":
        return f"{record.get('full_name') or ''} {record.get('description') or ''}".strip()
    if source == "gmail":
        return f"{record.get('subject') or ''} {record.get('snippet') or ''}".strip()
    return f"{record.get('title') or ''} {record.get('description') or ''}".strip()


def attach_keywords(records: list[dict], source: str) -> list[dict]:
    texts = [record_text(r, source) for r in records]
    try:
        keyword_lists = extract_keywords_llm(texts)
    except Exception:
        logger.exception("LLM keyword extraction failed, falling back to regex")
        keyword_lists = [extract_keywords(text) for text in texts]

    for record, keywords in zip(records, keyword_lists):
        record["keywords"] = keywords
    return records


def dedup_records(records: list[dict], id_field: str) -> list[dict]:
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
    cleaned = dict(record)
    cleaned["title"] = (cleaned.get("title") or "").strip()
    cleaned["text"] = (cleaned.get("text") or "").strip()
    return cleaned


def clean_news_record(record: dict) -> dict:
    cleaned = dict(record)
    cleaned["title"] = (cleaned.get("title") or "").strip()
    cleaned["description"] = (cleaned.get("description") or "").strip()
    return cleaned


def clean_weather_record(record: dict) -> dict:
    cleaned = dict(record)
    cleaned["location"] = (cleaned.get("location") or "").strip()
    return cleaned


def clean_crypto_record(record: dict) -> dict:
    cleaned = dict(record)
    cleaned["coin_id"] = (cleaned.get("coin_id") or "").strip()
    return cleaned


def clean_github_record(record: dict) -> dict:
    cleaned = dict(record)
    cleaned["full_name"] = (cleaned.get("full_name") or "").strip()
    cleaned["description"] = (cleaned.get("description") or "").strip()
    return cleaned


def clean_gmail_record(record: dict) -> dict:
    cleaned = dict(record)
    cleaned["subject"] = (cleaned.get("subject") or "").strip()
    cleaned["from_address"] = (cleaned.get("from_address") or "").strip()
    cleaned["snippet"] = (cleaned.get("snippet") or "").strip()
    return cleaned


def transform_records(source: str, records: list[dict]) -> list[dict]:
    if source == "hackernews":
        cleaned = dedup_records([clean_hackernews_record(r) for r in records], "story_id")
        return attach_keywords(cleaned, source)
    elif source == "news":
        cleaned = dedup_records([clean_news_record(r) for r in records], "article_id")
        return attach_keywords(cleaned, source)
    elif source == "weather":
        # Numeric readings, no natural-language text -- LLM/regex keyword
        # extraction doesn't apply. "keywords" is set (empty) purely so
        # write_parquet's column access below doesn't need a source-specific branch.
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
        return attach_keywords(cleaned, source)
    elif source == "gmail":
        cleaned = dedup_records([clean_gmail_record(r) for r in records], "message_id")
        return attach_keywords(cleaned, source)
    else:
        raise ValueError(f"Unknown source: {source}")


def source_from_key(key: str) -> str:
    match = re.match(r"source=([^/]+)/", key)
    if not match:
        raise ValueError(f"Cannot determine source from key: {key}")
    return match.group(1)


def decode_s3_event_key(key: str) -> str:
    """S3 event notifications URL-encode the object key (e.g. "=" -> "%3D",
    spaces -> "+"), unlike the S3 API itself. Must be undone before use."""
    return unquote_plus(key)


def read_ndjson(bucket: str, key: str) -> list[dict]:
    body = _client().get_object(Bucket=bucket, Key=key)["Body"].read().decode("utf-8")
    return [json.loads(line) for line in body.splitlines() if line.strip()]


def build_curated_key(source: str, ts: datetime) -> str:
    return (
        f"source={source}/year={ts:%Y}/month={ts:%m}/day={ts:%d}/"
        f"{ts:%Y%m%dT%H%M%S}-{uuid.uuid4().hex[:8]}.parquet"
    )


def write_parquet(records: list[dict], source: str) -> str:
    if not records:
        return ""

    df = pd.DataFrame(records)
    # Parquet has no native list type support via the plain pandas API path here,
    # so keywords travel as a comma-joined string instead of a Python list.
    df["keywords"] = df["keywords"].apply(lambda kw: ",".join(kw) if isinstance(kw, list) else kw)

    key = build_curated_key(source, datetime.now(timezone.utc))
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
    results = []
    for record in event.get("Records", []):
        bucket = record["s3"]["bucket"]["name"]
        key = decode_s3_event_key(record["s3"]["object"]["key"])
        source = source_from_key(key)

        raw_records = read_ndjson(bucket, key)
        cleaned = transform_records(source, raw_records)
        curated_key = write_parquet(cleaned, source)

        logger.info(
            "Transformed %d -> %d records from %s to %s",
            len(raw_records), len(cleaned), key, curated_key,
        )
        results.append(
            {"source": source, "input_key": key, "output_key": curated_key, "records": len(cleaned)}
        )

    return {"statusCode": 200, "results": results}
