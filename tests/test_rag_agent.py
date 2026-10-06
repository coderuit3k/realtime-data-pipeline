import json
from datetime import datetime, timezone

import pytest

from rag import agent


def test_build_system_prompt_states_the_given_date():
    now = datetime(2026, 10, 1, tzinfo=timezone.utc)
    prompt = agent.build_system_prompt(now)

    assert "2026-10-01" in prompt
    assert prompt.endswith(agent.SYSTEM_PROMPT)


def test_build_system_prompt_defaults_to_the_real_current_date(monkeypatch):
    fixed_now = datetime(2026, 3, 15, tzinfo=timezone.utc)

    class FixedDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return fixed_now

    monkeypatch.setattr(agent, "datetime", FixedDatetime)

    assert "2026-03-15" in agent.build_system_prompt()


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


def test_search_knowledge_base_reranks_the_hybrid_candidates(monkeypatch):
    candidates = [
        {"title": "a", "url": "u1", "text": "ta", "source": "news", "score": 0.5},
        {"title": "b", "url": "u2", "text": "tb", "source": "news", "score": 0.4},
    ]
    seen = {}

    def fake_hybrid(query, vector, n):
        seen["args"] = (query, vector, n)
        return candidates

    monkeypatch.setattr(agent, "embed_text", lambda text: [0.1])
    monkeypatch.setattr(agent.qdrant_store, "hybrid_search", fake_hybrid)
    monkeypatch.setattr(agent, "rerank", lambda q, docs, top_n: list(reversed(docs))[:top_n])
    monkeypatch.setattr(agent.config, "RAG_CANDIDATES", 30)
    monkeypatch.setattr(agent.config, "RAG_RERANK", True)

    result = agent.search_knowledge_base("q", top_k=1)

    assert seen["args"] == ("q", [0.1], 30)
    assert [d["title"] for d in result] == ["b"]


def test_search_knowledge_base_returns_nothing_when_rerank_finds_nothing_relevant(monkeypatch):
    candidates = [{"title": "a", "url": "u1", "text": "ta", "source": "news", "score": 0.5}]
    monkeypatch.setattr(agent, "embed_text", lambda text: [0.1])
    monkeypatch.setattr(agent.qdrant_store, "hybrid_search", lambda q, v, n: candidates)
    monkeypatch.setattr(agent, "rerank", lambda q, docs, top_n: [])
    monkeypatch.setattr(agent.config, "RAG_RERANK", True)

    assert agent.search_knowledge_base("q", top_k=5) == []


def test_search_knowledge_base_skips_rerank_when_disabled(monkeypatch):
    candidates = [
        {"title": str(i), "url": "", "text": "", "source": "", "score": 0} for i in range(4)
    ]

    def fail_if_called(*args, **kwargs):
        raise AssertionError("rerank must not run when RAG_RERANK is false")

    monkeypatch.setattr(agent, "embed_text", lambda text: [0.1])
    monkeypatch.setattr(agent.qdrant_store, "hybrid_search", lambda q, v, n: candidates)
    monkeypatch.setattr(agent, "rerank", fail_if_called)
    monkeypatch.setattr(agent.config, "RAG_RERANK", False)

    result = agent.search_knowledge_base("q", top_k=2)

    assert [d["title"] for d in result] == ["0", "1"]


def test_run_tool_search_knowledge_base_returns_summary_and_raw(monkeypatch):
    matches = [{"title": "t", "url": "https://example.com", "text": "x" * 400, "score": 0.9}]
    monkeypatch.setattr(agent, "search_knowledge_base", lambda query, top_k: matches)

    summary, raw = agent.run_tool("search_knowledge_base", {"query": "q"})

    assert summary[0]["title"] == "t"
    assert summary[0]["url"] == "https://example.com"
    # The model gets the whole passage the reranker scored, not a 300-character prefix.
    assert summary[0]["snippet"] == "x" * 400
    assert raw == matches


def test_run_tool_search_knowledge_base_with_no_matches_returns_empty_lists(monkeypatch):
    monkeypatch.setattr(agent, "search_knowledge_base", lambda query, top_k: [])

    summary, raw = agent.run_tool("search_knowledge_base", {"query": "q"})

    assert summary == []
    assert raw == []


def test_run_tool_search_knowledge_base_failure_becomes_an_error_result(monkeypatch):
    def boom(query, top_k):
        raise RuntimeError("cluster suspended")

    monkeypatch.setattr(agent, "search_knowledge_base", boom)

    summary, raw = agent.run_tool("search_knowledge_base", {"query": "q"})

    assert summary == [{"error": "knowledge base search failed"}]
    assert raw == []


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

    summary, raw = agent.run_tool("get_crypto_prices", {})

    assert summary[0]["coin_id"] == "bitcoin"
    assert summary[0]["price_usd"] == 88420.0
    assert summary[0]["change_24h_pct"] == 2.4
    assert raw[0]["url"] == "https://www.coingecko.com/en/coins/bitcoin"
    assert raw[0]["source"] == "crypto"


def test_run_tool_get_crypto_prices_empty_snapshot_returns_empty(monkeypatch):
    monkeypatch.setattr(agent, "get_crypto_prices", lambda: [])

    summary, raw = agent.run_tool("get_crypto_prices", {})

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

    summary, raw = agent.run_tool("get_weather", {})

    assert summary[0]["location"] == "Hanoi"
    assert summary[0]["temperature_c"] == 22.0
    assert len(raw) == 1
    assert raw[0]["url"] == "https://open-meteo.com/"
    assert raw[0]["source"] == "weather"


def test_run_tool_get_weather_empty_snapshot_returns_empty(monkeypatch):
    monkeypatch.setattr(agent, "get_weather", lambda: [])

    summary, raw = agent.run_tool("get_weather", {})

    assert summary == []
    assert raw == []


def test_run_tool_search_web_returns_summary_and_raw(monkeypatch):
    results = [{"title": "t", "url": "https://example.com", "text": "body", "source": "web"}]
    monkeypatch.setattr(agent, "search_web", lambda query: results)

    summary, raw = agent.run_tool("search_web", {"query": "q"})

    assert summary[0]["title"] == "t"
    assert raw == results


def test_run_tool_search_web_failure_returns_empty_raw(monkeypatch):
    def failing_search(query):
        raise RuntimeError("tavily down")

    monkeypatch.setattr(agent, "search_web", failing_search)

    summary, raw = agent.run_tool("search_web", {"query": "q"})

    assert raw == []
    assert "error" in summary[0]


def test_query_athena_rejects_invalid_sql_without_calling_athena(monkeypatch):
    def fail_if_called(sql, max_rows=25):
        raise AssertionError("should not reach Athena for invalid SQL")

    monkeypatch.setattr(agent.athena, "run_query", fail_if_called)

    with pytest.raises(ValueError):
        agent.query_athena("DROP TABLE crypto_prices")


def test_query_athena_delegates_to_athena_run_query_when_sql_is_valid(monkeypatch):
    monkeypatch.setattr(
        agent.athena, "run_query", lambda sql, max_rows: ([{"coin_id": "bitcoin"}], False)
    )

    rows, truncated = agent.query_athena("SELECT * FROM crypto_prices", max_rows=10)

    assert rows == [{"coin_id": "bitcoin"}]
    assert truncated is False


def test_run_tool_query_athena_returns_summary_and_no_sources(monkeypatch):
    monkeypatch.setattr(
        agent, "query_athena", lambda sql, **kwargs: ([{"coin_id": "bitcoin"}], False)
    )

    summary, raw = agent.run_tool(
        "query_athena", {"sql": "SELECT * FROM crypto_prices"}
    )

    assert summary == [{"coin_id": "bitcoin"}]
    assert raw == []


def test_run_tool_query_athena_appends_truncation_note(monkeypatch):
    monkeypatch.setattr(
        agent, "query_athena", lambda sql, **kwargs: ([{"n": "1"}], True)
    )

    summary, raw = agent.run_tool("query_athena", {"sql": "SELECT n FROM t"})

    assert summary[0] == {"n": "1"}
    assert "note" in summary[1]
    assert raw == []


def test_run_tool_query_athena_failure_returns_error_summary(monkeypatch):
    def failing_query(sql, **kwargs):
        raise ValueError("Only SELECT statements are allowed (optionally starting with WITH).")

    monkeypatch.setattr(agent, "query_athena", failing_query)

    summary, raw = agent.run_tool("query_athena", {"sql": "DROP TABLE x"})

    assert raw == []
    assert "error" in summary[0]


def test_run_tool_unknown_tool_name():
    summary, raw = agent.run_tool("not_a_real_tool", {})
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
    monkeypatch.setattr(agent, "search_knowledge_base", lambda query, top_k: matches)

    fake = FakeBedrock(
        [
            _tool_use_response("tu1", "search_knowledge_base", "AI safety"),
            _final_response("AI safety is widely discussed [1]."),
        ]
    )
    monkeypatch.setattr(agent, "_bedrock", lambda: fake)

    result = agent.run_agent("What is AI safety?")

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

    result = agent.run_agent("What's the Bitcoin price?")

    assert result["answer"] == "Bitcoin is $88,420, up 2.4% in 24h [1]."
    assert result["trace"][0]["tool"] == "get_crypto_prices"
    assert result["sources"][0]["url"] == "https://www.coingecko.com/en/coins/bitcoin"


def test_run_agent_calls_query_athena_tool_then_returns_final_answer(monkeypatch):
    monkeypatch.setattr(
        agent, "query_athena", lambda sql, **kwargs: ([{"avg_price": "88420.5"}], False)
    )

    tool_use = {
        "stopReason": "tool_use",
        "output": {
            "message": {
                "role": "assistant",
                "content": [
                    {
                        "toolUse": {
                            "toolUseId": "tu1",
                            "name": "query_athena",
                            "input": {
                                "sql": "SELECT AVG(price_usd) AS avg_price FROM crypto_prices"
                            },
                        }
                    }
                ],
            }
        },
    }
    fake = FakeBedrock([tool_use, _final_response("The average price was $88,420.50.")])
    monkeypatch.setattr(agent, "_bedrock", lambda: fake)

    result = agent.run_agent("What was the average BTC price?")

    assert result["answer"] == "The average price was $88,420.50."
    assert result["trace"][0]["tool"] == "query_athena"


def test_run_agent_answers_directly_with_no_tool_calls(monkeypatch):
    fake = FakeBedrock([_final_response("2 + 2 = 4.")])
    monkeypatch.setattr(agent, "_bedrock", lambda: fake)

    result = agent.run_agent("What is 2+2?")

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

    result = agent.run_agent("A tricky question")

    assert result["answer"] == "Best effort answer."
    assert len(result["trace"]) == 2
    # Converse rejects any history containing toolUse/toolResult blocks unless
    # toolConfig is also sent (ValidationException), even when we don't want
    # more tool calls -- so the forcing call must carry it.
    assert fake.calls[-1]["toolConfig"] == {"tools": agent.TOOLS}
    assert "no more tools" in fake.calls[-1]["system"][0]["text"]


def test_lambda_handler_rejects_missing_question():
    result = agent.lambda_handler({}, None)
    assert result["statusCode"] == 400


def test_normalize_question_collapses_case_and_whitespace():
    assert agent.normalize_question("  What IS   trending?  ") == "what is trending?"


def test_question_hash_is_stable_across_equivalent_phrasing():
    assert agent.question_hash("What is trending?") == agent.question_hash("what is   trending?")


class FakeTable:
    """In-memory stand-in for a boto3 DynamoDB Table resource."""

    def __init__(self):
        self.items = {}

    def get_item(self, Key):
        item = self.items.get(Key["question_hash"])
        return {"Item": item} if item is not None else {}

    def put_item(self, Item):
        self.items[Item["question_hash"]] = Item


class FakeDynamoDB:
    def __init__(self, table):
        self._table = table

    def Table(self, name):
        return self._table


def test_get_cached_answer_returns_none_when_memory_disabled(monkeypatch):
    monkeypatch.setattr(agent, "RAG_MEMORY_TABLE", "")
    assert agent.get_cached_answer("anything") is None


def test_store_then_get_cached_answer_round_trips(monkeypatch):
    table = FakeTable()
    monkeypatch.setattr(agent, "RAG_MEMORY_TABLE", "rag-memory")
    monkeypatch.setattr(agent, "_dynamodb", lambda: FakeDynamoDB(table))

    agent.store_cached_answer(
        "What is trending?",
        "AI agents.",
        [{"url": "https://x"}],
        [{"tool": "search_web", "input": {"query": "trending"}, "result_count": 1}],
        hit_count=1,
    )
    cached = agent.get_cached_answer("what is   trending?")

    assert cached["answer"] == "AI agents."
    assert json.loads(cached["sources"]) == [{"url": "https://x"}]
    assert json.loads(cached["tool_calls"]) == [
        {"tool": "search_web", "input": {"query": "trending"}, "result_count": 1}
    ]


def test_store_cached_answer_sets_ttl_below_promotion_threshold(monkeypatch):
    table = FakeTable()
    monkeypatch.setattr(agent, "RAG_MEMORY_TABLE", "rag-memory")
    monkeypatch.setattr(agent, "RAG_MEMORY_PROMOTE_AFTER_HITS", 2)
    monkeypatch.setattr(agent, "_dynamodb", lambda: FakeDynamoDB(table))

    agent.store_cached_answer("Q", "A", [], [], hit_count=1)

    item = table.items[agent.question_hash("Q")]
    assert "ttl" in item


def test_store_cached_answer_promotes_to_permanent_at_threshold(monkeypatch):
    table = FakeTable()
    monkeypatch.setattr(agent, "RAG_MEMORY_TABLE", "rag-memory")
    monkeypatch.setattr(agent, "RAG_MEMORY_PROMOTE_AFTER_HITS", 2)
    monkeypatch.setattr(agent, "_dynamodb", lambda: FakeDynamoDB(table))

    agent.store_cached_answer("Q", "A", [], [], hit_count=2)

    item = table.items[agent.question_hash("Q")]
    assert "ttl" not in item


def test_lambda_handler_returns_cached_answer_without_calling_run_agent(monkeypatch):
    table = FakeTable()
    monkeypatch.setattr(agent, "RAG_MEMORY_TABLE", "rag-memory")
    monkeypatch.setattr(agent, "_dynamodb", lambda: FakeDynamoDB(table))
    original_trace = [{"tool": "search_web", "input": {"query": "trending"}, "result_count": 1}]
    agent.store_cached_answer(
        "What is trending?", "AI agents.", [{"url": "https://x"}], original_trace, hit_count=1
    )

    def fail_if_called(*args, **kwargs):
        raise AssertionError("run_agent should not be called on a cache hit")

    monkeypatch.setattr(agent, "run_agent", fail_if_called)

    result = agent.lambda_handler({"question": "what is trending?"}, None)

    assert result["cached"] is True
    assert result["answer"] == "AI agents."
    assert result["sources"] == [{"url": "https://x"}]
    # The answer was really grounded via search_web when first computed --
    # a cache hit must say so, not claim no tool was used.
    assert result["tool_calls"] == original_trace
    # Re-asking bumped hit_count from 1 -> 2.
    assert table.items[agent.question_hash("What is trending?")]["hit_count"] == 2


def test_lambda_handler_cache_hit_defaults_to_empty_trace_for_pre_existing_entries(monkeypatch):
    # A cache entry written before tool_calls was persisted (see
    # store_cached_answer) has no "tool_calls" key at all -- must not KeyError.
    table = FakeTable()
    table.items[agent.question_hash("Old question")] = {
        "question_hash": agent.question_hash("Old question"),
        "answer": "Old answer.",
        "sources": "[]",
        "hit_count": 1,
    }
    monkeypatch.setattr(agent, "RAG_MEMORY_TABLE", "rag-memory")
    monkeypatch.setattr(agent, "_dynamodb", lambda: FakeDynamoDB(table))

    result = agent.lambda_handler({"question": "Old question"}, None)

    assert result["cached"] is True
    assert result["tool_calls"] == []


def test_lambda_handler_runs_agent_and_caches_on_miss(monkeypatch):
    table = FakeTable()
    monkeypatch.setattr(agent, "RAG_MEMORY_TABLE", "rag-memory")
    monkeypatch.setattr(agent, "_dynamodb", lambda: FakeDynamoDB(table))
    fresh_trace = [{"tool": "query_athena", "input": {"sql": "SELECT 1"}, "result_count": 1}]
    monkeypatch.setattr(
        agent,
        "run_agent",
        lambda question: {
            "answer": "Fresh answer.",
            "trace": fresh_trace,
            "sources": [{"title": "T", "url": "https://y", "source": "news"}],
            "truncated": False,
        },
    )

    result = agent.lambda_handler({"question": "New question?"}, None)

    assert result["cached"] is False
    assert result["answer"] == "Fresh answer."
    assert result["tool_calls"] == fresh_trace
    cached_item = table.items[agent.question_hash("New question?")]
    assert cached_item["hit_count"] == 1
    assert "ttl" in cached_item
    # The trace from this fresh run must be persisted too, so the next cache
    # hit on this same question can show real grounding, not an empty list.
    assert json.loads(cached_item["tool_calls"]) == fresh_trace


def _truncated_response(text: str) -> dict:
    return {
        "stopReason": "max_tokens",
        "output": {"message": {"role": "assistant", "content": [{"text": text}] if text else []}},
    }


def test_run_agent_flags_and_labels_an_answer_cut_off_by_max_tokens(monkeypatch):
    fake = FakeBedrock([_truncated_response("Một câu trả lời dài bị cắt giữa chừng, tác động t")])
    monkeypatch.setattr(agent, "_bedrock", lambda: fake)

    result = agent.run_agent("Q")

    assert result["truncated"] is True
    assert result["answer"].startswith("Một câu trả lời dài bị cắt giữa chừng, tác động t")
    assert result["answer"].endswith(agent.TRUNCATED_NOTICE)


def test_run_agent_never_returns_a_blank_answer_when_cut_off_with_no_text(monkeypatch):
    # Hitting max_tokens while emitting a tool call yields no text at all.
    fake = FakeBedrock([_truncated_response("")])
    monkeypatch.setattr(agent, "_bedrock", lambda: fake)

    result = agent.run_agent("Q")

    assert result["truncated"] is True
    assert result["answer"].strip() == agent.TRUNCATED_NOTICE.strip()


def test_run_agent_flags_truncation_of_the_forced_final_answer(monkeypatch):
    monkeypatch.setattr(agent, "MAX_ITERATIONS", 1)
    monkeypatch.setattr(agent, "search_web", lambda query: [])
    fake = FakeBedrock([_tool_use_response("tu1", "search_web", "a"), _truncated_response("Cụt")])
    monkeypatch.setattr(agent, "_bedrock", lambda: fake)

    result = agent.run_agent("Q")

    assert result["truncated"] is True
    assert result["answer"].endswith(agent.TRUNCATED_NOTICE)


def test_run_agent_does_not_flag_a_complete_answer(monkeypatch):
    fake = FakeBedrock([_final_response("Đầy đủ.")])
    monkeypatch.setattr(agent, "_bedrock", lambda: fake)

    result = agent.run_agent("Q")

    assert result["truncated"] is False
    assert result["answer"] == "Đầy đủ."


def test_run_agent_gives_every_converse_call_the_answer_token_cap(monkeypatch):
    monkeypatch.setattr(agent, "MAX_ITERATIONS", 1)
    monkeypatch.setattr(agent, "search_web", lambda query: [])
    fake = FakeBedrock([_tool_use_response("tu1", "search_web", "a"), _final_response("ok")])
    monkeypatch.setattr(agent, "_bedrock", lambda: fake)

    agent.run_agent("Q")

    assert [c["inferenceConfig"]["maxTokens"] for c in fake.calls] == [agent.MAX_ANSWER_TOKENS] * 2


def test_lambda_handler_does_not_cache_a_truncated_answer(monkeypatch):
    table = FakeTable()
    monkeypatch.setattr(agent, "RAG_MEMORY_TABLE", "rag-memory")
    monkeypatch.setattr(agent, "_dynamodb", lambda: FakeDynamoDB(table))
    monkeypatch.setattr(
        agent,
        "run_agent",
        lambda question: {
            "answer": "Cụt" + agent.TRUNCATED_NOTICE,
            "trace": [],
            "sources": [],
            "truncated": True,
        },
    )

    result = agent.lambda_handler({"question": "Another question?"}, None)

    assert result["answer"].endswith(agent.TRUNCATED_NOTICE)
    assert agent.question_hash("Another question?") not in table.items


def test_run_agent_flags_a_run_where_a_tool_failed(monkeypatch):
    def boom(query, top_k):
        raise RuntimeError("qdrant down")

    monkeypatch.setattr(agent, "search_knowledge_base", boom)
    fake = FakeBedrock(
        [_tool_use_response("tu1", "search_knowledge_base", "Q"), _final_response("No data.")]
    )
    monkeypatch.setattr(agent, "_bedrock", lambda: fake)

    result = agent.run_agent("Q")

    assert result["degraded"] is True


def test_run_agent_does_not_flag_a_run_where_tools_succeeded(monkeypatch):
    monkeypatch.setattr(agent, "search_knowledge_base", lambda query, top_k: [])
    fake = FakeBedrock(
        [_tool_use_response("tu1", "search_knowledge_base", "Q"), _final_response("Nothing.")]
    )
    monkeypatch.setattr(agent, "_bedrock", lambda: fake)

    assert agent.run_agent("Q")["degraded"] is False


def test_lambda_handler_does_not_cache_an_answer_produced_after_a_tool_failure(monkeypatch):
    table = FakeTable()
    monkeypatch.setattr(agent, "RAG_MEMORY_TABLE", "rag-memory")
    monkeypatch.setattr(agent, "_dynamodb", lambda: FakeDynamoDB(table))
    monkeypatch.setattr(
        agent,
        "run_agent",
        lambda question: {
            "answer": "No data.",
            "trace": [],
            "sources": [],
            "truncated": False,
            "degraded": True,
        },
    )

    agent.lambda_handler({"question": "Degraded question?"}, None)

    assert agent.question_hash("Degraded question?") not in table.items


def test_search_knowledge_base_description_says_it_may_return_no_results():
    spec = next(
        t["toolSpec"] for t in agent.TOOLS if t["toolSpec"]["name"] == "search_knowledge_base"
    )
    assert "no results" in spec["description"].lower()


def _athena_tool_description():
    spec = next(t["toolSpec"] for t in agent.TOOLS if t["toolSpec"]["name"] == "query_athena")
    return spec["description"]


def test_query_athena_description_warns_that_item_tables_are_repeated_snapshots():
    text = _athena_tool_description()

    # Without this the model counts rows: 1,792 "Python repositories" that were really 18.
    assert "COUNT(DISTINCT" in text
    for id_column in ("story_id", "article_id", "repo_id"):
        assert id_column in text
    assert "ROW_NUMBER()" in text  # the latest-row pattern for an item's current score/stars


def test_query_athena_description_lists_the_github_id_and_ingested_at_columns():
    text = _athena_tool_description()

    assert "github_repos(repo_id, full_name" in text
    assert "stars, forks, created_at, pushed_at, ingested_at, keywords)" in text


def test_query_athena_description_explains_windows_that_cross_a_month_boundary():
    text = _athena_tool_description()

    # year/month/day are separate strings: "month='10' AND day >= '28'" silently drops
    # September 28-30 when a 7-day window starts in the previous month. One comparison on the
    # concatenated date has no month branch to get wrong.
    assert "month boundary" in text
    assert "concat(year, month, day) BETWEEN '20260928' AND '20261004'" in text


def test_search_knowledge_base_sends_the_question_as_asked_to_every_stage(monkeypatch):
    seen = {}

    def fake_embed(text):
        seen["embedded"] = text
        return [0.1]

    def fake_hybrid(query, vector, n):
        seen["bm25"] = query
        return [{"title": "a", "url": "u", "text": "t", "source": "news", "score": 0.5}]

    def fake_rerank(query, docs, top_n):
        seen["reranked"] = query
        return docs

    monkeypatch.setattr(agent, "embed_text", fake_embed)
    monkeypatch.setattr(agent.qdrant_store, "hybrid_search", fake_hybrid)
    monkeypatch.setattr(agent, "rerank", fake_rerank)
    monkeypatch.setattr(agent.config, "RAG_RERANK", True)

    agent.search_knowledge_base("What are the Rust Projects?", top_k=3)

    assert seen == {
        "embedded": "What are the Rust Projects?",
        "bm25": "What are the Rust Projects?",
        "reranked": "What are the Rust Projects?",
    }


def test_query_athena_description_says_text_columns_are_lowercase_without_punctuation():
    text = _athena_tool_description()

    assert "lowercase" in text
    assert "full_name" in text
