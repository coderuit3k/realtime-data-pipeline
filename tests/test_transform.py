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


def test_parse_keyword_response_parses_plain_json_array():
    result = transform.parse_keyword_response('["bitcoin, rally", "ether, defi"]', expected_count=2)

    assert result == [["bitcoin", "rally"], ["ether", "defi"]]


def test_parse_keyword_response_strips_markdown_code_fence():
    raw = '```json\n["bitcoin, rally"]\n```'
    result = transform.parse_keyword_response(raw, expected_count=1)

    assert result == [["bitcoin", "rally"]]


def test_parse_keyword_response_rejects_wrong_count():
    try:
        transform.parse_keyword_response('["only, one"]', expected_count=2)
        assert False, "expected ValueError"
    except ValueError:
        pass


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


def test_transform_records_rejects_unknown_source():
    try:
        transform.transform_records("unknown", [])
        assert False, "expected ValueError"
    except ValueError:
        pass


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
