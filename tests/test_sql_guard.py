"""Tests for the Tier 2 correctness checks in common/sql_guard.py."""

import builtins

from common.sql_guard import (  # noqa: E402
    validate_athena_sql,
    validate_columns,
)


def test_rejects_unknown_column_with_hint():
    ok, reason = validate_athena_sql("SELECT keyword FROM hackernews_stories")
    assert not ok
    assert "keywords" in reason  # did-you-mean hint


def test_rejects_qualify_with_rewrite_guidance():
    ok, reason = validate_athena_sql(
        "SELECT full_name, ROW_NUMBER() OVER (PARTITION BY language ORDER BY stars DESC) AS rn "
        "FROM github_repos QUALIFY rn <= 3"
    )
    assert not ok
    assert "QUALIFY is not supported" in reason
    assert "ROW_NUMBER()" in reason


def test_accepts_valid_queries():
    valid = [
        # aliases + positional GROUP BY
        "SELECT SUBSTR(observed_at,1,10) AS day, AVG(temperature_c) "
        "FROM weather_observations GROUP BY 1",
        # CTE + window function
        "WITH r AS (SELECT full_name, ROW_NUMBER() OVER (ORDER BY stars DESC) AS rn "
        "FROM github_repos) SELECT full_name FROM r WHERE rn <= 3",
        # star + string literal
        "SELECT * FROM crypto_prices WHERE coin_id = 'bitcoin'",
        # LIKE on keywords with string literal
        "SELECT title FROM news_articles WHERE keywords LIKE '%rust%'",
        # partition columns
        "SELECT year, month, day, COUNT(*) FROM hackernews_stories GROUP BY 1,2,3",
    ]
    for sql in valid:
        ok, reason = validate_athena_sql(sql)
        assert ok, f"{sql!r} rejected: {reason}"


def test_safety_checks_still_hold():
    assert not validate_athena_sql("DROP TABLE t")[0]
    assert not validate_athena_sql("INSERT INTO t VALUES (1)")[0]
    assert not validate_athena_sql("")[0]


def test_column_check_fails_open_without_sqlglot(monkeypatch):
    real_import = builtins.__import__

    def fake_import(name, *args, **kwargs):
        if name == "sqlglot":
            raise ImportError("blocked for test")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", fake_import)
    # unknown column passes through when sqlglot is unavailable; Athena decides
    assert validate_columns("SELECT keyword FROM hackernews_stories") == (True, None)
    # safety check does not depend on sqlglot
    assert not validate_athena_sql("DROP TABLE t")[0]


def test_rejects_hallucinated_column():
    ok, reason = validate_athena_sql("SELECT sentiment_score FROM news_articles LIMIT 5")
    assert not ok
    assert "does not exist" in reason
