import json
import re
from datetime import date, datetime, timezone

from common import config
from trends import gmail_stats as gs

TODAY = date(2026, 10, 6)
NOW = datetime(2026, 10, 6, 9, 30, tzinfo=timezone.utc)


def _row(day, category, emails, needs_reply=0, urgent=0, with_deadline=0):
    return {
        "received_date": day, "category": category, "emails": str(emails),
        "needs_reply": str(needs_reply), "urgent": str(urgent), "with_deadline": str(with_deadline),
    }


def test_build_stats_query_counts_distinct_messages_and_filters_the_window():
    sql = gs.build_stats_query(TODAY, window_days=14)

    assert "GROUP BY message_id" in sql
    assert "FROM gmail_messages" in sql
    assert "concat(year, month, day) BETWEEN '20260923' AND '20261006'" in sql
    assert "received_date >= '2026-09-23'" in sql
    assert "'unclassified'" in sql


def test_build_stats_query_has_no_free_text_columns_in_its_output():
    sql = gs.build_stats_query(TODAY)

    final_select = sql.rsplit("SELECT", 1)[1]
    for text_column in ("subject", "from_address", "snippet", "company", "job_stage"):
        assert text_column not in final_select


def test_build_stats_sums_totals_by_category_and_per_day():
    rows = [
        _row("2026-10-06", "newsletter", 3, urgent=1),
        _row("2026-10-06", "recruiting", 2, needs_reply=2, with_deadline=1),
        _row("2026-10-05", "personal", 4, needs_reply=1),
        _row("2026-10-05", "unclassified", 5),
    ]

    stats = gs.build_stats(rows, TODAY, NOW)

    assert stats["totals"] == {
        "emails": 14, "needsReply": 3, "urgent": 1, "withDeadline": 1, "unclassified": 5,
    }
    assert stats["byCategory"] == {
        "newsletter": 3, "notification": 0, "personal": 4, "recruiting": 2, "other": 0,
    }
    per_day = {d["date"]: d["total"] for d in stats["perDay"]}
    assert per_day["2026-10-06"] == 5 and per_day["2026-10-05"] == 9


def test_build_stats_fills_every_day_of_the_window_with_zero():
    stats = gs.build_stats([], TODAY, NOW)

    assert len(stats["perDay"]) == 14
    assert stats["perDay"][0]["date"] == "2026-09-23"
    assert stats["perDay"][-1]["date"] == "2026-10-06"
    assert all(d["total"] == 0 for d in stats["perDay"])
    assert stats["totals"]["emails"] == 0


def test_build_stats_has_the_exact_documented_keys_and_metadata():
    stats = gs.build_stats([], TODAY, NOW)

    assert set(stats) == {"generatedAt", "windowDays", "totals", "byCategory", "perDay"}
    assert stats["generatedAt"] == "2026-10-06T09:30:00+00:00"
    assert stats["windowDays"] == 14
    assert set(stats["totals"]) == {
        "emails", "needsReply", "urgent", "withDeadline", "unclassified",
    }


def test_build_stats_ignores_unexpected_columns_and_unknown_categories():
    rows = [
        {**_row("2026-10-06", "other", 2), "subject": "SECRET", "from_address": "a@b.c"},
        _row("2026-10-06", "spam-from-a-bug", 7),
        _row("2020-01-01", "other", 99),  # outside the window
    ]

    stats = gs.build_stats(rows, TODAY, NOW)

    assert "SECRET" not in json.dumps(stats)
    assert stats["byCategory"]["other"] == 2
    assert stats["totals"]["emails"] == 2


def test_build_stats_json_contains_only_numbers_dates_and_the_timestamp():
    rows = [_row("2026-10-06", "recruiting", 2, needs_reply=1)]

    stats = gs.build_stats(rows, TODAY, NOW)

    strings = []

    def walk(value):
        if isinstance(value, dict):
            for key, inner in value.items():
                strings.append(key)
                walk(inner)
        elif isinstance(value, list):
            for inner in value:
                walk(inner)
        elif isinstance(value, str):
            strings.append(value)

    walk(stats)
    allowed_values = set(gs.email_labels.CATEGORIES)
    for text in strings:
        assert (
            re.fullmatch(r"[A-Za-z]+", text)
            or re.fullmatch(r"[0-9T:+\-]+", text)
            or text in allowed_values
        ), text


def test_lambda_handler_queries_athena_and_writes_the_json(monkeypatch):
    seen = {}
    monkeypatch.setattr(config, "CURATED_BUCKET", "curated-bucket")

    def fake_run_query(sql, max_rows=25):
        seen.update(sql=sql, max_rows=max_rows)
        return [_row(datetime.now(timezone.utc).date().isoformat(), "newsletter", 3)], False

    monkeypatch.setattr(gs.athena, "run_query", fake_run_query)

    class FakeS3:
        def put_object(self, **kwargs):
            seen["put"] = kwargs

    monkeypatch.setattr(gs, "_s3", lambda: FakeS3())

    result = gs.lambda_handler({}, None)

    assert seen["max_rows"] >= 14 * 6
    assert seen["put"]["Bucket"] == "curated-bucket"
    assert seen["put"]["Key"] == "gmail_stats/latest.json"
    assert seen["put"]["ContentType"] == "application/json"
    assert json.loads(seen["put"]["Body"])["totals"]["emails"] == 3
    assert result["statusCode"] == 200 and result["emails"] == 3


def test_lambda_handler_does_not_overwrite_the_file_when_athena_fails(monkeypatch):
    monkeypatch.setattr(config, "CURATED_BUCKET", "curated-bucket")

    def boom(sql, max_rows=25):
        raise RuntimeError("athena failed")

    monkeypatch.setattr(gs.athena, "run_query", boom)

    class FakeS3:
        def put_object(self, **kwargs):
            raise AssertionError("must keep the previous file")

    monkeypatch.setattr(gs, "_s3", lambda: FakeS3())

    try:
        gs.lambda_handler({}, None)
    except RuntimeError as error:
        assert "athena failed" in str(error)
    else:
        raise AssertionError("expected the failure to surface")
