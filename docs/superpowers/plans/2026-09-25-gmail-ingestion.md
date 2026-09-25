# Gmail Ingestion (Backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real 6th ingestion source — a `gmail_ingestion` Lambda that pulls the latest messages from a real Gmail inbox via the Gmail API, archives each message's full raw content to the Cloudflare R2 `mail` bucket, and writes structured fields into the same AWS S3 raw→curated→Glue→Athena pipeline the other 5 sources already use.

**Architecture:** Plain REST calls via `requests` (Gmail's OAuth2 token endpoint + Gmail API — no `google-api-python-client`/`google-auth` dependency), Python's stdlib `email` module to parse the raw RFC822 message locally, and `boto3` (already provided by the Lambda runtime) pointed at R2's S3-compatible endpoint for the archive upload. Structured records flow through the existing `common.s3_writer.write_records` → `transform` Lambda → Glue/Athena path unchanged.

**Tech Stack:** Python 3.12 (Lambda), `requests`, `boto3`, Terraform (5 files touched).

**Spec:** `docs/superpowers/specs/2026-09-25-gmail-ingestion-design.md`

## Global Constraints

- No new pip dependency in any Lambda zip — `requests` only (already every ingestion Lambda's sole third-party dependency, per `scripts/build_lambdas.sh`'s `package_with_requests`).
- No "since last run" cursor/state — fetch the latest `GMAIL_MESSAGE_LIMIT` (default 50) messages every run, same accepted cross-run-duplicate pattern as `ingestion/hackernews_ingestion.py`.
- `gmail_ingestion` gets its own EventBridge rule at `rate(4 hours)` (`var.gmail_ingestion_schedule`), never the shared 30-minute `ingestion_schedule` rule.
- Every AWS/R2-touching function takes its client as its first parameter (dependency injection) — this project's established testability pattern (e.g. `common/s3_writer.py`'s `write_records`, `web/lib/eventbridge.ts`'s `getScheduleStatus`).
- Real credentials (Gmail OAuth2 client_id/client_secret/refresh_token, R2 account id/access key/secret key) live in one AWS Secrets Manager secret (`${name_prefix}/gmail-ingestion`) that the user populates themselves via `aws secretsmanager put-secret-value` — no task in this plan ever invents, requests, or handles a real credential value.
- The R2 bucket name (`GMAIL_R2_BUCKET_NAME`) is a plain Lambda env var, not a secret value (mirrors `R2_EXCEL_BUCKET_NAME` being a plain Vercel env var for the Excel export feature).
- No `web/` changes anywhere in this plan (RAG index inclusion and "6 nguồn" web copy is a separate, later sub-project).
- Terraform's only automated check is `terraform validate`/`terraform fmt -check` (run in CI already) — no unit tests for `.tf` files; real verification is a real `terraform plan`/`apply` the user runs and approves, same as every other infra change this project has shipped.

## Review Focus

- **A non-ASCII/RFC-2047-encoded Subject header must decode to real text**, not show up as literal `=?UTF-8?B?...?=` — pinned by Task 1's encoded-header test.
- **A message with no readable `text/plain` part (HTML-only) must not crash** snippet extraction — pinned by Task 1's no-text-part test.
- **Re-ingesting a message still in the latest 50 on a later run must not re-upload it to R2** — pinned by Task 1's `archive_to_r2` "already exists" test.
- **The very first real `source=gmail/...` object written must not break the shared `transform` Lambda** — the S3 notification (`infra/s3_notification.tf`) has no prefix filter, so it fires unconditionally; pinned by Task 2's new `"gmail"` case in `transform_records()`.
- **An R2 archive failure for one message must not lose that message's structured data** — pinned by Task 1's test where `archive_to_r2` raises for one message but the returned record list still includes it.

---

### Task 1: `ingestion/gmail_ingestion.py` — the ingestion module

**Files:**
- Modify: `common/config.py` (add `GMAIL_SECRET_NAME`, `GMAIL_MESSAGE_LIMIT`, `GMAIL_R2_BUCKET_NAME`)
- Create: `ingestion/gmail_ingestion.py`
- Test: `tests/test_gmail_ingestion.py`

**Interfaces:**
- Consumes: `common.secrets.get_secret(secret_name: str) -> dict` (existing, unchanged), `common.s3_writer.write_records(source: str, records: list[dict], key_field: str) -> str` (existing, unchanged).
- Produces: `normalize_message(message_id: str, raw_response: dict) -> tuple[bytes, dict]`, `archive_to_r2(client, bucket: str, message_id: str, raw_bytes: bytes) -> None`, `fetch_and_archive_messages() -> list[dict]`, `lambda_handler(event, context)` — no other task imports these directly (Task 2 only cares about the record shape `{message_id, source, subject, from_address, snippet, received_at, ingested_at}` this module writes to S3, not its functions).

- [ ] **Step 1: Add the 3 new config constants**

Open `common/config.py` and add, after the existing `GITHUB_TRENDING_LIMIT` line:

```python
GMAIL_SECRET_NAME = os.environ.get("GMAIL_SECRET_NAME", "data-pipeline/gmail-ingestion")
GMAIL_MESSAGE_LIMIT = int(os.environ.get("GMAIL_MESSAGE_LIMIT", "50"))
GMAIL_R2_BUCKET_NAME = os.environ.get("GMAIL_R2_BUCKET_NAME", "")
```

- [ ] **Step 2: Write the failing tests for `normalize_message`**

Create `tests/test_gmail_ingestion.py`:

```python
import base64
from email.header import Header
from email.message import EmailMessage

from ingestion.gmail_ingestion import normalize_message


def _raw_response(msg: EmailMessage, internal_date_ms: int = 1700000000000) -> dict:
    raw_bytes = msg.as_bytes()
    return {
        "raw": base64.urlsafe_b64encode(raw_bytes).decode("ascii").rstrip("="),
        "internalDate": str(internal_date_ms),
    }


def test_normalize_message_maps_plain_fields():
    msg = EmailMessage()
    msg["Subject"] = "Weekly digest"
    msg["From"] = "news@example.com"
    msg.set_content("Hello, this is the body text.")

    raw_bytes, record = normalize_message("msg-1", _raw_response(msg))

    assert record["message_id"] == "msg-1"
    assert record["source"] == "gmail"
    assert record["subject"] == "Weekly digest"
    assert record["from_address"] == "news@example.com"
    assert record["snippet"] == "Hello, this is the body text."
    assert record["received_at"] == "2023-11-14T22:13:20+00:00"
    assert "ingested_at" in record
    assert isinstance(raw_bytes, bytes)


def test_normalize_message_decodes_rfc2047_encoded_subject():
    msg = EmailMessage()
    msg["Subject"] = Header("Xin chào bạn", "utf-8").encode()
    msg["From"] = "a@example.com"
    msg.set_content("body")

    _, record = normalize_message("msg-2", _raw_response(msg))

    assert record["subject"] == "Xin chào bạn"


def test_normalize_message_snippet_is_empty_when_no_text_plain_part():
    msg = EmailMessage()
    msg["Subject"] = "HTML only"
    msg["From"] = "a@example.com"
    msg.set_content("<p>hi</p>", subtype="html")

    _, record = normalize_message("msg-3", _raw_response(msg))

    assert record["snippet"] == ""


def test_normalize_message_truncates_long_snippet_to_200_chars():
    msg = EmailMessage()
    msg["Subject"] = "Long body"
    msg["From"] = "a@example.com"
    msg.set_content("x" * 500)

    _, record = normalize_message("msg-4", _raw_response(msg))

    assert len(record["snippet"]) == 200
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_gmail_ingestion.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'ingestion.gmail_ingestion'`.

- [ ] **Step 4: Write `normalize_message` and its helpers**

Create `ingestion/gmail_ingestion.py`:

```python
import base64
import logging
from datetime import datetime, timezone
from email import message_from_bytes
from email.header import decode_header

import requests
from botocore.exceptions import ClientError

from common import config
from common.s3_writer import write_records
from common.secrets import get_secret

logger = logging.getLogger()
logger.setLevel(logging.INFO)

GMAIL_TOKEN_URL = "https://oauth2.googleapis.com/token"
GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me"


def _decode_header_value(raw_value: str | None) -> str:
    if not raw_value:
        return ""
    parts = decode_header(raw_value)
    return "".join(
        part.decode(encoding or "utf-8", errors="replace") if isinstance(part, bytes) else part
        for part, encoding in parts
    )


def _extract_snippet(parsed_email, max_len: int = 200) -> str:
    if parsed_email.is_multipart():
        for part in parsed_email.walk():
            if part.get_content_type() == "text/plain":
                body = part.get_payload(decode=True) or b""
                return body.decode(part.get_content_charset() or "utf-8", errors="replace")[:max_len].strip()
        return ""
    if parsed_email.get_content_type() == "text/plain":
        body = parsed_email.get_payload(decode=True) or b""
        return body.decode(parsed_email.get_content_charset() or "utf-8", errors="replace")[:max_len].strip()
    return ""


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
```

Note: `test_normalize_message_maps_plain_fields`'s base64 payload is built via
`base64.urlsafe_b64encode(...).rstrip("=")` (matching Gmail's own unpadded
base64url convention), and `normalize_message` re-adds `"=="` padding before
decoding — always safe since `urlsafe_b64decode` ignores excess padding.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_gmail_ingestion.py -v`
Expected: PASS (4 tests).

- [ ] **Step 6: Write the failing test for `get_access_token`**

Append to `tests/test_gmail_ingestion.py`:

```python
from unittest.mock import MagicMock, patch

from ingestion.gmail_ingestion import get_access_token


@patch("ingestion.gmail_ingestion.requests.post")
def test_get_access_token_sends_refresh_token_grant(mock_post):
    mock_response = MagicMock()
    mock_response.json.return_value = {"access_token": "real-token-123"}
    mock_post.return_value = mock_response

    token = get_access_token({
        "client_id": "cid",
        "client_secret": "csecret",
        "refresh_token": "rtoken",
    })

    assert token == "real-token-123"
    _, kwargs = mock_post.call_args
    assert kwargs["data"] == {
        "client_id": "cid",
        "client_secret": "csecret",
        "refresh_token": "rtoken",
        "grant_type": "refresh_token",
    }
```

- [ ] **Step 7: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_gmail_ingestion.py::test_get_access_token_sends_refresh_token_grant -v`
Expected: FAIL with `ImportError: cannot import name 'get_access_token'`.

- [ ] **Step 8: Implement `get_access_token`**

Add to `ingestion/gmail_ingestion.py` (after the imports, before `normalize_message` or anywhere in the module):

```python
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
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_gmail_ingestion.py::test_get_access_token_sends_refresh_token_grant -v`
Expected: PASS.

- [ ] **Step 10: Write the failing tests for `archive_to_r2`**

Append to `tests/test_gmail_ingestion.py`:

```python
from ingestion.gmail_ingestion import archive_to_r2


def test_archive_to_r2_skips_upload_when_object_already_exists():
    client = MagicMock()
    client.head_object.return_value = {}  # no exception -- object exists

    archive_to_r2(client, "mail-bucket", "msg-1", b"raw bytes")

    client.put_object.assert_not_called()


def test_archive_to_r2_uploads_when_object_is_missing():
    client = MagicMock()
    client.head_object.side_effect = ClientError(
        {"Error": {"Code": "404", "Message": "Not Found"}}, "HeadObject"
    )

    archive_to_r2(client, "mail-bucket", "msg-1", b"raw bytes")

    client.put_object.assert_called_once_with(
        Bucket="mail-bucket", Key="messages/msg-1.eml", Body=b"raw bytes", ContentType="message/rfc822"
    )


def test_archive_to_r2_reraises_non_404_errors():
    client = MagicMock()
    client.head_object.side_effect = ClientError(
        {"Error": {"Code": "403", "Message": "Forbidden"}}, "HeadObject"
    )

    try:
        archive_to_r2(client, "mail-bucket", "msg-1", b"raw bytes")
        assert False, "expected ClientError to propagate"
    except ClientError:
        pass
```

- [ ] **Step 11: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_gmail_ingestion.py -k archive_to_r2 -v`
Expected: FAIL with `ImportError: cannot import name 'archive_to_r2'`.

- [ ] **Step 12: Implement `archive_to_r2`**

Add to `ingestion/gmail_ingestion.py`:

```python
def archive_to_r2(client, bucket: str, message_id: str, raw_bytes: bytes) -> None:
    key = f"messages/{message_id}.eml"
    try:
        client.head_object(Bucket=bucket, Key=key)
        return  # already archived in a prior run -- skip re-upload
    except ClientError as error:
        if error.response.get("Error", {}).get("Code") not in ("404", "NoSuchKey"):
            raise
    client.put_object(Bucket=bucket, Key=key, Body=raw_bytes, ContentType="message/rfc822")
```

- [ ] **Step 13: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_gmail_ingestion.py -k archive_to_r2 -v`
Expected: PASS (3 tests).

- [ ] **Step 14: Write the failing tests for `fetch_message_ids`, `fetch_raw_message`, `fetch_and_archive_messages`, and `lambda_handler`**

Append to `tests/test_gmail_ingestion.py`:

```python
from ingestion.gmail_ingestion import (
    fetch_message_ids,
    fetch_raw_message,
    fetch_and_archive_messages,
    lambda_handler,
)


@patch("ingestion.gmail_ingestion.requests.get")
def test_fetch_message_ids_returns_ids_from_response(mock_get):
    mock_response = MagicMock()
    mock_response.json.return_value = {"messages": [{"id": "m1"}, {"id": "m2"}]}
    mock_get.return_value = mock_response

    ids = fetch_message_ids("token-x", 2)

    assert ids == ["m1", "m2"]
    _, kwargs = mock_get.call_args
    assert kwargs["params"] == {"maxResults": 2}
    assert kwargs["headers"]["Authorization"] == "Bearer token-x"


@patch("ingestion.gmail_ingestion.requests.get")
def test_fetch_raw_message_requests_raw_format(mock_get):
    mock_response = MagicMock()
    mock_response.json.return_value = {"id": "m1", "raw": "abc", "internalDate": "1700000000000"}
    mock_get.return_value = mock_response

    result = fetch_raw_message("token-x", "m1")

    assert result["raw"] == "abc"
    _, kwargs = mock_get.call_args
    assert kwargs["params"] == {"format": "raw"}


@patch("ingestion.gmail_ingestion.archive_to_r2")
@patch("ingestion.gmail_ingestion.get_r2_client")
@patch("ingestion.gmail_ingestion.fetch_raw_message")
@patch("ingestion.gmail_ingestion.fetch_message_ids")
@patch("ingestion.gmail_ingestion.get_access_token")
@patch("ingestion.gmail_ingestion.get_secret")
def test_fetch_and_archive_messages_continues_when_one_archive_fails(
    mock_get_secret, mock_get_access_token, mock_fetch_ids, mock_fetch_raw, mock_get_r2_client, mock_archive
):
    mock_get_secret.return_value = {
        "client_id": "cid", "client_secret": "cs", "refresh_token": "rt",
        "r2_account_id": "acc", "r2_access_key_id": "ak", "r2_secret_access_key": "sk",
    }
    mock_get_access_token.return_value = "token-x"
    mock_fetch_ids.return_value = ["m1", "m2"]

    def fake_raw(token, message_id):
        msg = EmailMessage()
        msg["Subject"] = f"Subject {message_id}"
        msg["From"] = "a@example.com"
        msg.set_content("body")
        return _raw_response(msg)

    mock_fetch_raw.side_effect = fake_raw
    mock_archive.side_effect = [Exception("R2 down"), None]  # first message's archive fails

    records = fetch_and_archive_messages()

    assert [r["message_id"] for r in records] == ["m1", "m2"]
    assert mock_archive.call_count == 2


@patch("ingestion.gmail_ingestion.write_records")
@patch("ingestion.gmail_ingestion.fetch_and_archive_messages")
def test_lambda_handler_writes_records_keyed_by_message_id(mock_fetch, mock_write_records):
    mock_fetch.return_value = [{"message_id": "m1"}]
    mock_write_records.return_value = "some/key.json"

    lambda_handler({}, None)

    mock_write_records.assert_called_once_with("gmail", [{"message_id": "m1"}], "message_id")
```

- [ ] **Step 15: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_gmail_ingestion.py -v`
Expected: FAIL — `ImportError` for `fetch_message_ids`/`fetch_raw_message`/`fetch_and_archive_messages`/`get_r2_client` (not defined yet).

- [ ] **Step 16: Implement `fetch_message_ids`, `fetch_raw_message`, `get_r2_client`, `fetch_and_archive_messages`, and `lambda_handler`**

Add to `ingestion/gmail_ingestion.py` (after `get_access_token`, before or after `archive_to_r2` — order in the file doesn't matter as long as all are module-level):

```python
import boto3


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
    return boto3.client(
        "s3",
        endpoint_url=f"https://{creds['r2_account_id']}.r2.cloudflarestorage.com",
        aws_access_key_id=creds["r2_access_key_id"],
        aws_secret_access_key=creds["r2_secret_access_key"],
        region_name="auto",
    )


def fetch_and_archive_messages() -> list[dict]:
    creds = get_secret(config.GMAIL_SECRET_NAME)
    access_token = get_access_token(creds)
    r2_client = get_r2_client(creds)

    records = []
    for message_id in fetch_message_ids(access_token, config.GMAIL_MESSAGE_LIMIT):
        raw_response = fetch_raw_message(access_token, message_id)
        raw_bytes, record = normalize_message(message_id, raw_response)
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
```

Move the `import boto3` line to the top of the file with the other imports
once everything is written (`boto3`, `requests`, `botocore.exceptions.ClientError`,
`common`/`ingestion` package imports) — this step shows it separately only
to mark where it's newly needed.

- [ ] **Step 17: Run the tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_gmail_ingestion.py -v`
Expected: PASS (all tests in this file — count them in the output).

- [ ] **Step 18: Run the full Python suite**

Run: `.venv/bin/python -m pytest tests/ -q`
Expected: PASS, no regressions.

- [ ] **Step 19: Commit**

```bash
git add common/config.py ingestion/gmail_ingestion.py tests/test_gmail_ingestion.py
git commit -m "feat: add gmail_ingestion module (Gmail API -> R2 archive + structured records)"
```

---

### Task 2: `transform/transform.py` — the "gmail" case

**Files:**
- Modify: `transform/transform.py`
- Test: `tests/test_transform.py`

**Interfaces:**
- Consumes: the record shape Task 1's `normalize_message` produces: `{message_id, source: "gmail", subject, from_address, snippet, received_at, ingested_at}`.
- Produces: nothing new imports this — `transform_records("gmail", records)` is invoked at runtime by `transform.lambda_handler` when a real `source=gmail/...` S3 object triggers it (no code-level import from another task).

- [ ] **Step 1: Write the failing tests**

Add to `tests/test_transform.py` (after the existing github-related tests, before `test_transform_records_rejects_unknown_source`):

```python
def test_record_text_gmail_combines_subject_and_snippet():
    record = {"subject": "Weekly digest", "snippet": "top stories inside"}
    assert transform.record_text(record, "gmail") == "Weekly digest top stories inside"


def test_clean_gmail_record_strips_fields():
    record = {
        "message_id": "m1",
        "subject": "  Weekly digest  ",
        "from_address": "  news@example.com  ",
        "snippet": "  top stories  ",
    }

    result = transform.clean_gmail_record(record)

    assert result["subject"] == "Weekly digest"
    assert result["from_address"] == "news@example.com"
    assert result["snippet"] == "top stories"


def test_transform_records_dedups_gmail_by_message_id_and_attaches_keywords(monkeypatch):
    fake_llm = lambda texts: [["digest", "news"] for _ in texts]  # noqa: E731
    monkeypatch.setattr(transform, "extract_keywords_llm", fake_llm)
    records = [
        {"message_id": "m1", "subject": "Digest", "from_address": "a@b.com", "snippet": ""},
        {"message_id": "m1", "subject": "Digest", "from_address": "a@b.com", "snippet": ""},
    ]

    result = transform.transform_records("gmail", records)

    assert len(result) == 1
    assert result[0]["keywords"] == ["digest", "news"]
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_transform.py -k gmail -v`
Expected: FAIL — `AttributeError: module 'transform.transform' has no attribute 'clean_gmail_record'` (and `record_text`/`transform_records` not yet handling `"gmail"`).

- [ ] **Step 3: Implement the "gmail" case**

In `transform/transform.py`:

1. Add `record_text`'s new branch — change:
   ```python
   def record_text(record: dict, source: str) -> str:
       if source == "hackernews":
           return f"{record.get('title') or ''} {record.get('text') or ''}".strip()
       if source == "github":
           return f"{record.get('full_name') or ''} {record.get('description') or ''}".strip()
       return f"{record.get('title') or ''} {record.get('description') or ''}".strip()
   ```
   to:
   ```python
   def record_text(record: dict, source: str) -> str:
       if source == "hackernews":
           return f"{record.get('title') or ''} {record.get('text') or ''}".strip()
       if source == "github":
           return f"{record.get('full_name') or ''} {record.get('description') or ''}".strip()
       if source == "gmail":
           return f"{record.get('subject') or ''} {record.get('snippet') or ''}".strip()
       return f"{record.get('title') or ''} {record.get('description') or ''}".strip()
   ```

2. Add `clean_gmail_record`, near the other `clean_*_record` functions:
   ```python
   def clean_gmail_record(record: dict) -> dict:
       cleaned = dict(record)
       cleaned["subject"] = (cleaned.get("subject") or "").strip()
       cleaned["from_address"] = (cleaned.get("from_address") or "").strip()
       cleaned["snippet"] = (cleaned.get("snippet") or "").strip()
       return cleaned
   ```

3. Add a `"gmail"` branch to `transform_records`, after the existing `elif source == "github":` block and before the `else:`:
   ```python
   elif source == "gmail":
       cleaned = dedup_records([clean_gmail_record(r) for r in records], "message_id")
       return attach_keywords(cleaned, source)
   ```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_transform.py -v`
Expected: PASS, all tests in this file (existing + 3 new).

- [ ] **Step 5: Run the full Python suite**

Run: `.venv/bin/python -m pytest tests/ -q`
Expected: PASS, no regressions.

- [ ] **Step 6: Commit**

```bash
git add transform/transform.py tests/test_transform.py
git commit -m "feat: add gmail case to transform_records (required before the first real ingestion run)"
```

---

### Task 3: `infra/glue.tf` — the `gmail_messages` table

**Files:**
- Modify: `infra/glue.tf`

**Interfaces:**
- Consumes: the exact curated-record field names Task 1/2 produce (`message_id`, `source`, `subject`, `from_address`, `snippet`, `received_at`, `ingested_at`, plus `keywords` added by `transform.py`'s `attach_keywords`).
- Produces: nothing consumed by later tasks in this plan — this table becomes queryable via Athena once Task 4-6 land and a real ingestion run happens.

- [ ] **Step 1: Add the `gmail_columns` local**

In `infra/glue.tf`, find the `locals { ... }` block containing `hackernews_columns`, `news_columns`, etc. (near the top of the file), and add a new entry after the existing ones (e.g. after `crypto_columns` or `github_columns`, matching the file's existing order):

```hcl
gmail_columns = [
  { name = "message_id", type = "string" },
  { name = "source", type = "string" },
  { name = "subject", type = "string" },
  { name = "from_address", type = "string" },
  { name = "snippet", type = "string" },
  { name = "received_at", type = "string" },
  { name = "ingested_at", type = "string" },
  { name = "keywords", type = "string" },
]
```

- [ ] **Step 2: Add the `gmail_messages` Glue table resource**

Add, after the existing `aws_glue_catalog_table.github_repos` resource (or wherever the file's existing table resources end), a new resource with the exact same shape as `aws_glue_catalog_table.news_articles` (read that block in the current file for the exact structure to copy), with `source=gmail` substituted for `source=news`:

```hcl
resource "aws_glue_catalog_table" "gmail_messages" {
  name          = "gmail_messages"
  database_name = aws_glue_catalog_database.curated.name
  table_type    = "EXTERNAL_TABLE"

  parameters = merge(local.partition_projection_base, {
    "classification"            = "parquet"
    "storage.location.template" = "s3://${aws_s3_bucket.curated.bucket}/source=gmail/year=$${year}/month=$${month}/day=$${day}/"
  })

  partition_keys {
    name = "year"
    type = "string"
  }
  partition_keys {
    name = "month"
    type = "string"
  }
  partition_keys {
    name = "day"
    type = "string"
  }

  storage_descriptor {
    location      = "s3://${aws_s3_bucket.curated.bucket}/source=gmail/"
    input_format  = "org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat"
    output_format = "org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat"

    ser_de_info {
      serialization_library = "org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe"
    }

    dynamic "columns" {
      for_each = local.gmail_columns
      content {
        name = columns.value.name
        type = columns.value.type
      }
    }
  }
}
```

- [ ] **Step 3: Validate**

Run: `cd infra && terraform fmt -check -diff && terraform validate`
Expected: `terraform fmt` reports no diff (or auto-fix with `terraform fmt` if it does, then re-check); `terraform validate` reports `Success!`.

- [ ] **Step 4: Commit**

```bash
git add infra/glue.tf
git commit -m "feat: add gmail_messages Glue table"
```

---

### Task 4: `infra/secrets.tf` + `infra/iam.tf` — the Gmail/R2 secret

**Files:**
- Modify: `infra/secrets.tf`
- Modify: `infra/iam.tf`

**Interfaces:**
- Produces: `aws_secretsmanager_secret.gmail_ingestion` (name and ARN) — Task 5's `aws_lambda_function.gmail_ingestion` references `aws_secretsmanager_secret.gmail_ingestion.name` in its environment variables.

- [ ] **Step 1: Add the secret resource**

In `infra/secrets.tf`, add after the existing `aws_secretsmanager_secret.tavily_api` resource:

```hcl
# Gmail ingestion: one secret bundling Gmail OAuth2 credentials AND the R2
# credentials used to archive raw messages (see infra/README.md's real
# setup steps -- both are real values the user creates and sets via
# `aws secretsmanager put-secret-value`, never Terraform-managed).
resource "aws_secretsmanager_secret" "gmail_ingestion" {
  name = "${local.name_prefix}/gmail-ingestion"
}
```

- [ ] **Step 2: Grant the ingestion Lambda role read access**

In `infra/iam.tf`, find `data "aws_iam_policy_document" "ingestion_permissions"`'s `ReadIngestionSecrets` statement (currently `resources = [aws_secretsmanager_secret.news_api.arn]`) and change it to:

```hcl
  statement {
    sid       = "ReadIngestionSecrets"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [
      aws_secretsmanager_secret.news_api.arn,
      aws_secretsmanager_secret.gmail_ingestion.arn,
    ]
  }
```

- [ ] **Step 3: Validate**

Run: `cd infra && terraform fmt -check -diff && terraform validate`
Expected: `Success!`.

- [ ] **Step 4: Commit**

```bash
git add infra/secrets.tf infra/iam.tf
git commit -m "feat: add gmail_ingestion Secrets Manager secret and IAM read access"
```

---

### Task 5: `infra/variables.tf` + `infra/lambda.tf` + `scripts/build_lambdas.sh` — the Lambda resource

**Files:**
- Modify: `infra/variables.tf`
- Modify: `infra/lambda.tf`
- Modify: `scripts/build_lambdas.sh`

**Interfaces:**
- Consumes: `aws_secretsmanager_secret.gmail_ingestion.name` (Task 4).
- Produces: `aws_lambda_function.gmail_ingestion` (name and ARN) — Task 6's EventBridge target references `aws_lambda_function.gmail_ingestion.arn`/`.function_name`. `var.gmail_ingestion_schedule` (added here) — Task 6's `aws_cloudwatch_event_rule` references it.

- [ ] **Step 1: Add the 3 new variables**

In `infra/variables.tf`, add after the existing `github_trending_limit` variable:

```hcl
variable "gmail_ingestion_schedule" {
  description = "EventBridge schedule expression for gmail_ingestion (its own, slower rule -- real inbox content changes less predictably than API-polled sources)"
  type        = string
  default     = "rate(4 hours)"
}

variable "gmail_message_limit" {
  description = "Max number of latest Gmail messages fetched per gmail_ingestion run"
  type        = number
  default     = 50
}

variable "gmail_r2_bucket_name" {
  description = "Real Cloudflare R2 bucket name for archiving raw Gmail messages (not secret -- the real R2 API credentials are in the gmail_ingestion Secrets Manager secret)"
  type        = string
}
```

- [ ] **Step 2: Add the archive_file + Lambda function resources**

In `infra/lambda.tf`, add after the existing `data.archive_file.github_trending_ingestion` block:

```hcl
data "archive_file" "gmail_ingestion" {
  type        = "zip"
  source_dir  = "${path.module}/build/gmail_ingestion"
  output_path = "${path.module}/build/gmail_ingestion.zip"
}
```

And after the existing `aws_lambda_function.github_trending_ingestion` resource:

```hcl
resource "aws_lambda_function" "gmail_ingestion" {
  function_name    = "${local.name_prefix}-gmail-ingestion"
  role             = aws_iam_role.ingestion_lambda.arn
  handler          = "gmail_ingestion.lambda_handler"
  runtime          = var.lambda_runtime
  timeout          = 60
  memory_size      = 256
  filename         = data.archive_file.gmail_ingestion.output_path
  source_code_hash = data.archive_file.gmail_ingestion.output_base64sha256

  environment {
    variables = {
      RAW_BUCKET           = aws_s3_bucket.raw.bucket
      GMAIL_SECRET_NAME    = aws_secretsmanager_secret.gmail_ingestion.name
      GMAIL_R2_BUCKET_NAME = var.gmail_r2_bucket_name
      GMAIL_MESSAGE_LIMIT  = tostring(var.gmail_message_limit)
    }
  }
}
```

- [ ] **Step 3: Add the packaging line**

In `scripts/build_lambdas.sh`, add after the existing `package_with_requests github_trending_ingestion ingestion/github_trending_ingestion.py` line:

```bash
package_with_requests gmail_ingestion ingestion/gmail_ingestion.py
```

- [ ] **Step 4: Build and validate**

Run: `./scripts/build_lambdas.sh` (stages the new Lambda's zip contents so `terraform validate`'s `archive_file` data source has something real to read)
Then: `cd infra && terraform fmt -check -diff && terraform validate`
Expected: build script prints "Lambda build artifacts ready under .../infra/build"; `terraform validate` reports `Success!`.

- [ ] **Step 5: Commit**

```bash
git add infra/variables.tf infra/lambda.tf scripts/build_lambdas.sh
git commit -m "feat: add gmail_ingestion Lambda resource and packaging"
```

---

### Task 6: `infra/eventbridge.tf` — the 4-hour schedule

**Files:**
- Modify: `infra/eventbridge.tf`

**Interfaces:**
- Consumes: `aws_lambda_function.gmail_ingestion` (Task 5), `var.gmail_ingestion_schedule` (Task 5).

- [ ] **Step 1: Add the schedule rule, target, and permission**

In `infra/eventbridge.tf`, add after the existing `news_ingestion_schedule`/`news_ingestion` target block (the last resource in the file, or wherever the file's existing `news_ingestion`-related resources end):

```hcl
resource "aws_cloudwatch_event_rule" "gmail_ingestion_schedule" {
  name                = "${local.name_prefix}-gmail-ingestion-schedule"
  schedule_expression = var.gmail_ingestion_schedule
  state               = var.enable_ingestion_schedule ? "ENABLED" : "DISABLED"
}

resource "aws_cloudwatch_event_target" "gmail_ingestion" {
  rule = aws_cloudwatch_event_rule.gmail_ingestion_schedule.name
  arn  = aws_lambda_function.gmail_ingestion.arn
}

resource "aws_lambda_permission" "allow_eventbridge_gmail" {
  statement_id  = "AllowEventBridgeInvokeGmail"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.gmail_ingestion.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.gmail_ingestion_schedule.arn
}
```

- [ ] **Step 2: Validate**

Run: `cd infra && terraform fmt -check -diff && terraform validate`
Expected: `Success!`.

- [ ] **Step 3: Full-repo sanity check**

Run: `.venv/bin/python -m pytest tests/ -q` and `cd web && npx vitest run` (this plan touches no `web/` files, but confirm nothing else regressed).
Expected: both suites pass with their pre-existing counts (no new web tests from this plan).

- [ ] **Step 4: Commit**

```bash
git add infra/eventbridge.tf
git commit -m "feat: add gmail_ingestion EventBridge schedule (rate(4 hours))"
```

---

## Post-plan: real credential setup and first real run

Not a task in this plan (no more code changes) — after all 6 tasks are
merged and the user runs `terraform apply` (with their own approval, same
gate as every other infra change), the user must:

1. Complete the real Google Cloud OAuth2 setup (Google Cloud project,
   enable Gmail API, OAuth consent screen moved to "In production"
   publishing status to avoid 7-day-expiring test tokens, OAuth client
   credentials, one-time consent flow to get a real refresh token) —
   exact steps given to the user separately, never performed by this
   assistant.
2. Run `aws secretsmanager put-secret-value --secret-id
   <gmail_ingestion secret name from terraform output> --secret-string
   '{"client_id":"...","client_secret":"...","refresh_token":"...","r2_account_id":"...","r2_access_key_id":"...","r2_secret_access_key":"..."}'`
   themselves, with their own real values.
3. Set `gmail_r2_bucket_name` in their `terraform.tfvars` to the real R2
   bucket name (`mail`'s real name, e.g. matching the pattern of the
   `excel` bucket's real name `rdp-excel`) and re-`apply`.
4. A real `aws lambda invoke` against `gmail_ingestion` is the final
   end-to-end proof — same live-verification pattern used for every
   other ingestion Lambda this project has shipped.
