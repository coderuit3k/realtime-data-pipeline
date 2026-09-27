from datetime import datetime, timezone

import pandas as pd

from common import config
from trends import trend_scan


def test_build_detection_query_references_all_three_tables():
    sql = trend_scan.build_detection_query("2026", "09", "27")

    assert "github_repos" in sql
    assert "hackernews_stories" in sql
    assert "news_articles" in sql
    assert "day='27'" in sql
    assert "UNNEST" in sql
    assert "POSITION" not in sql


def test_build_detection_query_applies_configured_thresholds(monkeypatch):
    monkeypatch.setattr(config, "TREND_HN_MIN_STORIES", 5)
    monkeypatch.setattr(config, "TREND_NEWS_MIN_ARTICLES", 4)
    monkeypatch.setattr(config, "TREND_MAX_EVENTS_PER_DAY", 2)

    sql = trend_scan.build_detection_query("2026", "09", "27")

    assert "COUNT(DISTINCT hn.item_id) >= 5" in sql
    assert "COUNT(DISTINCT news.item_id) >= 4" in sql
    assert "LIMIT 2" in sql


def test_write_trend_events_dry_run_writes_readable_parquet(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "DRY_RUN", True)
    monkeypatch.chdir(tmp_path)
    now = datetime(2026, 9, 27, 23, 0, 0, tzinfo=timezone.utc)

    rows = [{"keyword": "deepseek", "github_count": "2", "hn_count": "5", "news_count": "3"}]
    key = trend_scan.write_trend_events(rows, "2026-09-27", now)

    df = pd.read_parquet(tmp_path / "local_output_curated" / key)
    assert len(df) == 1
    assert df.loc[0, "event_id"] == "deepseek-2026-09-27"
    assert df.loc[0, "github_count"] == 2
    assert df.loc[0, "hn_count"] == 5
    assert df.loc[0, "news_count"] == 3


def test_write_trend_events_returns_empty_string_for_no_events(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "DRY_RUN", True)
    monkeypatch.chdir(tmp_path)

    key = trend_scan.write_trend_events([], "2026-09-27")

    assert key == ""


def test_lambda_handler_writes_detected_events(monkeypatch):
    monkeypatch.setattr(
        trend_scan.athena, "run_query", lambda sql, max_rows: ([{"keyword": "rust"}], False)
    )
    monkeypatch.setattr(
        trend_scan, "write_trend_events", lambda rows, event_date, now=None: "some/key.parquet"
    )

    result = trend_scan.lambda_handler({}, None)

    assert result["events_detected"] == 1
    assert result["s3_key"] == "some/key.parquet"


def test_lambda_handler_handles_zero_events(monkeypatch):
    monkeypatch.setattr(trend_scan.athena, "run_query", lambda sql, max_rows: ([], False))
    monkeypatch.setattr(trend_scan, "write_trend_events", lambda rows, event_date, now=None: "")

    result = trend_scan.lambda_handler({}, None)

    assert result["events_detected"] == 0
    assert result["s3_key"] == ""
