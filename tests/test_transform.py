import json

import pandas as pd

from common import config
from transform import transform


def test_extract_keywords_drops_stopwords_and_short_words():
    keywords = transform.extract_keywords("The Bitcoin price is up and the market is bullish")

    assert "bitcoin" in keywords
    assert "price" in keywords
    assert "the" not in keywords


def test_dedup_records_keeps_first_occurrence():
    records = [{"id": "1", "v": "a"}, {"id": "2", "v": "b"}, {"id": "1", "v": "c"}]

    result = transform.dedup_records(records, "id")

    assert result == [{"id": "1", "v": "a"}, {"id": "2", "v": "b"}]


def test_clean_hackernews_record_strips_fields():
    record = {"story_id": "s1", "title": "  Bitcoin surges  ", "text": " market rally "}

    result = transform.clean_hackernews_record(record)

    assert result["title"] == "Bitcoin surges"
    assert result["text"] == "market rally"
    assert "keywords" not in result


def test_clean_news_record_strips_fields():
    record = {"article_id": "a1", "title": "  Bitcoin rallies  ", "description": " prices climb "}

    result = transform.clean_news_record(record)

    assert result["title"] == "Bitcoin rallies"
    assert "keywords" not in result


def test_record_text_hackernews_combines_title_and_text():
    record = {"title": "Bitcoin surges", "text": "market rally"}
    assert transform.record_text(record, "hackernews") == "Bitcoin surges market rally"


def test_record_text_news_combines_title_and_description():
    record = {"title": "Bitcoin rallies", "description": "prices climb"}
    assert transform.record_text(record, "news") == "Bitcoin rallies prices climb"


def test_build_keyword_prompt_numbers_each_item():
    prompt = transform.build_keyword_prompt(["first item", "second item"])

    assert "[1] first item" in prompt
    assert "[2] second item" in prompt


def test_parse_keyword_response_parses_indexed_json_array():
    raw = '[{"i": 1, "keywords": "bitcoin, rally"}, {"i": 2, "keywords": "ether, defi"}]'
    result = transform.parse_keyword_response(raw, expected_count=2)

    assert result == [["bitcoin", "rally"], ["ether", "defi"]]


def test_parse_keyword_response_strips_markdown_code_fence():
    raw = '```json\n[{"i": 1, "keywords": "bitcoin, rally"}]\n```'
    result = transform.parse_keyword_response(raw, expected_count=1)

    assert result == [["bitcoin", "rally"]]


def test_parse_keyword_response_returns_none_for_item_the_model_skipped():
    # The model only returned "i": 1 out of an expected 2 -- item 2 (0-indexed
    # position 1) must come back None, not raise and discard item 1's result.
    raw = '[{"i": 1, "keywords": "only, one"}]'
    result = transform.parse_keyword_response(raw, expected_count=2)

    assert result == [["only", "one"], None]


def test_parse_keyword_response_ignores_out_of_range_index():
    raw = '[{"i": 1, "keywords": "a, b"}, {"i": 99, "keywords": "c, d"}]'
    result = transform.parse_keyword_response(raw, expected_count=2)

    assert result == [["a", "b"], None]


def test_extract_keywords_llm_falls_back_to_regex_for_skipped_item_only(monkeypatch):
    class FakeBody:
        def read(self):
            return json.dumps(
                {"content": [{"text": '[{"i": 1, "keywords": "bitcoin, rally"}]'}]}
            ).encode("utf-8")

    class FakeBedrock:
        def invoke_model(self, **kwargs):
            return {"body": FakeBody()}

    monkeypatch.setattr(transform, "_bedrock", lambda: FakeBedrock())

    result = transform.extract_keywords_llm(["Bitcoin surges", "Ethereum upgrade rollout delayed"])

    assert result[0] == ["bitcoin", "rally"]
    # Item 2 was skipped by the model -- must fall back to regex for just this
    # one item, not discard item 1's real LLM-extracted keywords too.
    assert "ethereum" in result[1]


def test_attach_keywords_uses_llm_result(monkeypatch):
    def fake_llm(texts):
        return [["a", "b"] for _ in texts]

    monkeypatch.setattr(transform, "extract_keywords_llm", fake_llm)
    records = [{"title": "x", "text": "y"}]

    result = transform.attach_keywords(records, "hackernews")

    assert result[0]["keywords"] == ["a", "b"]


def test_attach_keywords_falls_back_to_regex_on_llm_failure(monkeypatch):
    def failing_llm(texts):
        raise RuntimeError("bedrock unavailable")

    monkeypatch.setattr(transform, "extract_keywords_llm", failing_llm)
    records = [{"title": "Bitcoin surges", "text": "market rally"}]

    result = transform.attach_keywords(records, "hackernews")

    assert "bitcoin" in result[0]["keywords"]


def test_transform_records_dedups_hackernews_by_story_id(monkeypatch):
    monkeypatch.setattr(transform, "extract_keywords_llm", lambda texts: [[] for _ in texts])
    records = [
        {"story_id": "s1", "title": "a", "text": ""},
        {"story_id": "s1", "title": "a", "text": ""},
    ]

    result = transform.transform_records("hackernews", records)

    assert len(result) == 1


def test_transform_records_dedups_weather_by_weather_id_no_llm_call(monkeypatch):
    def fail_if_called(texts):
        raise AssertionError("weather records should never trigger keyword extraction")

    monkeypatch.setattr(transform, "extract_keywords_llm", fail_if_called)
    records = [
        {"weather_id": "hcmc-t1", "location": "Ho Chi Minh City", "temperature_c": 29.3},
        {"weather_id": "hcmc-t1", "location": "Ho Chi Minh City", "temperature_c": 29.3},
    ]

    result = transform.transform_records("weather", records)

    assert len(result) == 1
    assert result[0]["keywords"] == []


def test_transform_records_dedups_crypto_by_price_id_no_llm_call(monkeypatch):
    def fail_if_called(texts):
        raise AssertionError("crypto records should never trigger keyword extraction")

    monkeypatch.setattr(transform, "extract_keywords_llm", fail_if_called)
    records = [
        {"price_id": "bitcoin-1", "coin_id": "bitcoin", "price_usd": 81314.0},
        {"price_id": "bitcoin-1", "coin_id": "bitcoin", "price_usd": 81314.0},
    ]

    result = transform.transform_records("crypto", records)

    assert len(result) == 1
    assert result[0]["keywords"] == []


def test_record_text_github_combines_full_name_and_description():
    record = {"full_name": "org/repo", "description": "a fast tool"}
    assert transform.record_text(record, "github") == "org/repo a fast tool"


def test_clean_github_record_strips_fields():
    record = {"repo_id": "1", "full_name": "  org/repo  ", "description": " a tool "}

    result = transform.clean_github_record(record)

    assert result["full_name"] == "org/repo"
    assert result["description"] == "a tool"


def test_transform_records_dedups_github_by_repo_id_and_attaches_keywords(monkeypatch):
    fake_llm = lambda texts: [["a", "b"] for _ in texts]  # noqa: E731
    monkeypatch.setattr(transform, "extract_keywords_llm", fake_llm)
    records = [
        {"repo_id": "1", "full_name": "org/repo", "description": ""},
        {"repo_id": "1", "full_name": "org/repo", "description": ""},
    ]

    result = transform.transform_records("github", records)

    assert len(result) == 1
    assert result[0]["keywords"] == ["a", "b"]


def test_record_text_gmail_combines_subject_and_snippet():
    record = {"subject": "Weekly digest", "snippet": "top stories inside"}
    assert transform.record_text(record, "gmail") == "Weekly digest top stories inside"


def test_clean_gmail_record_strips_fields():
    record = {
        "message_id": "m1",
        "subject": "  Weekly digest  ",
        "from_address": "  news@example.com  ",
        "snippet": "  top stories  ",
    }

    result = transform.clean_gmail_record(record)

    assert result["subject"] == "Weekly digest"
    assert result["from_address"] == "news@example.com"
    assert result["snippet"] == "top stories"


def test_transform_records_dedups_gmail_by_message_id_and_attaches_keywords(monkeypatch):
    fake_llm = lambda texts: [["digest", "news"] for _ in texts]  # noqa: E731
    monkeypatch.setattr(transform, "extract_keywords_llm", fake_llm)
    records = [
        {"message_id": "m1", "subject": "Digest", "from_address": "a@b.com", "snippet": ""},
        {"message_id": "m1", "subject": "Digest", "from_address": "a@b.com", "snippet": ""},
    ]

    result = transform.transform_records("gmail", records)

    assert len(result) == 1
    assert result[0]["keywords"] == ["digest", "news"]


def test_transform_records_rejects_unknown_source():
    try:
        transform.transform_records("unknown", [])
        assert False, "expected ValueError"
    except ValueError:
        pass


def test_detect_data_quality_issues_returns_empty_when_healthy():
    raw = [{"id": i} for i in range(10)]
    cleaned = [{"id": i} for i in range(8)]  # 20% drop, unremarkable
    assert transform.detect_data_quality_issues(raw, cleaned) == []


def test_detect_data_quality_issues_ignores_small_batches_below_minimum():
    raw = [{"id": 1}, {"id": 2}]
    cleaned = [{"id": 1}]  # 50% drop, but below the minimum raw-count guard
    assert transform.detect_data_quality_issues(raw, cleaned) == []


def test_detect_data_quality_issues_flags_zero_output_from_nonzero_input():
    raw = [{"id": 1}, {"id": 2}, {"id": 3}]
    cleaned = []

    issues = transform.detect_data_quality_issues(raw, cleaned)

    assert len(issues) == 1
    assert "zero output" in issues[0]


def test_detect_data_quality_issues_flags_zero_output_even_for_a_single_record():
    assert len(transform.detect_data_quality_issues([{"id": 1}], [])) == 1


def test_detect_data_quality_issues_returns_empty_for_empty_raw_batch():
    assert transform.detect_data_quality_issues([], []) == []


def test_detect_data_quality_issues_does_not_flag_exactly_at_the_threshold():
    raw = [{"id": i} for i in range(10)]
    cleaned = [{"id": 0}, {"id": 1}]  # exactly 80% collapse -- the threshold is ">", not ">="
    assert transform.detect_data_quality_issues(raw, cleaned) == []


def test_detect_data_quality_issues_flags_high_duplicate_collapse_rate():
    raw = [{"id": i} for i in range(10)]
    cleaned = [{"id": 0}]  # 90% collapsed to one record -- above the 80% threshold

    issues = transform.detect_data_quality_issues(raw, cleaned)

    assert len(issues) == 1
    assert "collapsed" in issues[0]


def test_detect_data_quality_issues_does_not_double_flag_zero_output_batch():
    raw = [{"id": i} for i in range(10)]
    cleaned = []  # also a 100% collapse, but zero-output already covers it

    issues = transform.detect_data_quality_issues(raw, cleaned)

    assert len(issues) == 1


def test_lambda_handler_logs_data_quality_warning_for_zero_output_batch(monkeypatch, caplog):
    monkeypatch.setattr(transform, "read_ndjson", lambda bucket, key: [{"story_id": "1"}])
    monkeypatch.setattr(transform, "transform_records", lambda source, records: [])
    monkeypatch.setattr(transform, "write_parquet", lambda records, source: "")

    event = {
        "Records": [
            {"s3": {"bucket": {"name": "b"}, "object": {"key": "source=hackernews/x.json"}}}
        ]
    }

    with caplog.at_level("WARNING"):
        transform.lambda_handler(event, None)

    assert any("DATA_QUALITY_ALERT" in message for message in caplog.messages)
    assert any("hackernews" in message for message in caplog.messages)


def test_lambda_handler_logs_no_warning_for_healthy_batch(monkeypatch, caplog):
    monkeypatch.setattr(transform, "read_ndjson", lambda bucket, key: [{"story_id": "1"}])
    monkeypatch.setattr(transform, "transform_records", lambda source, records: [{"story_id": "1"}])
    monkeypatch.setattr(transform, "write_parquet", lambda records, source: "key")

    event = {
        "Records": [
            {"s3": {"bucket": {"name": "b"}, "object": {"key": "source=hackernews/x.json"}}}
        ]
    }

    with caplog.at_level("WARNING"):
        transform.lambda_handler(event, None)

    assert not any("DATA_QUALITY_ALERT" in message for message in caplog.messages)


def test_source_from_key_parses_prefix():
    key = "source=hackernews/year=2026/month=09/day=18/file.json"
    assert transform.source_from_key(key) == "hackernews"


def test_decode_s3_event_key_undoes_url_encoding():
    # S3 event notifications encode "=" as "%3D" and spaces as "+".
    encoded = "source%3Dhackernews/year%3D2026/month%3D09/day%3D18/hour%3D16/file+name.json"
    decoded = transform.decode_s3_event_key(encoded)

    assert decoded == "source=hackernews/year=2026/month=09/day=18/hour=16/file name.json"
    assert transform.source_from_key(decoded) == "hackernews"


def test_build_curated_key_partitions_by_source_and_time():
    from datetime import datetime, timezone

    ts = datetime(2026, 9, 18, 14, 30, 0, tzinfo=timezone.utc)
    key = transform.build_curated_key("hackernews", ts)

    assert key.startswith("source=hackernews/year=2026/month=09/day=18/")
    assert key.endswith(".parquet")


def test_write_parquet_dry_run_writes_readable_parquet(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "DRY_RUN", True)
    monkeypatch.chdir(tmp_path)

    records = [
        {"story_id": "s1", "title": "a", "text": "", "keywords": ["bitcoin", "rally"]},
        {"story_id": "s2", "title": "b", "text": "", "keywords": ["ether"]},
    ]
    key = transform.write_parquet(records, "hackernews")

    df = pd.read_parquet(tmp_path / "local_output_curated" / key)
    assert len(df) == 2
    assert df.loc[0, "keywords"] == "bitcoin,rally"


def test_write_parquet_returns_empty_string_for_no_records():
    assert transform.write_parquet([], "hackernews") == ""


def test_transform_records_gives_the_llm_the_natural_text_then_normalizes_the_columns(monkeypatch):
    seen = []

    def fake_llm(texts):
        seen.extend(texts)
        return [["k"] for _ in texts]

    monkeypatch.setattr(transform, "extract_keywords_llm", fake_llm)
    records = [
        {"story_id": "s1", "title": "The <b>Rust</b> Compiler!", "text": "Fast &amp; safe 🔥"}
    ]

    result = transform.transform_records("hackernews", records)

    assert seen == ["The <b>Rust</b> Compiler! Fast &amp; safe 🔥"]
    assert result[0]["title"] == "rust compiler"
    assert result[0]["text"] == "fast safe"
    assert result[0]["keywords"] == ["k"]


def test_transform_records_normalizes_news_title_and_description(monkeypatch):
    monkeypatch.setattr(transform, "extract_keywords_llm", lambda texts: [[] for _ in texts])
    records = [{"article_id": "a1", "title": "The Fed Cuts", "description": "Rates fall."}]

    result = transform.transform_records("news", records)

    assert result[0]["title"] == "fed cuts"
    assert result[0]["description"] == "rates fall"


def test_transform_records_normalizes_github_description_but_not_full_name(monkeypatch):
    monkeypatch.setattr(transform, "extract_keywords_llm", lambda texts: [[] for _ in texts])
    records = [{"repo_id": "1", "full_name": "Org/Repo", "description": "A <i>Fast</i> Tool"}]

    result = transform.transform_records("github", records)

    assert result[0]["full_name"] == "Org/Repo"
    assert result[0]["description"] == "fast tool"


def test_transform_records_leaves_gmail_text_alone(monkeypatch):
    monkeypatch.setattr(transform, "extract_keywords_llm", lambda texts: [[] for _ in texts])
    records = [
        {
            "message_id": "m1",
            "subject": "The Plan",
            "from_address": "A@B.com",
            "snippet": "hi &amp; bye",
        }
    ]

    result = transform.transform_records("gmail", records)

    assert result[0]["subject"] == "The Plan"
    assert result[0]["snippet"] == "hi &amp; bye"


def test_normalize_text_columns_turns_an_all_stopword_title_into_an_empty_string():
    records = [{"story_id": "s1", "title": "a", "text": "the"}]

    result = transform.normalize_text_columns(records, "hackernews")

    assert result[0]["title"] == ""
    assert result[0]["text"] == ""
