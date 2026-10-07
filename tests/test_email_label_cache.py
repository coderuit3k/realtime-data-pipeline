from common import config
from common import email_label_cache as cache

LABEL = {
    "category": "recruiting", "urgency": "high", "needs_reply": True,
    "deadline": "2026-10-10", "job_stage": "interview", "company": "Acme",
}


class FakeTable:
    def __init__(self):
        self.written = []

    def batch_writer(self):
        outer = self

        class Writer:
            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

            def put_item(self, Item):  # noqa: N803 - boto3 API
                outer.written.append(Item)

        return Writer()


class FakeDynamo:
    def __init__(self, stored=None, unprocessed_rounds=0):
        self.stored = stored or {}
        self.unprocessed_rounds = unprocessed_rounds
        self.calls = []
        self.table = FakeTable()

    def Table(self, name):  # noqa: N802 - boto3 API
        assert name == "labels-table"
        return self.table

    def batch_get_item(self, RequestItems):  # noqa: N803 - boto3 API
        keys = RequestItems["labels-table"]["Keys"]
        self.calls.append([k["message_id"] for k in keys])
        assert len(keys) <= 100
        if self.unprocessed_rounds > 0:
            self.unprocessed_rounds -= 1
            return {
                "Responses": {"labels-table": []},
                "UnprocessedKeys": {"labels-table": {"Keys": keys}},
            }
        found = [
            {"message_id": k["message_id"], **self.stored[k["message_id"]]}
            for k in keys
            if k["message_id"] in self.stored
        ]
        return {"Responses": {"labels-table": found}, "UnprocessedKeys": {}}


def _use(monkeypatch, fake, table="labels-table"):
    monkeypatch.setattr(config, "GMAIL_LABELS_TABLE", table)
    monkeypatch.setattr(cache, "_dynamodb", lambda: fake)


def test_get_cached_labels_returns_only_the_ids_found_with_only_label_fields(monkeypatch):
    fake = FakeDynamo({"m1": {**LABEL, "extra": "ignored"}})
    _use(monkeypatch, fake)

    result = cache.get_cached_labels(["m1", "m2"])

    assert result == {"m1": LABEL}


def test_get_cached_labels_splits_more_than_100_ids_into_batches(monkeypatch):
    fake = FakeDynamo()
    _use(monkeypatch, fake)

    cache.get_cached_labels([f"m{i}" for i in range(250)])

    assert [len(call) for call in fake.calls] == [100, 100, 50]


def test_get_cached_labels_deduplicates_ids(monkeypatch):
    fake = FakeDynamo()
    _use(monkeypatch, fake)

    cache.get_cached_labels(["m1", "m1", "m1"])

    assert fake.calls == [["m1"]]


def test_get_cached_labels_retries_unprocessed_keys(monkeypatch):
    fake = FakeDynamo({"m1": LABEL}, unprocessed_rounds=1)
    _use(monkeypatch, fake)
    monkeypatch.setattr(cache.time, "sleep", lambda s: None)

    assert cache.get_cached_labels(["m1"]) == {"m1": LABEL}
    assert len(fake.calls) == 2


def test_get_cached_labels_gives_up_after_the_attempts_and_treats_the_rest_as_missing(monkeypatch):
    fake = FakeDynamo({"m1": LABEL}, unprocessed_rounds=99)
    _use(monkeypatch, fake)
    monkeypatch.setattr(cache.time, "sleep", lambda s: None)

    assert cache.get_cached_labels(["m1"]) == {}
    assert len(fake.calls) == cache.MAX_ATTEMPTS


def test_get_cached_labels_does_nothing_without_a_table_name(monkeypatch):
    def boom():
        raise AssertionError("must not touch AWS")

    monkeypatch.setattr(config, "GMAIL_LABELS_TABLE", "")
    monkeypatch.setattr(cache, "_dynamodb", boom)

    assert cache.get_cached_labels(["m1"]) == {}


def test_get_cached_labels_of_an_empty_list_does_nothing(monkeypatch):
    fake = FakeDynamo()
    _use(monkeypatch, fake)

    assert cache.get_cached_labels([]) == {}
    assert fake.calls == []


def test_put_labels_stores_the_id_and_the_six_fields_only(monkeypatch):
    fake = FakeDynamo()
    _use(monkeypatch, fake)

    cache.put_labels({"m1": {**LABEL, "subject": "never stored"}})

    assert fake.table.written == [{"message_id": "m1", **LABEL}]


def test_put_labels_does_nothing_without_a_table_name_or_labels(monkeypatch):
    def boom():
        raise AssertionError("must not touch AWS")

    monkeypatch.setattr(cache, "_dynamodb", boom)
    monkeypatch.setattr(config, "GMAIL_LABELS_TABLE", "")
    cache.put_labels({"m1": LABEL})
    monkeypatch.setattr(config, "GMAIL_LABELS_TABLE", "labels-table")
    cache.put_labels({})
