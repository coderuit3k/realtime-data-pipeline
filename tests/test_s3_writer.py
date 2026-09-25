import json
from datetime import datetime, timezone

from common import config, s3_writer


def test_build_key_partitions_by_source_and_time():
    ts = datetime(2026, 9, 18, 14, 30, 0, tzinfo=timezone.utc)

    key = s3_writer.build_key("reddit", ts)

    assert key.startswith("source=reddit/year=2026/month=09/day=18/hour=14/")
    assert key.endswith(".json")


def test_write_records_dry_run_writes_local_ndjson(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "DRY_RUN", True)
    monkeypatch.chdir(tmp_path)

    records = [{"a": 1}, {"a": 2}]
    key = s3_writer.write_records("reddit", records, "a")

    written = (tmp_path / "local_output" / key).read_text(encoding="utf-8")
    lines = [json.loads(line) for line in written.splitlines()]
    assert lines == records


def test_write_records_returns_empty_string_for_no_records():
    assert s3_writer.write_records("reddit", [], "a") == ""


def test_write_records_drops_duplicate_records_by_key_field(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "DRY_RUN", True)
    monkeypatch.chdir(tmp_path)

    records = [{"a": 1, "v": "first"}, {"a": 2, "v": "only"}, {"a": 1, "v": "duplicate"}]
    key = s3_writer.write_records("reddit", records, "a")

    written = (tmp_path / "local_output" / key).read_text(encoding="utf-8")
    lines = [json.loads(line) for line in written.splitlines()]
    assert lines == [{"a": 1, "v": "first"}, {"a": 2, "v": "only"}]
