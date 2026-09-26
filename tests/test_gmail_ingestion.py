import base64
from email.header import Header
from email.message import EmailMessage
from unittest.mock import MagicMock, patch

from botocore.exceptions import ClientError

from ingestion.gmail_ingestion import (
    _decode_header_value,
    archive_to_r2,
    fetch_and_archive_messages,
    fetch_message_ids,
    fetch_raw_message,
    get_access_token,
    lambda_handler,
    normalize_message,
)


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


def test_decode_header_value_falls_back_on_unknown_charset(monkeypatch):
    # decode_header() can return an encoded-word charset (or raw 8-bit header)
    # that Python's codecs module doesn't recognize -- bytes.decode() raises
    # LookupError in that case, not just UnicodeDecodeError.
    monkeypatch.setattr(
        "ingestion.gmail_ingestion.decode_header",
        lambda value: [(b"raw bytes with unknown charset", "unknown-8bit")],
    )

    result = _decode_header_value("irrelevant -- decode_header is mocked")

    assert result == "raw bytes with unknown charset"


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


@patch("ingestion.gmail_ingestion.boto3.client")
def test_get_r2_client_disables_aws_only_checksum_headers(mock_boto_client):
    # botocore >=1.36 defaults to sending AWS-specific checksum headers
    # (e.g. x-amz-checksum-crc32) that Cloudflare R2 rejects, so the client
    # must opt back into "when_required" for both request and response checksums.
    from ingestion.gmail_ingestion import get_r2_client

    get_r2_client({
        "r2_account_id": "acc",
        "r2_access_key_id": "ak",
        "r2_secret_access_key": "sk",
    })

    _, kwargs = mock_boto_client.call_args
    config = kwargs["config"]
    assert config.request_checksum_calculation == "when_required"
    assert config.response_checksum_validation == "when_required"


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
        Bucket="mail-bucket",
        Key="messages/msg-1.eml",
        Body=b"raw bytes",
        ContentType="message/rfc822",
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
    mock_get_secret,
    mock_get_access_token,
    mock_fetch_ids,
    mock_fetch_raw,
    mock_get_r2_client,
    mock_archive,
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


@patch("ingestion.gmail_ingestion.archive_to_r2")
@patch("ingestion.gmail_ingestion.get_r2_client")
@patch("ingestion.gmail_ingestion.fetch_raw_message")
@patch("ingestion.gmail_ingestion.fetch_message_ids")
@patch("ingestion.gmail_ingestion.get_access_token")
@patch("ingestion.gmail_ingestion.get_secret")
def test_fetch_and_archive_messages_skips_message_that_fails_to_fetch(
    mock_get_secret,
    mock_get_access_token,
    mock_fetch_ids,
    mock_fetch_raw,
    mock_get_r2_client,
    mock_archive,
):
    mock_get_secret.return_value = {
        "client_id": "cid", "client_secret": "cs", "refresh_token": "rt",
        "r2_account_id": "acc", "r2_access_key_id": "ak", "r2_secret_access_key": "sk",
    }
    mock_get_access_token.return_value = "token-x"
    mock_fetch_ids.return_value = ["bad-id", "m2"]

    def fake_raw(token, message_id):
        if message_id == "bad-id":
            raise RuntimeError("404 from Gmail -- message deleted between list and get")
        msg = EmailMessage()
        msg["Subject"] = f"Subject {message_id}"
        msg["From"] = "a@example.com"
        msg.set_content("body")
        return _raw_response(msg)

    mock_fetch_raw.side_effect = fake_raw

    records = fetch_and_archive_messages()

    assert [r["message_id"] for r in records] == ["m2"]
    mock_archive.assert_called_once()


@patch("ingestion.gmail_ingestion.write_records")
@patch("ingestion.gmail_ingestion.fetch_and_archive_messages")
def test_lambda_handler_writes_records_keyed_by_message_id(mock_fetch, mock_write_records):
    mock_fetch.return_value = [{"message_id": "m1"}]
    mock_write_records.return_value = "some/key.json"

    lambda_handler({}, None)

    mock_write_records.assert_called_once_with("gmail", [{"message_id": "m1"}], "message_id")
