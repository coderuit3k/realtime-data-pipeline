"""Email labels for the Gmail classifier: vocabulary, Bedrock prompt, parsing and validation.

Pure functions only (no AWS), so the transform Lambda and the tests share them. The model's
answers are never stored raw: validate_label coerces every field into the fixed vocabulary.
"""

import json
import re
from datetime import date

CATEGORIES = ("newsletter", "notification", "personal", "recruiting", "other")
URGENCIES = ("high", "normal", "low")
JOB_STAGES = ("applied", "acknowledged", "interview", "offer", "rejected")
LABEL_FIELDS = ("category", "urgency", "needs_reply", "deadline", "job_stage", "company")

COMPANY_MAX_LENGTH = 100
SNIPPET_PROMPT_LENGTH = 200
_DATE_FORMAT = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def build_label_prompt(emails: list[dict], today: date) -> str:
    """One numbered prompt for the whole batch (one Bedrock call, not one per email)."""
    items = "\n".join(
        f"[{i + 1}] From: {e.get('from_address') or ''} | Subject: {e.get('subject') or ''} | "
        f"Preview: {(e.get('snippet') or '')[:SNIPPET_PROMPT_LENGTH]}"
        for i, e in enumerate(emails)
    )
    return (
        f"Today is {today.isoformat()}. Classify each numbered email below. For every email give: "
        f"category, one of {', '.join(CATEGORIES)}; urgency, one of {', '.join(URGENCIES)}; "
        "needs_reply, true only if the sender expects an answer from the recipient; deadline, "
        "the date (YYYY-MM-DD) something is due if the email states one, else an empty string; "
        f"job_stage, only for category recruiting, one of {', '.join(JOB_STAGES)} (applied = "
        "an application was submitted, acknowledged = the company confirmed receipt, interview "
        "= an interview or assessment is offered or scheduled, offer = a job offer, rejected = "
        "the application was declined), else an empty string; company, the hiring company name "
        "for recruiting email, else an empty string. Respond with ONLY a JSON array of objects "
        '-- {"i": <item number>, "category": "...", "urgency": "...", "needs_reply": true, '
        '"deadline": "", "job_stage": "", "company": ""} -- one per item, using the item\'s own '
        '[N] number as "i". Skip an item instead of guessing if it is unreadable. No other '
        f"text.\n\n{items}"
    )


def _valid_date(value) -> str:
    if not isinstance(value, str) or not _DATE_FORMAT.match(value):
        return ""
    try:
        date.fromisoformat(value)
    except ValueError:
        return ""
    return value


def validate_label(entry: dict) -> dict:
    """Coerce one model entry into the fixed label shape; unknown values become safe defaults."""
    category = entry.get("category")
    category = category.strip().lower() if isinstance(category, str) else ""
    if category not in CATEGORIES:
        category = "other"

    urgency = entry.get("urgency")
    urgency = urgency.strip().lower() if isinstance(urgency, str) else ""
    if urgency not in URGENCIES:
        urgency = "normal"

    job_stage = entry.get("job_stage")
    job_stage = job_stage.strip().lower() if isinstance(job_stage, str) else ""
    company = entry.get("company")
    company = company.strip()[:COMPANY_MAX_LENGTH] if isinstance(company, str) else ""
    if category != "recruiting":
        job_stage, company = "", ""
    elif job_stage not in JOB_STAGES:
        job_stage = ""

    return {
        "category": category,
        "urgency": urgency,
        "needs_reply": entry.get("needs_reply") is True,
        "deadline": _valid_date(entry.get("deadline")),
        "job_stage": job_stage,
        "company": company,
    }


def parse_label_response(raw: str, expected_count: int) -> list[dict | None]:
    """Map the model's JSON reply back to input order, keyed by each entry's "i".

    Matching on "i" rather than position means a skipped entry can only leave that one email
    without a label. A reply that does not fit the batch is rejected as a whole (ValueError), so
    the emails stay unlabelled and are retried on the next run instead of getting wrong labels:
    an index outside 1..expected_count means the model numbered the items differently (for
    example from 0), which shifts every label. An index used twice is ambiguous, so neither of
    its entries is used.
    """
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\n|\n```$", "", cleaned)
    entries = json.loads(cleaned)
    if not isinstance(entries, list):
        raise ValueError(f"Expected a JSON array, got: {entries!r}")

    by_index: dict[int, dict] = {}
    repeated: set[int] = set()
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        i = entry.get("i")
        if not isinstance(i, int) or isinstance(i, bool):
            continue
        if not 1 <= i <= expected_count:
            raise ValueError(f"Item number {i} is outside 1..{expected_count}")
        if i in by_index:
            repeated.add(i)
        by_index[i] = validate_label(entry)

    return [None if i + 1 in repeated else by_index.get(i + 1) for i in range(expected_count)]
