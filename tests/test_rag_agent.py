from datetime import datetime, timezone

from rag import agent


def test_cosine_similarity_identical_vectors_is_one():
    assert agent.cosine_similarity([1.0, 0.0], [1.0, 0.0]) == 1.0


def test_read_latest_curated_snapshot_picks_most_recent_key_today(monkeypatch):
    now = datetime(2026, 3, 30, 12, 0, tzinfo=timezone.utc)
    keys_by_prefix = {
        "source=crypto/year=2026/month=03/day=30/": [
            "source=crypto/year=2026/month=03/day=30/20260330T100000-aaa.parquet",
            "source=crypto/year=2026/month=03/day=30/20260330T113000-bbb.parquet",
        ]
    }
    records_by_key = {
        "source=crypto/year=2026/month=03/day=30/20260330T113000-bbb.parquet": [
            {"coin_id": "bitcoin", "price_usd": 88420.0}
        ]
    }
    def fake_list(bucket, prefix):
        return keys_by_prefix.get(prefix, [])

    monkeypatch.setattr(agent, "list_parquet_keys", fake_list)
    monkeypatch.setattr(agent, "read_parquet_records", lambda bucket, key: records_by_key[key])

    result = agent.read_latest_curated_snapshot("crypto", now=now)

    assert result == [{"coin_id": "bitcoin", "price_usd": 88420.0}]


def test_read_latest_curated_snapshot_falls_back_to_previous_day_when_today_empty(monkeypatch):
    now = datetime(2026, 3, 30, 0, 5, tzinfo=timezone.utc)
    keys_by_prefix = {
        "source=weather/year=2026/month=03/day=30/": [],
        "source=weather/year=2026/month=03/day=29/": [
            "source=weather/year=2026/month=03/day=29/20260329T235000-ccc.parquet"
        ],
    }
    records_by_key = {
        "source=weather/year=2026/month=03/day=29/20260329T235000-ccc.parquet": [
            {"location": "Hanoi", "temperature_c": 22.0}
        ]
    }
    def fake_list(bucket, prefix):
        return keys_by_prefix.get(prefix, [])

    monkeypatch.setattr(agent, "list_parquet_keys", fake_list)
    monkeypatch.setattr(agent, "read_parquet_records", lambda bucket, key: records_by_key[key])

    result = agent.read_latest_curated_snapshot("weather", now=now)

    assert result == [{"location": "Hanoi", "temperature_c": 22.0}]


def test_read_latest_curated_snapshot_returns_empty_when_no_data_either_day(monkeypatch):
    now = datetime(2026, 3, 30, 12, 0, tzinfo=timezone.utc)

    def fail_if_called(bucket, key):
        raise AssertionError("should not be called")

    monkeypatch.setattr(agent, "list_parquet_keys", lambda bucket, prefix: [])
    monkeypatch.setattr(agent, "read_parquet_records", fail_if_called)

    result = agent.read_latest_curated_snapshot("crypto", now=now)

    assert result == []


def test_sanitize_nan_converts_nan_floats_to_none():
    records = [{"coin_id": "bitcoin", "price_usd": 88420.0, "change_24h_pct": float("nan")}]

    result = agent._sanitize_nan(records)

    assert result == [{"coin_id": "bitcoin", "price_usd": 88420.0, "change_24h_pct": None}]


def test_sanitize_nan_leaves_non_float_and_normal_values_untouched():
    records = [{"location": "Vung Tau", "temperature_c": 29.5, "weather_code": 3, "note": None}]

    result = agent._sanitize_nan(records)

    assert result == records


def test_search_knowledge_base_orders_by_score_and_truncates(monkeypatch):
    monkeypatch.setattr(agent, "embed_text", lambda text: [1.0, 0.0])
    documents = [
        {"id": "low", "embedding": [0.0, 1.0]},
        {"id": "high", "embedding": [1.0, 0.0]},
        {"id": "mid", "embedding": [0.7, 0.7]},
    ]

    result = agent.search_knowledge_base("query", documents, top_k=2)

    assert [d["id"] for d in result] == ["high", "mid"]


def test_run_tool_search_knowledge_base_returns_summary_and_raw(monkeypatch):
    matches = [{"title": "t", "url": "https://example.com", "text": "x" * 400, "score": 0.9}]
    monkeypatch.setattr(agent, "search_knowledge_base", lambda query, documents, top_k: matches)

    summary, raw = agent.run_tool("search_knowledge_base", {"query": "q"}, documents=[])

    assert summary[0]["title"] == "t"
    assert summary[0]["url"] == "https://example.com"
    assert len(summary[0]["snippet"]) == 300
    assert raw == matches


def test_run_tool_get_crypto_prices_returns_summary_and_sources(monkeypatch):
    records = [
        {
            "coin_id": "bitcoin",
            "price_usd": 88420.0,
            "change_24h_pct": 2.4,
            "market_cap_usd": 1.7e12,
            "observed_at": "2026-03-30T07:00:00Z",
        }
    ]
    monkeypatch.setattr(agent, "get_crypto_prices", lambda: records)

    summary, raw = agent.run_tool("get_crypto_prices", {}, documents=[])

    assert summary[0]["coin_id"] == "bitcoin"
    assert summary[0]["price_usd"] == 88420.0
    assert summary[0]["change_24h_pct"] == 2.4
    assert raw[0]["url"] == "https://www.coingecko.com/en/coins/bitcoin"
    assert raw[0]["source"] == "crypto"


def test_run_tool_get_crypto_prices_empty_snapshot_returns_empty(monkeypatch):
    monkeypatch.setattr(agent, "get_crypto_prices", lambda: [])

    summary, raw = agent.run_tool("get_crypto_prices", {}, documents=[])

    assert summary == []
    assert raw == []


def test_run_tool_get_weather_returns_summary_and_sources(monkeypatch):
    records = [
        {
            "location": "Hanoi",
            "temperature_c": 22.0,
            "humidity_pct": 70.0,
            "precipitation_mm": 0.0,
            "wind_speed_kmh": 10.0,
            "observed_at": "2026-03-30T07:00:00Z",
        }
    ]
    monkeypatch.setattr(agent, "get_weather", lambda: records)

    summary, raw = agent.run_tool("get_weather", {}, documents=[])

    assert summary[0]["location"] == "Hanoi"
    assert summary[0]["temperature_c"] == 22.0
    assert len(raw) == 1
    assert raw[0]["url"] == "https://open-meteo.com/"
    assert raw[0]["source"] == "weather"


def test_run_tool_get_weather_empty_snapshot_returns_empty(monkeypatch):
    monkeypatch.setattr(agent, "get_weather", lambda: [])

    summary, raw = agent.run_tool("get_weather", {}, documents=[])

    assert summary == []
    assert raw == []


def test_run_tool_search_web_returns_summary_and_raw(monkeypatch):
    results = [{"title": "t", "url": "https://example.com", "text": "body", "source": "web"}]
    monkeypatch.setattr(agent, "search_web", lambda query: results)

    summary, raw = agent.run_tool("search_web", {"query": "q"}, documents=[])

    assert summary[0]["title"] == "t"
    assert raw == results


def test_run_tool_search_web_failure_returns_empty_raw(monkeypatch):
    def failing_search(query):
        raise RuntimeError("tavily down")

    monkeypatch.setattr(agent, "search_web", failing_search)

    summary, raw = agent.run_tool("search_web", {"query": "q"}, documents=[])

    assert raw == []
    assert "error" in summary[0]


def test_run_tool_unknown_tool_name():
    summary, raw = agent.run_tool("not_a_real_tool", {}, documents=[])
    assert raw == []
    assert "error" in summary[0]


def test_extract_text_joins_text_blocks():
    message = {"content": [{"text": "Hello "}, {"toolUse": {}}, {"text": "world"}]}
    assert agent.extract_text(message) == "Hello world"


class FakeBedrock:
    """Scripts a sequence of canned Converse API responses."""

    def __init__(self, responses):
        self._responses = list(responses)
        self.calls = []

    def converse(self, **kwargs):
        self.calls.append(kwargs)
        return self._responses.pop(0)


def _tool_use_response(tool_use_id: str, name: str, query: str) -> dict:
    return {
        "stopReason": "tool_use",
        "output": {
            "message": {
                "role": "assistant",
                "content": [
                    {"toolUse": {"toolUseId": tool_use_id, "name": name, "input": {"query": query}}}
                ],
            }
        },
    }


def _final_response(text: str) -> dict:
    return {
        "stopReason": "end_turn",
        "output": {"message": {"role": "assistant", "content": [{"text": text}]}},
    }


def test_run_agent_calls_tool_then_returns_final_answer(monkeypatch):
    matches = [{"title": "t", "url": "https://example.com", "text": "body", "score": 0.9}]
    monkeypatch.setattr(agent, "search_knowledge_base", lambda query, documents, top_k: matches)

    fake = FakeBedrock(
        [
            _tool_use_response("tu1", "search_knowledge_base", "AI safety"),
            _final_response("AI safety is widely discussed [1]."),
        ]
    )
    monkeypatch.setattr(agent, "_bedrock", lambda: fake)

    result = agent.run_agent("What is AI safety?", documents=[])

    assert result["answer"] == "AI safety is widely discussed [1]."
    assert len(result["trace"]) == 1
    assert result["trace"][0]["tool"] == "search_knowledge_base"
    assert result["sources"][0]["url"] == "https://example.com"
    assert len(fake.calls) == 2


def test_run_agent_calls_get_crypto_prices_tool_then_returns_final_answer(monkeypatch):
    records = [{"coin_id": "bitcoin", "price_usd": 88420.0, "change_24h_pct": 2.4}]
    monkeypatch.setattr(agent, "get_crypto_prices", lambda: records)

    no_arg_tool_use = {
        "stopReason": "tool_use",
        "output": {
            "message": {
                "role": "assistant",
                "content": [
                    {"toolUse": {"toolUseId": "tu1", "name": "get_crypto_prices", "input": {}}}
                ],
            }
        },
    }
    fake = FakeBedrock(
        [
            no_arg_tool_use,
            _final_response("Bitcoin is $88,420, up 2.4% in 24h [1]."),
        ]
    )
    monkeypatch.setattr(agent, "_bedrock", lambda: fake)

    result = agent.run_agent("What's the Bitcoin price?", documents=[])

    assert result["answer"] == "Bitcoin is $88,420, up 2.4% in 24h [1]."
    assert result["trace"][0]["tool"] == "get_crypto_prices"
    assert result["sources"][0]["url"] == "https://www.coingecko.com/en/coins/bitcoin"


def test_run_agent_answers_directly_with_no_tool_calls(monkeypatch):
    fake = FakeBedrock([_final_response("2 + 2 = 4.")])
    monkeypatch.setattr(agent, "_bedrock", lambda: fake)

    result = agent.run_agent("What is 2+2?", documents=[])

    assert result["answer"] == "2 + 2 = 4."
    assert result["trace"] == []
    assert result["sources"] == []


def test_run_agent_forces_final_answer_after_max_iterations(monkeypatch):
    monkeypatch.setattr(agent, "MAX_ITERATIONS", 2)
    monkeypatch.setattr(agent, "search_web", lambda query: [])

    fake = FakeBedrock(
        [
            _tool_use_response("tu1", "search_web", "a"),
            _tool_use_response("tu2", "search_web", "b"),
            _final_response("Best effort answer."),
        ]
    )
    monkeypatch.setattr(agent, "_bedrock", lambda: fake)

    result = agent.run_agent("A tricky question", documents=[])

    assert result["answer"] == "Best effort answer."
    assert len(result["trace"]) == 2
    # The forcing call carries no toolConfig -- the model can't keep looping.
    assert "toolConfig" not in fake.calls[-1]


def test_lambda_handler_rejects_missing_question():
    result = agent.lambda_handler({}, None)
    assert result["statusCode"] == 400
