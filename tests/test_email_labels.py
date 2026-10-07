import json
from datetime import date

import pytest

from common import email_labels as el

TODAY = date(2026, 10, 6)


def _entry(**overrides):
    base = {
        "i": 1,
        "category": "recruiting",
        "urgency": "high",
        "needs_reply": True,
        "deadline": "2026-10-10",
        "job_stage": "interview",
        "company": "Acme",
    }
    base.update(overrides)
    return base


def test_label_fields_are_the_six_columns_in_order():
    assert el.LABEL_FIELDS == (
        "category", "urgency", "needs_reply", "deadline", "job_stage", "company"
    )


def test_build_label_prompt_numbers_each_email_and_includes_todays_date():
    emails = [
        {"from_address": "Jobs <jobs@acme.com>", "subject": "Interview invite", "snippet": "Hi"},
        {"from_address": "news@x.com", "subject": "Weekly digest", "snippet": "Top stories"},
    ]

    prompt = el.build_label_prompt(emails, TODAY)

    assert "2026-10-06" in prompt
    assert "[1]" in prompt and "[2]" in prompt
    assert "Interview invite" in prompt and "Weekly digest" in prompt
    for value in el.CATEGORIES + el.URGENCIES + el.JOB_STAGES:
        assert value in prompt


def test_build_label_prompt_truncates_a_very_long_snippet():
    emails = [{"from_address": "a@b.c", "subject": "s", "snippet": "x" * 5000}]

    assert len(el.build_label_prompt(emails, TODAY)) < 3000


def test_validate_label_keeps_valid_values():
    label = el.validate_label(_entry())

    assert label == {
        "category": "recruiting",
        "urgency": "high",
        "needs_reply": True,
        "deadline": "2026-10-10",
        "job_stage": "interview",
        "company": "Acme",
    }


def test_validate_label_replaces_invented_values_with_safe_defaults():
    label = el.validate_label(
        _entry(category="spam", urgency="asap", needs_reply="yes", deadline="next friday")
    )

    assert label["category"] == "other"
    assert label["urgency"] == "normal"
    assert label["needs_reply"] is False
    assert label["deadline"] == ""


def test_validate_label_rejects_an_impossible_calendar_date():
    assert el.validate_label(_entry(deadline="2026-13-45"))["deadline"] == ""


def test_validate_label_empties_job_fields_unless_the_email_is_recruiting():
    label = el.validate_label(_entry(category="newsletter"))

    assert label["job_stage"] == ""
    assert label["company"] == ""


def test_validate_label_drops_an_unknown_job_stage_and_trims_the_company():
    label = el.validate_label(_entry(job_stage="ghosted", company="  " + "A" * 300 + "  "))

    assert label["job_stage"] == ""
    assert label["company"] == "A" * 100


def test_validate_label_handles_missing_and_null_fields():
    label = el.validate_label({"i": 1, "category": None, "company": None})

    assert label == {
        "category": "other",
        "urgency": "normal",
        "needs_reply": False,
        "deadline": "",
        "job_stage": "",
        "company": "",
    }


def test_parse_label_response_maps_labels_by_item_number():
    raw = json.dumps([_entry(i=2, category="newsletter"), _entry(i=1)])

    labels = el.parse_label_response(raw, 2)

    assert labels[0]["category"] == "recruiting"
    assert labels[1]["category"] == "newsletter"


def test_parse_label_response_leaves_a_skipped_item_as_none():
    labels = el.parse_label_response(json.dumps([_entry(i=1)]), 3)

    assert labels[0] is not None
    assert labels[1] is None and labels[2] is None


def test_parse_label_response_ignores_entries_that_are_not_objects():
    raw = json.dumps(["junk", 5, _entry(i=1)])

    labels = el.parse_label_response(raw, 1)

    assert len(labels) == 1 and labels[0] is not None


@pytest.mark.parametrize("index", [0, 3])
def test_parse_label_response_fails_the_batch_when_an_index_is_out_of_range(index):
    """A model that numbers from 0 (or past the end) has shifted every label: trust none of them."""
    raw = json.dumps([_entry(i=index), _entry(i=1)])

    with pytest.raises(ValueError):
        el.parse_label_response(raw, 2)


def test_parse_label_response_leaves_a_repeated_index_unlabelled_instead_of_picking_one():
    raw = json.dumps([_entry(i=1, category="newsletter"), _entry(i=1, category="personal")])

    labels = el.parse_label_response(raw, 2)

    assert labels == [None, None]


def test_parse_label_response_accepts_a_fenced_reply():
    raw = "```json\n" + json.dumps([_entry(i=1)]) + "\n```"

    assert el.parse_label_response(raw, 1)[0]["category"] == "recruiting"


def test_parse_label_response_rejects_a_reply_that_is_not_a_json_array():
    with pytest.raises(ValueError):
        el.parse_label_response("not json at all", 1)
    with pytest.raises(ValueError):
        el.parse_label_response(json.dumps({"i": 1}), 1)
