"""Read-only SQL guard for the RAG agent's query_athena tool.

A port of web/lib/sqlGuard.ts: same regexes and forbidden keywords, keep the
two in sync. Messages are English rather than the TS version's Vietnamese on
purpose -- only the LLM and the logs ever see them, never the Data Explorer UI.

On top of the safety checks shared with the TS port, this module adds
Athena/Trino correctness checks (Python-only, no TS port needed):

- dialect check: reject QUALIFY (valid in Snowflake/BigQuery, syntax error in Trino)
- schema check: every referenced column must exist in the curated tables,
  with a "did you mean ...?" hint for typos like `keyword` vs `keywords`.
"""

import difflib
import re

FORBIDDEN_KEYWORDS = re.compile(
    r"\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|GRANT|REVOKE|TRUNCATE|MERGE|UNLOAD|VACUUM|CALL)\b",
    re.IGNORECASE,
)

# Athena runs Trino: QUALIFY (Snowflake/BigQuery) is a syntax error here.
QUALIFY_CLAUSE = re.compile(r"\bQUALIFY\b", re.IGNORECASE)

# Curated-table schemas, mirroring the query_athena tool description in
# rag/agent.py. year/month/day are partition columns present on every table.
TABLE_SCHEMAS = {
    "hackernews_stories": {
        "story_id", "title", "text", "author", "score", "num_comments",
        "url", "created_at", "ingested_at", "keywords",
        "year", "month", "day",
    },
    "news_articles": {
        "article_id", "provider", "title", "description", "url",
        "published_at", "ingested_at", "keywords",
        "year", "month", "day",
    },
    "weather_observations": {
        "location", "temperature_c", "humidity_pct", "precipitation_mm",
        "wind_speed_kmh", "observed_at",
        "year", "month", "day",
    },
    "crypto_prices": {
        "coin_id", "price_usd", "market_cap_usd", "volume_24h_usd",
        "change_24h_pct", "observed_at",
        "year", "month", "day",
    },
    "github_repos": {
        "repo_id", "full_name", "description", "language", "stars",
        "forks", "created_at", "pushed_at", "ingested_at", "keywords",
        "year", "month", "day",
    },
}

_ALL_COLUMNS = sorted(set().union(*TABLE_SCHEMAS.values()))


def validate_read_only_select(sql: str) -> tuple[bool, str | None]:
    """Return (ok, reason): accept a single SELECT/WITH statement with no write keywords.

    Keyword matching ignores context, so a forbidden word inside a string
    literal is rejected too -- it errs on the side of refusing.
    """
    trimmed = sql.strip()
    if not trimmed:
        return False, "The SQL statement is empty."
    if not re.match(r"^(SELECT|WITH)\b", trimmed, re.IGNORECASE):
        return False, "Only SELECT statements are allowed (optionally starting with WITH)."
    without_trailing_semicolon = re.sub(r";\s*$", "", trimmed)
    if ";" in without_trailing_semicolon:
        return False, "Multiple statements separated by ';' are not allowed."
    if FORBIDDEN_KEYWORDS.search(trimmed):
        return False, "The statement contains a disallowed keyword (read-only access only)."
    return True, None


def validate_trino_dialect(sql: str) -> tuple[bool, str | None]:
    """Reject SQL constructs that Athena (Trino) does not support."""
    if QUALIFY_CLAUSE.search(sql):
        return False, (
            "QUALIFY is not supported by Athena (Trino SQL). "
            "To keep one row per group, "
            "use a subquery: SELECT * FROM (SELECT ..., ROW_NUMBER() OVER "
            "(PARTITION BY ...) AS rn FROM ...) WHERE rn = 1."
        )
    return True, None


def validate_columns(sql: str) -> tuple[bool, str | None]:
    """Check every referenced column against the curated-table schemas.

    Fail-open: if sqlglot is not installed or the SQL cannot be parsed, the
    query passes through and Athena remains the judge. A false positive here
    would block a valid question, which is worse than one wasted Athena call.
    """
    try:
        import sqlglot
        from sqlglot import exp
    except ImportError:
        return True, None

    try:
        tree = sqlglot.parse_one(sql, read="trino")
    except Exception:
        return True, None

    defined_aliases = {
        a.alias.lower() for a in tree.find_all(exp.Alias) if a.alias
    }

    for column in tree.find_all(exp.Column):
        name = column.name.lower()
        if not name or name in defined_aliases:
            continue
        if name in _ALL_COLUMNS:
            continue
        hint = difflib.get_close_matches(name, _ALL_COLUMNS, n=1, cutoff=0.6)
        suggestion = f" Did you mean '{hint[0]}'?" if hint else ""
        return False, (
            f"Column '{column.name}' does not exist in the curated tables.{suggestion} "
            "Use only the column names listed in the tool description."
        )
    return True, None


def validate_athena_sql(sql: str) -> tuple[bool, str | None]:
    """Full pre-execution validation: safety, then dialect, then schema.

    Returns the first failure so the model gets one actionable error at a time.
    """
    for check in (validate_read_only_select, validate_trino_dialect, validate_columns):
        ok, reason = check(sql)
        if not ok:
            return ok, reason
    return True, None
