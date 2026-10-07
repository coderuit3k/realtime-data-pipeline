"""Guards for scripts/telegram_email_digest.sh, which has no other automated test."""

import re
from pathlib import Path

SCRIPT = (Path(__file__).parent.parent / "scripts" / "telegram_email_digest.sh").read_text()


def _query_block(name: str) -> str:
    """The text of the `<name>=$(run_query ...)` assignment."""
    match = re.search(rf"^{name}=\$\(run_query .*?\)$", SCRIPT, flags=re.S | re.M)
    assert match, f"no {name} query found"
    return match.group(0)


def test_the_deadline_query_looks_back_further_than_the_other_queries():
    """An email received long ago can state a deadline that is still ahead: its partition is old."""
    assert re.search(r'^DEADLINE_FROM_PART=\$\(date -u -d "(\d+) days ago"', SCRIPT, flags=re.M)
    days = int(re.search(r'DEADLINE_FROM_PART=\$\(date -u -d "(\d+) days ago"', SCRIPT).group(1))
    assert days >= 30
    assert "DEADLINE_FROM_PART" in _query_block("deadline_json")


def test_the_counts_reply_and_urgent_queries_keep_the_short_window():
    for name in ("counts_json", "reply_json", "urgent_json"):
        block = _query_block(name)
        assert "FROM_PART" in block and "DEADLINE_FROM_PART" not in block
