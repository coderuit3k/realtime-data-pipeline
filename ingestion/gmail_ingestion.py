import base64
import logging
from datetime import datetime, timezone
from email import message_from_bytes
from email.header import decode_header

import boto3
import requests
from botocore.config import Config
from botocore.exceptions import ClientError

from common import config
from common.s3_writer import write_records
from common.secrets import get_secret

logger = logging.getLogger()
logger.setLevel(logging.INFO)

GMAIL_TOKEN_URL = "https://oauth2.googleapis.com/token"
GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me"


def _safe_decode(raw_bytes: bytes, charset: str | None) -> str:
    try:
        return raw_bytes.decode(charset or "utf-8", errors="replace")
    except (LookupError, TypeError):
        return raw_bytes.decode("utf-8", errors="replace")


def _decode_header_value(raw_value: str | None) -> str:
    if not raw_value:
        return ""
    parts = decode_header(raw_value)
    return "".join(
        _safe_decode(part, encoding) if isinstance(part, bytes) else part
        for part, encoding in parts
    )


def _extract_snippet(parsed_email, max_len: int = 200) -> str:
    if parsed_email.is_multipart():
        for part in parsed_email.walk():
            if part.get_content_type() == "text/plain":
                body = part.get_payload(decode=True) or b""
                return _safe_decode(body, part.get_content_charset())[:max_len].strip()
        return ""
    if parsed_email.get_content_type() == "text/plain":
        body = parsed_email.get_payload(decode=True) or b""
        return _safe_decode(body, parsed_email.get_content_charset())[:max_len].strip()
    return ""


def get_access_token(creds: dict) -> str:
    response = requests.post(
        GMAIL_TOKEN_URL,
        data={
            "client_id": creds["client_id"],
            "client_secret": creds["client_secret"],
            "refresh_token": creds["refresh_token"],
            "grant_type": "refresh_token",
        },
        timeout=10,
    )
    response.raise_for_status()
    return response.json()["access_token"]


def archive_to_r2(client, bucket: str, message_id: str, raw_bytes: bytes) -> None:
    key = f"messages/{message_id}.eml"
    try:
        client.head_object(Bucket=bucket, Key=key)
        return  # already archived in a prior run -- skip re-upload
    except ClientError as error:
        if error.response.get("Error", {}).get("Code") not in ("404", "NoSuchKey"):
            raise
    client.put_object(Bucket=bucket, Key=key, Body=raw_bytes, ContentType="message/rfc822")


def normalize_message(message_id: str, raw_response: dict) -> tuple[bytes, dict]:
    raw_bytes = base64.urlsafe_b64decode(raw_response["raw"] + "==")
    parsed = message_from_bytes(raw_bytes)

    internal_date_ms = int(raw_response.get("internalDate", "0"))
    received_at = (
        datetime.fromtimestamp(internal_date_ms / 1000, tz=timezone.utc).isoformat()
        if internal_date_ms
        else None
    )

    record = {
        "message_id": message_id,
        "source": "gmail",
        "subject": _decode_header_value(parsed.get("Subject")),
        "from_address": _decode_header_value(parsed.get("From")),
        "snippet": _extract_snippet(parsed),
        "received_at": received_at,
        "ingested_at": datetime.now(timezone.utc).isoformat(),
    }
    return raw_bytes, record


def fetch_message_ids(access_token: str, limit: int) -> list[str]:
    response = requests.get(
        f"{GMAIL_API_BASE}/messages",
        params={"maxResults": limit},
        headers={"Authorization": f"Bearer {access_token}"},
        timeout=10,
    )
    response.raise_for_status()
    return [m["id"] for m in response.json().get("messages", [])]


def fetch_raw_message(access_token: str, message_id: str) -> dict:
    response = requests.get(
        f"{GMAIL_API_BASE}/messages/{message_id}",
        params={"format": "raw"},
        headers={"Authorization": f"Bearer {access_token}"},
        timeout=10,
    )
    response.raise_for_status()
    return response.json()


def get_r2_client(creds: dict):
    # R2 doesn't support the AWS-specific checksum headers botocore >=1.36 sends
    # by default (e.g. x-amz-checksum-crc32), which makes PutObject fail against
    # non-AWS S3-compatible endpoints unless we opt back into the old behavior.
    return boto3.client(
        "s3",
        endpoint_url=f"https://{creds['r2_account_id']}.r2.cloudflarestorage.com",
        aws_access_key_id=creds["r2_access_key_id"],
        aws_secret_access_key=creds["r2_secret_access_key"],
        region_name="auto",
        config=Config(
            request_checksum_calculation="when_required",
            response_checksum_validation="when_required",
        ),
    )


def fetch_and_archive_messages() -> list[dict]:
    creds = get_secret(config.GMAIL_SECRET_NAME)
    access_token = get_access_token(creds)
    r2_client = get_r2_client(creds)

    records = []
    for message_id in fetch_message_ids(access_token, config.GMAIL_MESSAGE_LIMIT):
        try:
            raw_response = fetch_raw_message(access_token, message_id)
            raw_bytes, record = normalize_message(message_id, raw_response)
        except Exception:
            logger.exception("Failed to fetch/normalize message %s -- skipping", message_id)
            continue
        try:
            archive_to_r2(r2_client, config.GMAIL_R2_BUCKET_NAME, message_id, raw_bytes)
        except Exception:
            logger.exception("R2 archive failed for message %s -- continuing", message_id)
        records.append(record)
    return records


def lambda_handler(event, context):
    records = fetch_and_archive_messages()
    key = write_records("gmail", records, "message_id")
    logger.info("Wrote %d records to %s", len(records), key)
    return {"statusCode": 200, "records_ingested": len(records), "s3_key": key}


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    print(lambda_handler({}, None))
