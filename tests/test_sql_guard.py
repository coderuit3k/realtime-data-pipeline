"""Tests for the Tier 2/3/4/5/6 correctness checks in common/sql_guard.py."""

import builtins

from common.sql_guard import (
    validate_aggregate_types,
    validate_athena_sql,
    validate_cast_types,
    validate_columns,
    validate_dialect_funcs,
    validate_group_by,
    validate_no_arrow,
    validate_no_date_on_varchar,
    validate_order_by_ordinal,
    validate_set_op_order,
    validate_subquery_alias,
    validate_union_columns,
    validate_where_clause,
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


# --- Tier 3: GROUP BY completeness ---


def test_group_by_rejects_bare_column():
    ok, reason = validate_group_by(
        "SELECT observed_at, AVG(temperature_c) AS a FROM weather_observations"
    )
    assert not ok
    assert "observed_at" in reason
    assert "GROUP BY" in reason


def test_group_by_rejects_wrong_group_key():
    ok, reason = validate_group_by(
        "SELECT observed_at, AVG(temperature_c) AS a FROM weather_observations GROUP BY location"
    )
    assert not ok


def test_group_by_accepts_positional_alias_expression():
    for sql in [
        "SELECT SUBSTR(observed_at,1,10) AS day, AVG(temperature_c) AS a "
        "FROM weather_observations GROUP BY 1",
        "SELECT SUBSTR(observed_at,1,10) AS day, AVG(temperature_c) AS a "
        "FROM weather_observations GROUP BY day",
        "SELECT SUBSTR(observed_at,1,10), AVG(temperature_c) "
        "FROM weather_observations GROUP BY SUBSTR(observed_at,1,10)",
    ]:
        ok, reason = validate_group_by(sql)
        assert ok, f"{sql!r} rejected: {reason}"


def test_group_by_skips_non_aggregated_queries():
    # no aggregates -> GROUP BY not required
    assert validate_group_by("SELECT observed_at, temperature_c FROM weather_observations")[0]
    # only aggregates -> fine
    assert validate_group_by("SELECT AVG(temperature_c) FROM weather_observations")[0]
    # window functions don't need GROUP BY
    assert validate_group_by(
        "SELECT full_name, ROW_NUMBER() OVER (PARTITION BY language ORDER BY stars DESC) AS rn "
        "FROM github_repos"
    )[0]


def test_group_by_fails_open_without_sqlglot(monkeypatch):
    real_import = builtins.__import__

    def fake_import(name, *args, **kwargs):
        if name == "sqlglot":
            raise ImportError("blocked for test")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", fake_import)
    assert validate_group_by("SELECT observed_at, AVG(x) FROM t") == (True, None)


def test_group_by_wired_into_full_validation():
    ok, reason = validate_athena_sql(
        "SELECT observed_at, AVG(temperature_c) AS a FROM weather_observations"
    )
    assert not ok
    assert "GROUP BY" in reason


# --- Tier 4: WHERE clause, => syntax, CAST types ---


def test_where_rejects_window_function():
    ok, reason = validate_where_clause(
        "SELECT story_id FROM hackernews_stories "
        "WHERE ROW_NUMBER() OVER (PARTITION BY story_id ORDER BY ingested_at DESC) = 1"
    )
    assert not ok
    assert "subquery" in reason


def test_where_rejects_aggregate():
    ok, reason = validate_where_clause("SELECT a FROM t WHERE AVG(x) > 5")
    assert not ok
    assert "HAVING" in reason


def test_where_allows_normal_and_having():
    assert validate_where_clause("SELECT a FROM t WHERE x > 5")[0]
    assert validate_where_clause(
        "SELECT a, AVG(x) AS m FROM t GROUP BY a HAVING AVG(x) > 5"
    )[0]


def test_no_arrow_rejects():
    ok, reason = validate_no_arrow("SELECT * FROM t WHERE f(x => 1)")
    assert not ok
    assert "positional" in reason


def test_no_arrow_allows_in_string_literal():
    assert validate_no_arrow("SELECT * FROM t WHERE x = 'a=>b'")[0]


def test_cast_types_rejects_float():
    ok, reason = validate_cast_types("SELECT CAST(price_usd AS float) FROM crypto_prices")
    assert not ok
    assert "REAL" in reason


def test_cast_types_allows_real():
    assert validate_cast_types("SELECT CAST(price_usd AS REAL) FROM crypto_prices")[0]


def test_tier4_wired_into_full_validation():
    ok, reason = validate_athena_sql(
        "SELECT story_id FROM hackernews_stories "
        "WHERE ROW_NUMBER() OVER (PARTITION BY story_id ORDER BY ingested_at DESC) = 1"
    )
    assert not ok
    assert "WHERE" in reason


# --- Tier 5: dialect funcs, subquery alias, date-on-varchar, order-by, union ---


def test_dialect_funcs_rejected():
    for sql, hint in [
        ("SELECT IFNULL(title, 'x') FROM t", "COALESCE"),
        ("SELECT NVL(score, 0) FROM t", "COALESCE"),
        ("SELECT LEN(title) FROM t", "LENGTH"),
    ]:
        ok, reason = validate_dialect_funcs(sql)
        assert not ok, sql
        assert hint in reason


def test_dialect_funcs_ok():
    assert validate_dialect_funcs("SELECT COALESCE(title, 'x') FROM t")[0]
    assert validate_dialect_funcs("SELECT * FROM t WHERE x = 'len('")[0]


def test_subquery_alias():
    ok, reason = validate_subquery_alias("SELECT * FROM (SELECT a FROM t)")
    assert not ok
    assert "alias" in reason
    assert validate_subquery_alias("SELECT * FROM (SELECT a FROM t) AS s")[0]
    assert validate_subquery_alias("WITH c AS (SELECT a FROM t) SELECT * FROM c")[0]


def test_no_date_on_varchar():
    ok, reason = validate_no_date_on_varchar("SELECT DATE(observed_at) FROM t")
    assert not ok
    assert "SUBSTR" in reason
    assert validate_no_date_on_varchar("SELECT SUBSTR(observed_at,1,10) FROM t")[0]


def test_order_by_ordinal():
    ok, reason = validate_order_by_ordinal("SELECT a, b FROM t ORDER BY 5")
    assert not ok
    assert "out of range" in reason
    assert validate_order_by_ordinal("SELECT a, b FROM t ORDER BY 2")[0]


def test_union_columns():
    ok, reason = validate_union_columns("SELECT a FROM t UNION SELECT a, b FROM u")
    assert not ok
    assert "same number of columns" in reason
    assert validate_union_columns("SELECT a, b FROM t UNION ALL SELECT c, d FROM u")[0]


def test_tier5_wired_into_full_validation():
    ok, reason = validate_athena_sql("SELECT IFNULL(title, 'x') FROM hackernews_stories")
    assert not ok
    assert "COALESCE" in reason


# --- Tier 6: aggregate arg types, set-op ordering ---


def test_aggregate_types_rejects_varchar():
    for sql, col in [
        ("SELECT AVG(title) FROM hackernews_stories", "title"),
        ("SELECT SUM(observed_at) FROM weather_observations", "observed_at"),
        ("SELECT AVG(DISTINCT title) FROM hackernews_stories", "title"),
        ("SELECT STDDEV(title) FROM hackernews_stories", "title"),
        ("SELECT VARIANCE(description) FROM github_repos", "description"),
    ]:
        ok, reason = validate_aggregate_types(sql)
        assert not ok, sql
        assert col in reason
        assert "numeric" in reason


def test_aggregate_types_accepts_numeric_and_fails_open():
    for sql in [
        "SELECT AVG(score) FROM hackernews_stories",
        "SELECT AVG(DISTINCT stars) FROM github_repos",
        "SELECT SUM(price_usd) FROM crypto_prices",
        "SELECT STDDEV(temperature_c) FROM weather_observations",
        # COUNT/MIN/MAX accept strings
        "SELECT COUNT(title) FROM hackernews_stories",
        "SELECT MIN(title), MAX(title) FROM hackernews_stories",
        # expressions fail open: string col inside CASE condition is fine
        "SELECT AVG(price_usd * 2) FROM crypto_prices",
        "SELECT AVG(CASE WHEN language = 'rust' THEN stars ELSE 0 END) FROM github_repos",
        # alias from subquery: not a real column, fail open
        "SELECT AVG(avg_temp) FROM (SELECT AVG(temperature_c) AS avg_temp "
        "FROM weather_observations)",
    ]:
        ok, reason = validate_aggregate_types(sql)
        assert ok, f"{sql!r} rejected: {reason}"


def test_set_op_order_rejects_order_limit_before_union():
    for sql in [
        "SELECT a FROM t1 ORDER BY a LIMIT 5 UNION ALL SELECT b FROM t2",
        "SELECT a FROM t1 LIMIT 5 UNION SELECT b FROM t2",
        "SELECT a FROM t1 ORDER BY a INTERSECT SELECT b FROM t2",
    ]:
        ok, reason = validate_set_op_order(sql)
        assert not ok, sql
        assert "UNION" in reason or "INTERSECT" in reason


def test_set_op_order_accepts_valid_forms():
    for sql in [
        "SELECT a FROM t1 UNION ALL SELECT b FROM t2 ORDER BY a LIMIT 5",
        "(SELECT a FROM t1 LIMIT 5) UNION ALL (SELECT b FROM t2 LIMIT 5)",
        "SELECT a FROM t1 UNION SELECT b FROM t2 UNION SELECT c FROM t3",
    ]:
        ok, reason = validate_set_op_order(sql)
        assert ok, f"{sql!r} rejected: {reason}"


def test_tier6_wired_into_full_validation():
    ok, reason = validate_athena_sql("SELECT AVG(title) FROM hackernews_stories")
    assert not ok
    assert "numeric" in reason
    ok, reason = validate_athena_sql(
        "SELECT author FROM hackernews_stories ORDER BY author LIMIT 5 "
        "UNION ALL SELECT provider FROM news_articles"
    )
    assert not ok
    assert "UNION" in reason
