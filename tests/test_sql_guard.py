import pytest

from common.sql_guard import validate_read_only_select


def test_accepts_a_plain_select():
    assert validate_read_only_select("SELECT * FROM crypto_prices") == (True, None)


def test_accepts_a_with_select_cte():
    assert validate_read_only_select("WITH x AS (SELECT 1) SELECT * FROM x") == (True, None)


def test_accepts_leading_whitespace_and_lowercase_select():
    assert validate_read_only_select("  select 1") == (True, None)


def test_rejects_an_empty_string():
    ok, _reason = validate_read_only_select("   ")
    assert ok is False


def test_rejects_a_statement_that_doesnt_start_with_select_or_with():
    ok, reason = validate_read_only_select("EXPLAIN SELECT * FROM crypto_prices")
    assert (ok, reason) == (
        False,
        "Only SELECT statements are allowed (optionally starting with WITH).",
    )


@pytest.mark.parametrize(
    "sql",
    [
        "INSERT INTO crypto_prices VALUES (1)",
        "UPDATE crypto_prices SET price_usd=1",
        "DELETE FROM crypto_prices",
        "DROP TABLE crypto_prices",
        "ALTER TABLE crypto_prices ADD COLUMN x int",
        "CREATE TABLE x AS SELECT * FROM crypto_prices",
        "GRANT SELECT ON crypto_prices TO someone",
        "REVOKE SELECT ON crypto_prices FROM someone",
        "TRUNCATE TABLE crypto_prices",
        "MERGE INTO crypto_prices USING x ON true WHEN MATCHED THEN DELETE",
        "UNLOAD (SELECT 1) TO 's3://bucket/' WITH (format='JSON')",
        "VACUUM crypto_prices",
        "CALL some_procedure()",
    ],
)
def test_rejects_forbidden_statements(sql):
    ok, _reason = validate_read_only_select(sql)
    assert ok is False


def test_rejects_a_forbidden_keyword_smuggled_inside_a_cte_under_a_legitimate_prefix():
    ok, reason = validate_read_only_select(
        "WITH x AS (INSERT INTO crypto_prices VALUES (1)) SELECT * FROM x"
    )
    assert (ok, reason) == (
        False,
        "The statement contains a disallowed keyword (read-only access only).",
    )


def test_rejects_a_select_followed_by_a_second_statement():
    ok, reason = validate_read_only_select("SELECT 1; DROP TABLE crypto_prices")
    assert (ok, reason) == (False, "Multiple statements separated by ';' are not allowed.")


def test_allows_a_single_trailing_semicolon():
    assert validate_read_only_select("SELECT 1;") == (True, None)


def test_does_not_false_positive_on_a_forbidden_word_substring_in_a_column_name():
    # 'created_at' contains no forbidden keyword as a whole word; guards
    # against a naive substring match rejecting legitimate queries.
    assert validate_read_only_select("SELECT created_at FROM hackernews_stories") == (True, None)
