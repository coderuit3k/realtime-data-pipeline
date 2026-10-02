"""Read-only SQL guard for the RAG agent's query_athena tool.

A port of web/lib/sqlGuard.ts: same regexes and forbidden keywords, keep the
two in sync. Messages are English rather than the TS version's Vietnamese on
purpose -- only the LLM and the logs ever see them, never the Data Explorer UI.
"""

import re

FORBIDDEN_KEYWORDS = re.compile(
    r"\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|GRANT|REVOKE|TRUNCATE|MERGE|UNLOAD|VACUUM|CALL)\b",
    re.IGNORECASE,
)


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
