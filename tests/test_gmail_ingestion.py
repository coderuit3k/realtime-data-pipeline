from datetime import datetime, timezone
from email.header import Header
from email.message import EmailMessage
from unittest.mock import MagicMock, patch

from botocore.exceptions import ClientError

from ingestion.gmail_ingestion import (
    _decode_header_value,
    archive_to_r2,
    connect_imap,
    fetch_and_archive_messages,
    fetch_message_ids,
    fetch_raw_message,
    lambda_handler,
    normalize_message,
)

RECEIVED = datetime(2023, 11, 14, 22, 13, 20, tzinfo=timezone.utc)


def _normalize(message_id, msg, received_at=RECEIVED):
    return normalize_message(message_id, msg.as_bytes(), received_at)


def test_normalize_message_maps_plain_fields():
    msg = EmailMessage()
    msg["Subject"] = "Weekly digest"
    msg["From"] = "news@example.com"
    msg.set_content("Hello, this is the body text.")

    raw_bytes, record = _normalize("msg-1", msg)

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

    _, record = _normalize("msg-2", msg)

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

    _, record = _normalize("msg-3", msg)

    assert record["snippet"] == ""


def test_normalize_message_truncates_long_snippet_to_200_chars():
    msg = EmailMessage()
    msg["Subject"] = "Long body"
    msg["From"] = "a@example.com"
    msg.set_content("x" * 500)

    _, record = _normalize("msg-4", msg)

    assert len(record["snippet"]) == 200


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


class FakeImap:
    """Just enough of imaplib.IMAP4_SSL: a mailbox of {sequence number: (gmail id, date, raw)}."""

    def __init__(self, mailbox):
        self.mailbox = mailbox
        self.selected = None
        self.fetches = []
        self.logged_out = False

    def search(self, charset, criterion):
        assert criterion == "ALL"
        return "OK", [b" ".join(str(n).encode() for n in sorted(self.mailbox))]

    def select(self, mailbox, readonly=False):
        self.selected = (mailbox, readonly)
        return "OK", [b"3"]

    def fetch(self, number, parts):
        self.fetches.append((number, parts))
        gm_id, date, raw = self.mailbox[int(number)]
        head = (
            f'{int(number)} (X-GM-MSGID {gm_id} INTERNALDATE "{date}" BODY[] {{{len(raw)}}}'
        ).encode()
        return "OK", [(head, raw), b")"]

    def logout(self):
        self.logged_out = True
        return "BYE", [b""]


def _mailbox():
    return {
        1: (1, "01-Jan-2026 00:00:00 +0000", b"Subject: old\r\n\r\nold"),
        2: (255, "14-Nov-2023 22:13:20 +0000", b"Subject: mid\r\n\r\nmid"),
        3: (4096, "14-Nov-2023 15:13:20 -0700", b"Subject: new\r\n\r\nnew"),
    }


def test_fetch_message_ids_returns_the_newest_first_limited():
    assert fetch_message_ids(FakeImap(_mailbox()), 2) == [b"3", b"2"]


def test_fetch_message_ids_of_an_empty_mailbox_is_empty():
    assert fetch_message_ids(FakeImap({}), 5) == []


def test_fetch_raw_message_returns_the_gmail_api_id_the_bytes_and_a_utc_date():
    imap = FakeImap(_mailbox())

    message = fetch_raw_message(imap, b"3")

    # The Gmail API id is the hex of X-GM-MSGID, so ids stay the same as before IMAP.
    assert message["id"] == "1000"
    assert message["raw"] == b"Subject: new\r\n\r\nnew"
    assert message["received_at"] == datetime(2023, 11, 14, 22, 13, 20, tzinfo=timezone.utc)


def test_fetch_raw_message_finds_attributes_the_server_sends_after_the_body():
    class TrailingAttributes(FakeImap):
        def fetch(self, number, parts):
            raw = b"Subject: x\r\n\r\nx"
            head = f"3 (BODY[] {{{len(raw)}}}".encode()
            tail = b' X-GM-MSGID 255 INTERNALDATE "14-Nov-2023 22:13:20 +0000")'
            return "OK", [(head, raw), tail]

    message = fetch_raw_message(TrailingAttributes({}), b"3")

    assert message["id"] == "ff"
    assert message["raw"] == b"Subject: x\r\n\r\nx"
    assert message["received_at"] == datetime(2023, 11, 14, 22, 13, 20, tzinfo=timezone.utc)


def test_fetch_raw_message_does_not_mark_mail_as_read():
    imap = FakeImap(_mailbox())

    fetch_raw_message(imap, b"2")

    assert "BODY.PEEK[]" in imap.fetches[0][1]


@patch("ingestion.gmail_ingestion.imaplib.IMAP4_SSL")
def test_connect_imap_logs_in_and_opens_the_inbox_read_only(mock_imap_cls):
    conn = connect_imap({"imap_user": "me@gmail.com", "imap_password": "app-pass"})

    mock_imap_cls.assert_called_once()
    assert mock_imap_cls.call_args.args[0] == "imap.gmail.com"
    conn.login.assert_called_once_with("me@gmail.com", "app-pass")
    conn.select.assert_called_once_with("INBOX", readonly=True)


CREDS = {
    "imap_user": "me@gmail.com", "imap_password": "pw",
    "r2_account_id": "acc", "r2_access_key_id": "ak", "r2_secret_access_key": "sk",
}


def _mail(subject):
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = "a@example.com"
    msg.set_content("body")
    return msg.as_bytes()


def _imap_with(raws):
    return FakeImap({i: (int(i, 16), "14-Nov-2023 22:13:20 +0000", raw) for i, raw in raws.items()})


@patch("ingestion.gmail_ingestion.archive_to_r2")
@patch("ingestion.gmail_ingestion.get_r2_client")
@patch("ingestion.gmail_ingestion.connect_imap")
@patch("ingestion.gmail_ingestion.get_secret")
def test_fetch_and_archive_messages_continues_when_one_archive_fails(
    mock_get_secret, mock_connect, mock_get_r2_client, mock_archive
):
    mock_get_secret.return_value = CREDS
    mock_connect.return_value = FakeImapByHex({"a": _mail("A"), "b": _mail("B")})
    mock_archive.side_effect = [Exception("R2 down"), None]  # first message's archive fails

    records = fetch_and_archive_messages()

    assert sorted(r["message_id"] for r in records) == ["a", "b"]
    assert mock_archive.call_count == 2


@patch("ingestion.gmail_ingestion.archive_to_r2")
@patch("ingestion.gmail_ingestion.get_r2_client")
@patch("ingestion.gmail_ingestion.connect_imap")
@patch("ingestion.gmail_ingestion.get_secret")
def test_fetch_and_archive_messages_skips_message_that_fails_to_fetch(
    mock_get_secret, mock_connect, mock_get_r2_client, mock_archive
):
    mock_get_secret.return_value = CREDS
    imap = FakeImapByHex({"a": _mail("A"), "b": _mail("B")})
    real_fetch = imap.fetch

    def flaky_fetch(number, parts):
        if int(number) == 2:  # the newest message disappears between search and fetch
            raise RuntimeError("message deleted")
        return real_fetch(number, parts)

    imap.fetch = flaky_fetch
    mock_connect.return_value = imap

    records = fetch_and_archive_messages()

    assert [r["message_id"] for r in records] == ["a"]
    mock_archive.assert_called_once()


@patch("ingestion.gmail_ingestion.archive_to_r2")
@patch("ingestion.gmail_ingestion.get_r2_client")
@patch("ingestion.gmail_ingestion.connect_imap")
@patch("ingestion.gmail_ingestion.get_secret")
def test_fetch_and_archive_messages_always_logs_out(
    mock_get_secret, mock_connect, mock_get_r2_client, mock_archive
):
    mock_get_secret.return_value = CREDS
    imap = FakeImapByHex({"a": _mail("A")})
    imap.search = MagicMock(side_effect=RuntimeError("search failed"))
    mock_connect.return_value = imap

    try:
        fetch_and_archive_messages()
    except RuntimeError:
        pass

    assert imap.logged_out


class FakeImapByHex(FakeImap):
    """A FakeImap whose messages are keyed by their Gmail API (hex) id, numbered 1..n."""

    def __init__(self, raws_by_hex):
        super().__init__(
            {
                n: (int(h, 16), "14-Nov-2023 22:13:20 +0000", raw)
                for n, (h, raw) in enumerate(raws_by_hex.items(), start=1)
            }
        )


@patch("ingestion.gmail_ingestion.write_records")
@patch("ingestion.gmail_ingestion.fetch_and_archive_messages")
def test_lambda_handler_writes_records_keyed_by_message_id(mock_fetch, mock_write_records):
    mock_fetch.return_value = [{"message_id": "m1"}]
    mock_write_records.return_value = "some/key.json"

    lambda_handler({}, None)

    mock_write_records.assert_called_once_with("gmail", [{"message_id": "m1"}], "message_id")
