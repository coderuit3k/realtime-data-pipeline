"""DynamoDB cache of Gmail classifier labels, keyed by message_id.

gmail_ingestion re-ingests the newest emails on every run, so the same message reaches the
transform Lambda dozens of times. The first run labels it (one Bedrock call for all new ones);
every later run reads the labels from here.
"""

import time

import boto3

from common import config
from common.email_labels import LABEL_FIELDS

BATCH_GET_LIMIT = 100  # DynamoDB BatchGetItem accepts at most 100 keys
MAX_ATTEMPTS = 3  # for keys DynamoDB returns as unprocessed
RETRY_DELAY_SECONDS = 0.2

_dynamodb_resource = None


def _dynamodb():
    """Created on first use and reused across warm Lambda invocations."""
    global _dynamodb_resource
    if _dynamodb_resource is None:
        _dynamodb_resource = boto3.resource("dynamodb", region_name=config.AWS_REGION)
    return _dynamodb_resource


def get_cached_labels(message_ids: list[str]) -> dict[str, dict]:
    """Labels already stored for these ids; ids that are missing (or unprocessed) are absent."""
    table_name = config.GMAIL_LABELS_TABLE
    unique_ids = list(dict.fromkeys(message_ids))
    if not table_name or not unique_ids:
        return {}

    found: dict[str, dict] = {}
    for start in range(0, len(unique_ids), BATCH_GET_LIMIT):
        keys = [{"message_id": mid} for mid in unique_ids[start : start + BATCH_GET_LIMIT]]
        for attempt in range(MAX_ATTEMPTS):
            response = _dynamodb().batch_get_item(RequestItems={table_name: {"Keys": keys}})
            for item in response["Responses"].get(table_name, []):
                found[item["message_id"]] = {field: item.get(field) for field in LABEL_FIELDS}
            keys = response.get("UnprocessedKeys", {}).get(table_name, {}).get("Keys", [])
            if not keys:
                break
            if attempt < MAX_ATTEMPTS - 1:
                time.sleep(RETRY_DELAY_SECONDS)
    return found


def put_labels(labels_by_id: dict[str, dict]) -> None:
    """Store labels (the six label fields only, never any email text) under their message_id."""
    table_name = config.GMAIL_LABELS_TABLE
    if not table_name or not labels_by_id:
        return
    with _dynamodb().Table(table_name).batch_writer() as writer:
        for message_id, label in labels_by_id.items():
            writer.put_item(
                Item={"message_id": message_id, **{f: label.get(f) for f in LABEL_FIELDS}}
            )
