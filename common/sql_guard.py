"""Read-only SQL guard for the RAG agent's query_athena tool.

A port of web/lib/sqlGuard.ts: same regexes and forbidden keywords, keep the
two in sync. Messages are English rather than the TS version's Vietnamese on
purpose -- only the LLM and the logs ever see them, never the Data Explorer UI.

On top of the safety checks shared with the TS port, this module adds
Athena/Trino correctness checks (Python-only, no TS port needed):

- dialect check: reject QUALIFY (valid in Snowflake/BigQuery, syntax error in Trino)
- schema check: every referenced column must exist in the curated tables,
  with a "did you mean ...?" hint for typos like `keyword` vs `keywords`.
- group-by check: when a SELECT mixes aggregates with other expressions, every
  non-aggregated expression must appear in GROUP BY (catches
  EXPRESSION_NOT_AGGREGATE before Athena).
- where-clause check: WHERE cannot contain window functions or aggregates
  (catches EXPRESSION_NOT_SCALAR before Athena).
- arrow check: reject `=>` named-argument syntax (not valid Trino).
- cast-type check: reject non-Trino type names like `float`/`string`/`text`
  in CAST (catches TYPE_MISMATCH before Athena).
- dialect-func check: reject wrong-dialect functions (IFNULL, NVL, LEN, ...)
  with the Trino equivalent.
- subquery-alias check: derived tables in FROM must have an alias in Trino.
- date-on-varchar check: date functions on VARCHAR timestamp columns
  (observed_at, ...) won't work -- use SUBSTR instead.
- order-by check: positional ORDER BY must be within the SELECT list range.
- union check: UNION/INTERSECT/EXCEPT sides must have equal column counts.

The sqlglot-based checks fail open: if sqlglot is missing or the SQL cannot be
parsed, the query passes through and Athena remains the judge.
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
# This dict is the source of truth for the column check; the tool description
# prose is written for the model, this is what gets enforced.
TABLE_SCHEMAS = {
    "hackernews_stories": {
        "story_id",
        "title",
        "text",
        "author",
        "score",
        "num_comments",
        "url",
        "created_at",
        "ingested_at",
        "keywords",
        "year",
        "month",
        "day",
    },
    "news_articles": {
        "article_id",
        "provider",
        "title",
        "description",
        "url",
        "published_at",
        "ingested_at",
        "keywords",
        "year",
        "month",
        "day",
    },
    "weather_observations": {
        "location",
        "temperature_c",
        "humidity_pct",
        "precipitation_mm",
        "wind_speed_kmh",
        "observed_at",
        "year",
        "month",
        "day",
    },
    "crypto_prices": {
        "coin_id",
        "price_usd",
        "market_cap_usd",
        "volume_24h_usd",
        "change_24h_pct",
        "observed_at",
        "year",
        "month",
        "day",
    },
    "github_repos": {
        "repo_id",
        "full_name",
        "description",
        "language",
        "stars",
        "forks",
        "created_at",
        "pushed_at",
        "ingested_at",
        "keywords",
        "year",
        "month",
        "day",
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

    defined_aliases = {a.alias.lower() for a in tree.find_all(exp.Alias) if a.alias}

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


def _gb_norm(expr) -> str:
    return expr.sql(dialect="trino").lower()


def _gb_bare_columns(expr, exp) -> set:
    """Column refs in expr that are NOT inside an aggregate function.

    Window-function internals (PARTITION BY ...) are not bare: windows don't
    trigger GROUP BY requirements.
    """
    if isinstance(expr, exp.Window):
        return set()
    all_cols = {_gb_norm(c) for c in expr.find_all(exp.Column)}
    agg_cols = set()
    for agg in expr.find_all(exp.AggFunc):
        agg_cols.update(_gb_norm(c) for c in agg.find_all(exp.Column))
    return all_cols - agg_cols


def _gb_check_scope(select, exp) -> tuple[bool, str | None]:
    """Check one SELECT scope for GROUP BY completeness. Fail-open when uncertain."""
    targets = [e.this if isinstance(e, exp.Alias) else e for e in select.expressions]

    has_agg = any(t.find(exp.AggFunc) for t in targets)
    if not has_agg:
        return True, None  # no aggregation -> GROUP BY not required

    # Alias map for resolving GROUP BY references.
    aliases = {}
    norm_selects = []
    for e in select.expressions:
        if isinstance(e, exp.Alias):
            aliases[e.alias.lower()] = e.this
            norm_selects.append(_gb_norm(e.this))
        else:
            norm_selects.append(_gb_norm(e))

    # Normalized GROUP BY keys (resolve positionals and aliases).
    group_keys = set()
    group_by = select.args.get("group")
    if group_by:
        for gb in group_by.expressions:
            if isinstance(gb, exp.Literal) and not gb.is_string:
                try:
                    pos = int(gb.name) - 1
                    if 0 <= pos < len(norm_selects):
                        group_keys.add(norm_selects[pos])
                        continue
                except (ValueError, IndexError):
                    pass
            if isinstance(gb, exp.Column) and gb.name.lower() in aliases:
                group_keys.add(_gb_norm(aliases[gb.name.lower()]))
                continue
            group_keys.add(_gb_norm(gb))

    for target in targets:
        if not _gb_bare_columns(target, exp):
            continue  # pure aggregate / literal / star / window
        if _gb_norm(target) in group_keys:
            continue
        return False, (
            f"Expression '{target.sql(dialect='trino')}' is not an aggregate function "
            f"and does not appear in GROUP BY. Either wrap it in an aggregate "
            f"or add it to GROUP BY (e.g. GROUP BY 1 for the first select expression)."
        )
    return True, None


def validate_group_by(sql: str) -> tuple[bool, str | None]:
    """Check GROUP BY completeness for every SELECT scope in the query.

    Fail-open: if sqlglot is missing or the SQL cannot be parsed, the query
    passes through and Athena remains the judge.
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
    for select in tree.find_all(exp.Select):
        ok, reason = _gb_check_scope(select, exp)
        if not ok:
            return False, reason
    return True, None


def validate_where_clause(sql: str) -> tuple[bool, str | None]:
    """WHERE cannot contain window functions, aggregates or grouping operations.

    Fail-open: if sqlglot is missing or the SQL cannot be parsed, the query
    passes through and Athena remains the judge.
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
    for where in tree.find_all(exp.Where):
        if where.find(exp.Window):
            return False, (
                "Window functions (e.g. ROW_NUMBER()) cannot appear in WHERE. "
                "Compute it in a subquery first: SELECT * FROM (SELECT ..., "
                "ROW_NUMBER() OVER (...) AS rn FROM ...) WHERE rn = 1."
            )
        if where.find(exp.AggFunc):
            return False, (
                "Aggregate functions cannot appear in WHERE. Use HAVING for "
                "post-aggregation filters, or compute the aggregate in a subquery first."
            )
    return True, None


def validate_no_arrow(sql: str) -> tuple[bool, str | None]:
    """Reject `=>` named-argument syntax, which is not valid Trino."""
    no_strings = re.sub(r"'[^']*'", "''", sql)
    if "=>" in no_strings:
        return False, (
            "'=>' is not valid Trino syntax (it is named-argument syntax from other "
            "dialects). Use positional arguments instead, e.g. date_trunc('day', observed_at)."
        )
    return True, None


# Common non-Trino type names the model reaches for, and what to use instead.
_BAD_CAST_TYPES = {
    "float": "REAL or DOUBLE",
    "string": "VARCHAR",
    "text": "VARCHAR",
}


def validate_cast_types(sql: str) -> tuple[bool, str | None]:
    """Reject non-Trino type names in CAST (catches TYPE_MISMATCH before Athena)."""
    m = re.search(r"\bAS\s+(float|string|text)\b", sql, re.IGNORECASE)
    if m:
        bad = m.group(1).lower()
        good = _BAD_CAST_TYPES[bad].split(" or ")[0]
        return False, (
            f"'{m.group(1)}' is not a Trino type. Use {_BAD_CAST_TYPES[bad]} instead, "
            f"e.g. CAST(x AS {good})."
        )
    return True, None


# Wrong-dialect functions the model borrows from MySQL/Oracle/SQL Server,
# mapped to the Trino equivalent.
_WRONG_DIALECT_FUNCS = {
    "ifnull": "COALESCE",
    "nvl": "COALESCE",
    "isnull": "COALESCE",
    "nz": "COALESCE",
    "len": "LENGTH",
    "getdate": "CURRENT_TIMESTAMP",
    "sysdate": "CURRENT_TIMESTAMP",
    "decode": "a CASE WHEN expression",
}


def validate_dialect_funcs(sql: str) -> tuple[bool, str | None]:
    """Reject functions from other SQL dialects with the Trino equivalent."""
    no_strings = re.sub(r"'[^']*'", "''", sql)
    for bad, good in _WRONG_DIALECT_FUNCS.items():
        if re.search(rf"\b{bad}\s*\(", no_strings, re.IGNORECASE):
            return False, f"'{bad.upper()}' is not a Trino function. Use {good} instead."
    return True, None


# VARCHAR timestamp columns ('yyyy-MM-dd HH:mm:ss.SSSSSS'): date functions don't
# work on them -- the tool description says to use SUBSTR instead.
_VARCHAR_TIMESTAMPS = {"observed_at", "created_at", "published_at", "ingested_at", "pushed_at"}
_DATE_FUNCS = {
    "DATE",
    "YEAR",
    "MONTH",
    "DAY",
    "HOUR",
    "MINUTE",
    "SECOND",
    "DATE_TRUNC",
    "DATE_ADD",
    "DATE_DIFF",
    "DATE_PARSE",
    "DATE_FORMAT",
}


def validate_no_date_on_varchar(sql: str) -> tuple[bool, str | None]:
    """Reject date functions applied to VARCHAR timestamp columns."""
    try:
        import sqlglot
        from sqlglot import exp
    except ImportError:
        return True, None
    try:
        tree = sqlglot.parse_one(sql, read="trino")
    except Exception:
        return True, None
    for func in tree.find_all(exp.Func):
        if func.sql_name().upper() not in _DATE_FUNCS:
            continue
        for col in func.find_all(exp.Column):
            if col.name.lower() in _VARCHAR_TIMESTAMPS:
                return False, (
                    f"'{col.name}' is a VARCHAR timestamp ('yyyy-MM-dd HH:mm:ss.SSSSSS'), "
                    f"not a TIMESTAMP. Date functions like {func.sql_name().upper()}() won't "
                    f"work on it. Use SUBSTR({col.name},1,10) for the date part instead."
                )
    return True, None


def validate_subquery_alias(sql: str) -> tuple[bool, str | None]:
    """Derived tables in FROM must have an alias in Trino."""
    try:
        import sqlglot
        from sqlglot import exp
    except ImportError:
        return True, None
    try:
        tree = sqlglot.parse_one(sql, read="trino")
    except Exception:
        return True, None
    for sub in tree.find_all(exp.Subquery):
        if not sub.alias and sub.find(exp.Select):
            return False, (
                "Subquery in FROM must have an alias in Trino. "
                "Write FROM (SELECT ...) AS t instead of FROM (SELECT ...)."
            )
    return True, None


def validate_order_by_ordinal(sql: str) -> tuple[bool, str | None]:
    """Positional ORDER BY must reference a SELECT list position that exists."""
    try:
        import sqlglot
        from sqlglot import exp
    except ImportError:
        return True, None
    try:
        tree = sqlglot.parse_one(sql, read="trino")
    except Exception:
        return True, None
    for select in tree.find_all(exp.Select):
        n = len(select.expressions)
        order = select.args.get("order")
        if not order:
            continue
        for ob in order.expressions:
            target = ob.this if isinstance(ob, exp.Ordered) else ob
            if isinstance(target, exp.Literal) and not target.is_string:
                try:
                    pos = int(target.name)
                    if pos < 1 or pos > n:
                        return False, (
                            f"ORDER BY position {pos} is out of range: the SELECT list "
                            f"has only {n} expression(s). Use a position between 1 and {n}, "
                            f"or the column/expression directly."
                        )
                except ValueError:
                    pass
    return True, None


def validate_union_columns(sql: str) -> tuple[bool, str | None]:
    """UNION/INTERSECT/EXCEPT sides must return the same number of columns."""
    try:
        import sqlglot
        from sqlglot import exp
    except ImportError:
        return True, None
    try:
        tree = sqlglot.parse_one(sql, read="trino")
    except Exception:
        return True, None
    for u in tree.find_all(exp.Union, exp.Intersect, exp.Except):
        left_n = len(u.left.expressions) if isinstance(u.left, exp.Select) else None
        right_n = len(u.right.expressions) if isinstance(u.right, exp.Select) else None
        if left_n is not None and right_n is not None and left_n != right_n:
            return False, (
                "Set operation requires both sides to have the same number of columns: "
                f"left has {left_n}, right has {right_n}."
            )
    return True, None


def validate_athena_sql(sql: str) -> tuple[bool, str | None]:
    """Full pre-execution validation, cheapest and most fundamental checks first.

    Returns the first failure so the model gets one actionable error at a time.
    """
    for check in (
        validate_read_only_select,
        validate_trino_dialect,
        validate_dialect_funcs,
        validate_no_arrow,
        validate_cast_types,
        validate_columns,
        validate_no_date_on_varchar,
        validate_subquery_alias,
        validate_group_by,
        validate_where_clause,
        validate_order_by_ordinal,
        validate_union_columns,
    ):
        ok, reason = check(sql)
        if not ok:
            return ok, reason
    return True, None
