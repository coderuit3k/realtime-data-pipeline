"""Lambda: ingests the latest Gmail messages and archives the raw .eml to Cloudflare R2.

Mail is read over IMAP with an app password (OAuth refresh tokens kept expiring). Only metadata
(subject, sender, short snippet) goes to the raw S3 zone; the full message lives in R2.
"""

import imaplib
import logging
import re
from datetime import datetime, timezone
from email import message_from_bytes
from email.header import decode_header

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from common import config
from common.s3_writer import write_records
from common.secrets import get_secret

logger = logging.getLogger()
logger.setLevel(logging.INFO)

IMAP_HOST = "imap.gmail.com"
IMAP_TIMEOUT_SECONDS = 30
INTERNALDATE_FORMAT = "%d-%b-%Y %H:%M:%S %z"


def _safe_decode(raw_bytes: bytes, charset: str | None) -> str:
    """Decode with the declared charset, falling back to UTF-8 when it is bogus or unknown."""
    try:
        return raw_bytes.decode(charset or "utf-8", errors="replace")
    except (LookupError, TypeError):
        return raw_bytes.decode("utf-8", errors="replace")


def _decode_header_value(raw_value: str | None) -> str:
    """Decode RFC 2047 encoded-words (e.g. =?UTF-8?B?...?=) into plain text."""
    if not raw_value:
        return ""
    parts = decode_header(raw_value)
    return "".join(
        _safe_decode(part, encoding) if isinstance(part, bytes) else part
        for part, encoding in parts
    )


def _extract_snippet(parsed_email, max_len: int = 200) -> str:
    """First max_len chars of the first text/plain part; "" for HTML-only mail."""
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


def archive_to_r2(client, bucket: str, message_id: str, raw_bytes: bytes) -> None:
    """Upload the raw message unless an earlier run already archived it."""
    key = f"messages/{message_id}.eml"
    try:
        client.head_object(Bucket=bucket, Key=key)
        return
    except ClientError as error:
        if error.response.get("Error", {}).get("Code") not in ("404", "NoSuchKey"):
            raise
    client.put_object(Bucket=bucket, Key=key, Body=raw_bytes, ContentType="message/rfc822")


def normalize_message(
    message_id: str, raw_bytes: bytes, received_at: datetime | None
) -> tuple[bytes, dict]:
    """Return (raw .eml bytes, raw gmail record) for one message's RFC 822 source."""
    parsed = message_from_bytes(raw_bytes)
    record = {
        "message_id": message_id,
        "source": "gmail",
        "subject": _decode_header_value(parsed.get("Subject")),
        "from_address": _decode_header_value(parsed.get("From")),
        "snippet": _extract_snippet(parsed),
        "received_at": received_at.astimezone(timezone.utc).isoformat() if received_at else None,
        "ingested_at": datetime.now(timezone.utc).isoformat(),
    }
    return raw_bytes, record


def connect_imap(creds: dict):
    """Log in with the app password and open the inbox read-only (reading never marks mail seen)."""
    conn = imaplib.IMAP4_SSL(IMAP_HOST, timeout=IMAP_TIMEOUT_SECONDS)
    conn.login(creds["imap_user"], creds["imap_password"])
    conn.select("INBOX", readonly=True)
    return conn


def fetch_message_ids(conn, limit: int) -> list[bytes]:
    """Sequence numbers of the newest `limit` messages in the inbox, newest first."""
    _, data = conn.search(None, "ALL")
    numbers = data[0].split()
    return list(reversed(numbers[-limit:])) if limit > 0 else []


def fetch_raw_message(conn, number: bytes) -> dict:
    """One message's Gmail API id, full RFC 822 source and arrival time.

    X-GM-MSGID is Gmail's message id; its hex form is the id the Gmail API used, so ids (and the
    R2 keys built from them) stay the same as before IMAP.
    """
    _, data = conn.fetch(number, "(X-GM-MSGID INTERNALDATE BODY.PEEK[])")
    raw = data[0][1]
    # The attributes may sit before or after the body literal, so search every non-body part.
    head_text = b" ".join(
        item[0] if isinstance(item, tuple) else item for item in data
    ).decode("ascii", errors="replace")
    gm_id = int(re.search(r"X-GM-MSGID (\d+)", head_text).group(1))
    date = re.search(r'INTERNALDATE "([^"]+)"', head_text)
    return {
        "id": format(gm_id, "x"),
        "raw": raw,
        "received_at": datetime.strptime(date.group(1), INTERNALDATE_FORMAT).astimezone(
            timezone.utc
        )
        if date
        else None,
    }


def get_r2_client(creds: dict):
    """S3 client pointed at Cloudflare R2.

    The "when_required" checksum settings are needed: botocore >=1.36 sends
    AWS-only checksum headers (x-amz-checksum-crc32) by default, which R2
    rejects, failing every PutObject.
    """
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
    """Fetch, normalize and archive the latest messages; returns their records.

    A message that fails to fetch is skipped, but an R2 archive failure still
    keeps its record -- losing the archive copy shouldn't drop the metadata.
    """
    creds = get_secret(config.GMAIL_SECRET_NAME)
    r2_client = get_r2_client(creds)
    conn = connect_imap(creds)

    records = []
    try:
        for number in fetch_message_ids(conn, config.GMAIL_MESSAGE_LIMIT):
            try:
                message = fetch_raw_message(conn, number)
                raw_bytes, record = normalize_message(
                    message["id"], message["raw"], message["received_at"]
                )
            except Exception:
                logger.exception("Failed to fetch/normalize message %s -- skipping", number)
                continue
            try:
                archive_to_r2(r2_client, config.GMAIL_R2_BUCKET_NAME, message["id"], raw_bytes)
            except Exception:
                logger.exception("R2 archive failed for message %s -- continuing", message["id"])
            records.append(record)
    finally:
        try:
            conn.logout()
        except Exception:
            logger.warning("IMAP logout failed", exc_info=True)
    return records


def lambda_handler(event, context):
    """Scheduled entry point: ingest the latest messages into the raw zone."""
    records = fetch_and_archive_messages()
    key = write_records("gmail", records, "message_id")
    logger.info("Wrote %d records to %s", len(records), key)
    return {"statusCode": 200, "records_ingested": len(records), "s3_key": key}


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    print(lambda_handler({}, None))
