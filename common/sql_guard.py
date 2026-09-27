import re

# A Python port of web/lib/sqlGuard.ts's rules (same regexes, same forbidden
# keywords), used by the RAG agent's query_athena tool. Messages are in
# English, not Vietnamese like the TS version's -- these are only ever seen
# by the LLM and in logs, never rendered in the (Vietnamese) Data Explorer
# UI, so this is an intentional divergence, not an incomplete port.
FORBIDDEN_KEYWORDS = re.compile(
    r"\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|GRANT|REVOKE|TRUNCATE|MERGE|UNLOAD|VACUUM|CALL)\b",
    re.IGNORECASE,
)


def validate_read_only_select(sql: str) -> tuple[bool, str | None]:
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
