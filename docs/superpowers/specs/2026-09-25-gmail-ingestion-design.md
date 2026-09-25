# Gmail ingestion (Sub-project A: backend) — design spec

## Overview

Add a real 6th ingestion source: a new `gmail_ingestion` Lambda that pulls
the latest messages from a real Gmail inbox via the Gmail API, archives
each message's full raw content (headers, body, attachments) to the
Cloudflare R2 `mail` bucket the user already created, and writes
structured fields into the same AWS S3 raw → curated → Glue → Athena
pipeline the other 5 sources already use. This is Sub-project A of two
independent sub-projects using the user's `mail`/`excel` R2 buckets
(Sub-project A: `excel` export, already shipped). Sub-project B (RAG
semantic index inclusion, and updating every "5 nguồn dữ liệu" reference
across the web app to say 6) is separate, later, and out of scope here.

## Goals

- A real, scheduled ingestion Lambda that authenticates to a real Gmail
  account and pulls its latest messages — same shape as every existing
  ingestion Lambda (`ingestion/*.py`): fetch, normalize, write.
- Real dual-write: full raw email (for real recovery/archival value) to
  R2, structured metadata to AWS S3 for the same Athena-queryable
  experience every other source already has.
- No new heavy dependency. Every other ingestion Lambda's zip carries
  only `requests` (see `scripts/build_lambdas.sh`'s `package_with_requests`)
  — this one does too. Gmail's OAuth2 token refresh and its REST API are
  both plain HTTPS+JSON, and Python's stdlib `email` module parses the
  raw MIME message locally — no `google-api-python-client`/`google-auth`
  needed, keeping this Lambda's packaging identical to every sibling.
- R2 upload also uses `boto3` (already provided by the Lambda runtime,
  confirmed via `scripts/build_lambdas.sh`'s comment on `transform`/`hackernews_ingestion`
  build targets), pointed at R2's S3-compatible endpoint — no new
  dependency for that either.

## Non-goals

- **No RAG index inclusion yet.** `rag/build_index.py`'s `build_documents()`
  is untouched by this plan — Sub-project B adds `gmail_messages` to its
  `sources` tuple later.
- **No web/ changes at all.** `DATA_SOURCE_COUNT`, `/catalog`, the landing
  page, dashboard, and insights all keep saying "5 nguồn" until
  Sub-project B. This plan is backend-only (Python + Terraform).
- **No "since last run" cursor/state.** Mirrors this project's existing,
  accepted pattern (`ingestion/hackernews_ingestion.py` re-fetches the
  latest N stories every run with no persisted cursor) — fetch the latest
  `GMAIL_MESSAGE_LIMIT` messages every run, accept that the same message
  appears across multiple runs. The existing per-batch dedup
  (`common/s3_writer.py`'s `write_records`, and `transform.py`'s
  `dedup_records`) already handles duplicates within and across a given
  raw file; cross-run duplicate *curated* rows are an accepted,
  already-present property of this pipeline (same as HN/news today), not
  a new problem this plan introduces.
- **No attachment extraction/parsing.** The full raw MIME (headers + body
  + attachment bytes, still MIME-encoded) is archived to R2 as one blob
  per message — real, complete, recoverable — but this plan does not
  decode/list/extract individual attachments into separate objects or
  columns.
- **Own EventBridge schedule, not the shared one.** Per the user's
  explicit direction: `gmail_ingestion` gets its own
  `gmail_ingestion_schedule` rule at `rate(4 hours)`, mirroring how
  `news_ingestion_schedule` is already separate from the shared
  `ingestion_schedule` (`infra/eventbridge.tf`) — not the 30-minute cadence
  the other 5 sources share.

## Real credential setup (the user does this, never this assistant)

Two real secrets are needed, bundled into one AWS Secrets Manager secret
(`${name_prefix}/gmail-ingestion`, mirroring `news_api`/`tavily_api`'s
one-secret-per-integration pattern in `infra/secrets.tf`):

```json
{
  "client_id": "...",
  "client_secret": "...",
  "refresh_token": "...",
  "r2_account_id": "...",
  "r2_access_key_id": "...",
  "r2_secret_access_key": "..."
}
```

- **Gmail OAuth2 credentials** (`client_id`, `client_secret`,
  `refresh_token`): the user creates a Google Cloud project, enables the
  Gmail API, configures an OAuth consent screen (Testing is fine, but
  publishing status must be moved to "In production" — apps left in
  Testing get refresh tokens that expire after 7 days, which would
  silently break this Lambda a week after setup), creates OAuth2 Desktop
  or Web client credentials, and completes a one-time OAuth consent flow
  (as themselves, for their own account) to obtain a real refresh token
  scoped to `https://www.googleapis.com/auth/gmail.readonly`. This
  assistant never performs this flow or sees these values — exact
  step-by-step instructions are given to the user separately (same
  pattern as the R2 setup guide already given for the Excel export), not
  embedded in code or this repo.
- **R2 credentials** (`r2_account_id`, `r2_access_key_id`,
  `r2_secret_access_key`): the same real Cloudflare R2 API token the user
  already created for the `excel`/`mail` buckets (confirmed scoped to
  both) — these values get pasted into this NEW AWS secret via the AWS
  CLI (same "set once via `aws secretsmanager put-secret-value`" pattern
  `infra/secrets.tf`'s header comment already documents for `news_api`),
  separate from the Vercel env vars used by the Excel export feature
  (different runtime, same real underlying token).
- The bucket name itself (`rdp-excel`'s sibling `mail`-bucket real name)
  is not secret — it travels as a plain Lambda environment variable
  (`GMAIL_R2_BUCKET_NAME`), mirroring how `R2_EXCEL_BUCKET_NAME` was a
  plain Vercel env var, not a Secrets Manager value.

## Architecture / data flow

1. EventBridge (`gmail_ingestion_schedule`, `rate(4 hours)`) invokes
   `gmail_ingestion` Lambda.
2. `get_secret(config.GMAIL_SECRET_NAME)` (existing `common/secrets.py`
   helper, unchanged) reads the one bundled secret above.
3. `get_access_token(creds)`: `POST https://oauth2.googleapis.com/token`
   with `client_id`/`client_secret`/`refresh_token`/
   `grant_type=refresh_token` → a short-lived access token. Real OAuth2
   refresh-token exchange, plain `requests.post`, no SDK.
4. `fetch_message_ids(access_token, limit)`: `GET
   https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=<limit>`
   with `Authorization: Bearer <token>` → up to `GMAIL_MESSAGE_LIMIT`
   (default 50, mirrors `HN_STORY_LIMIT`/`NEWS_PAGE_SIZE`'s existing
   env-configurable-int pattern in `common/config.py`) message IDs, most
   recent first (Gmail's default list order).
5. For each ID, `fetch_raw_message(access_token, message_id)`: `GET
   .../messages/{id}?format=raw` → `{"id", "internalDate", "raw"}` where
   `raw` is the full RFC822 message, base64url-encoded. One API call per
   message gets both the archival blob AND everything needed to derive
   the structured fields (no second `format=full` call needed).
6. `normalize_message(raw_response)`: base64url-decodes `raw`, parses it
   with Python's stdlib `email.message_from_bytes`, and returns both:
   - the raw bytes (for R2), and
   - a structured dict: `message_id`, `source: "gmail"`, `subject`
     (decoded `Subject` header, handling RFC 2047 encoded-words via
     `email.header.decode_header`), `from_address` (decoded `From`
     header), `snippet` (first ~200 chars of the first `text/plain` MIME
     part found, falling back to `""` if the message is HTML-only or has
     no readable text part), `received_at` (from `internalDate`, an
     epoch-milliseconds string → ISO 8601), `ingested_at` (now, same
     convention as every other source).
7. **R2 archive, idempotent:** for each message, `head_object` the R2
   bucket at key `messages/<message_id>.eml`; if it already exists
   (`ClientError` with a 404 means it doesn't), skip the upload — avoids
   re-uploading the same raw blob every run just because the message is
   still among the latest N. If missing, `put_object` the raw bytes.
   Failures here are logged and do not abort the run (matches this
   pipeline's general resilience posture — one bad message must not
   block the other messages in the batch).
8. **AWS S3 raw write:** the full list of structured dicts (all of them,
   not just the ones newly archived to R2 — the curated pipeline is
   allowed cross-run duplicates, same as every other source) goes through
   the existing `common.s3_writer.write_records("gmail", records,
   "message_id")` — deduped by `message_id` within this batch (the
   dedup feature added earlier this project), written as NDJSON to
   `source=gmail/year=.../month=.../day=.../hour=.../*.json`.
9. The existing, prefix-unfiltered `aws_s3_bucket_notification`
   (`infra/s3_notification.tf`) invokes the shared `transform` Lambda on
   this new key automatically — no Terraform change needed there.
   `transform.py`'s `transform_records()` gains a `"gmail"` branch:
   cleans (`strip()` on `subject`/`from_address`), dedups by
   `message_id`, and — like `hackernews`/`news`/`github` — calls
   `attach_keywords` (real subject+snippet text, worth LLM/regex keyword
   extraction, same as every other prose-bearing source) before writing
   Parquet to the curated zone with a `gmail_messages` Glue table.

## Components

### `ingestion/gmail_ingestion.py` (new)

Mirrors `ingestion/news_ingestion.py`'s shape exactly: a
`normalize_*`/`fetch_*`/`lambda_handler` structure.

```python
import base64
import logging
from datetime import datetime, timezone
from email import message_from_bytes
from email.header import decode_header

import boto3
import requests
from botocore.exceptions import ClientError

from common import config
from common.s3_writer import write_records
from common.secrets import get_secret

logger = logging.getLogger()
logger.setLevel(logging.INFO)

GMAIL_TOKEN_URL = "https://oauth2.googleapis.com/token"
GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me"

_r2_client = None


def _r2():
    global _r2_client
    if _r2_client is None:
        creds = get_secret(config.GMAIL_SECRET_NAME)
        _r2_client = boto3.client(
            "s3",
            endpoint_url=f"https://{creds['r2_account_id']}.r2.cloudflarestorage.com",
            aws_access_key_id=creds["r2_access_key_id"],
            aws_secret_access_key=creds["r2_secret_access_key"],
            region_name="auto",
        )
    return _r2_client


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


def archive_to_r2(bucket: str, message_id: str, raw_bytes: bytes) -> None:
    key = f"messages/{message_id}.eml"
    try:
        _r2().head_object(Bucket=bucket, Key=key)
        return  # already archived in a prior run -- skip re-upload
    except ClientError as error:
        if error.response.get("Error", {}).get("Code") not in ("404", "NoSuchKey"):
            raise
    _r2().put_object(Bucket=bucket, Key=key, Body=raw_bytes, ContentType="message/rfc822")


def fetch_and_archive_messages() -> list[dict]:
    creds = get_secret(config.GMAIL_SECRET_NAME)
    access_token = get_access_token(creds)

    records = []
    for message_id in fetch_message_ids(access_token, config.GMAIL_MESSAGE_LIMIT):
        raw_response = fetch_raw_message(access_token, message_id)
        raw_bytes, record = normalize_message(message_id, raw_response)
        try:
            archive_to_r2(config.GMAIL_R2_BUCKET_NAME, message_id, raw_bytes)
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

(The plan that implements this spec will restate this as exact TDD steps
— this block establishes the real shape and real endpoints, not
necessarily the final line-by-line code.)

### `common/config.py` (modified)

Add, mirroring the existing `NEWS_SECRET_NAME`/`HN_STORY_LIMIT` style:

```python
GMAIL_SECRET_NAME = os.environ.get("GMAIL_SECRET_NAME", "data-pipeline/gmail-ingestion")
GMAIL_MESSAGE_LIMIT = int(os.environ.get("GMAIL_MESSAGE_LIMIT", "50"))
GMAIL_R2_BUCKET_NAME = os.environ.get("GMAIL_R2_BUCKET_NAME", "")
```

### `transform/transform.py` (modified)

- `clean_gmail_record(record)`: `.strip()` on `subject`/`from_address`/`snippet`.
- `record_text(record, source)`: add `if source == "gmail": return f"{record.get('subject') or ''} {record.get('snippet') or ''}".strip()`.
- `transform_records()`: add a `"gmail"` branch — `dedup_records(...,
  "message_id")` then `attach_keywords(cleaned, source)`, same shape as
  `"hackernews"`/`"news"`/`"github"`. This branch is **required**, not
  optional: the S3 notification (`infra/s3_notification.tf`) has no
  prefix filter, so the first real `source=gmail/...` object written
  will invoke `transform` regardless of whether this plan adds the
  branch — omitting it means `transform_records()` hits its `else: raise
  ValueError(f"Unknown source: {source}")` and the very first gmail
  ingestion run's transform step fails.

### `infra/secrets.tf` (modified)

```hcl
resource "aws_secretsmanager_secret" "gmail_ingestion" {
  name = "${local.name_prefix}/gmail-ingestion"
}
```

### `infra/iam.tf` (modified)

Add `aws_secretsmanager_secret.gmail_ingestion.arn` to
`ingestion_permissions`'s `ReadIngestionSecrets` statement's `resources`
list (currently only `news_api`'s ARN).

### `infra/lambda.tf` (modified)

New `data.archive_file.gmail_ingestion` + `aws_lambda_function.gmail_ingestion`,
same shape as `news_ingestion`'s block, with:
```hcl
environment {
  variables = {
    RAW_BUCKET         = aws_s3_bucket.raw.bucket
    GMAIL_SECRET_NAME  = aws_secretsmanager_secret.gmail_ingestion.name
    GMAIL_R2_BUCKET_NAME = var.gmail_r2_bucket_name
    GMAIL_MESSAGE_LIMIT  = tostring(var.gmail_message_limit)
  }
}
```

### `infra/variables.tf` (modified)

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

### `infra/eventbridge.tf` (modified)

New `aws_cloudwatch_event_rule.gmail_ingestion_schedule` (`rate(4 hours)`
via `var.gmail_ingestion_schedule`) + `aws_cloudwatch_event_target.gmail_ingestion`
+ `aws_lambda_permission.allow_eventbridge_gmail`, same shape as the
existing `news_ingestion_schedule` block (its own separate rule, not
added to the shared `ingestion_schedule`).

### `infra/glue.tf` (modified)

New `local.gmail_columns`:
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
And a new `aws_glue_catalog_table.gmail_messages`, same shape as
`news_articles`'s block (`source=gmail/` location, same partition keys).

### `scripts/build_lambdas.sh` (modified)

Add one line: `package_with_requests gmail_ingestion ingestion/gmail_ingestion.py`
— identical treatment to every existing ingestion Lambda.

## Testing

- `tests/test_gmail_ingestion.py` (new), mirroring
  `tests/test_news_ingestion.py`'s structure:
  - `normalize_message` with a real, hand-built minimal RFC822 message
    (built via Python's own `email.message.EmailMessage` in the test, so
    the test doesn't depend on a live Gmail response) — asserts
    `message_id`, `subject` (including one case with RFC 2047
    encoded-words, e.g. `=?UTF-8?B?...?=`, to prove `_decode_header_value`
    actually decodes them), `from_address`, `snippet` (truncated to 200
    chars, and a case where the message has no `text/plain` part at all
    → `snippet == ""`), `received_at` derived from a given
    `internalDate`.
  - `get_access_token`: mocks `requests.post`, asserts the exact
    `grant_type=refresh_token` form-encoded body and that the returned
    `access_token` is extracted correctly.
  - `archive_to_r2`: mocks the R2 client's `head_object`/`put_object` —
    one case where `head_object` succeeds (object exists) → `put_object`
    is never called; one case where it raises a 404 `ClientError` →
    `put_object` is called once with the exact bytes/key/content-type.
  - `lambda_handler`: mocks `fetch_and_archive_messages` and
    `write_records`, asserts `write_records("gmail", records,
    "message_id")` is called with exactly what `fetch_and_archive_messages`
    returned (same pattern as every other ingestion module's
    `test_lambda_handler_writes_records_keyed_by_*` test added earlier
    this project).
- `tests/test_transform.py` (existing file — confirm its real path and
  add cases there): a `"gmail"` case for `transform_records()` (dedup by
  `message_id`, keywords attached) and for `record_text()` (returns
  `subject + snippet`).
- No web/ tests — this plan touches no `web/` files.
- `infra/`: no automated tests (this project has none for Terraform
  beyond `terraform validate`, already run in CI) — real verification is
  a real `terraform plan`/`apply` and a real Lambda invoke, same as every
  other ingestion Lambda this project has shipped.

## Review focus

- **A message with a non-ASCII/encoded Subject header must decode
  correctly**, not show up as literal `=?UTF-8?B?...?=` — pinned by the
  RFC 2047 test case above.
- **A message with no readable text part (HTML-only, or an
  attachment-only message) must not crash** `_extract_snippet` — pinned
  by the "no text/plain part" test case.
- **Re-ingesting the same message (still in the latest 50 on the next
  4-hour run) must not re-upload it to R2** — pinned by the
  `head_object`-exists test case.
- **The first real Gmail ingestion run must not break `transform`** —
  pinned by the new `"gmail"` case in `transform_records()`'s test,
  since the S3 notification has no prefix filter and would otherwise hit
  `transform.py`'s `else: raise ValueError`.
- **An R2 archive failure for one message must not lose that message's
  structured data** — `archive_to_r2` failures are caught and logged
  per-message inside `fetch_and_archive_messages`'s loop, never aborting
  the whole batch; pinned by a test where `archive_to_r2` raises for one
  message but `write_records` still receives all records including that
  one.
